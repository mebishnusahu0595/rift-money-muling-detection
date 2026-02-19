"""
FastAPI entry-point for the Money Muling Detection Engine.

Endpoints
─────────
POST /api/v1/analyze          – Upload CSV, start analysis
GET  /api/v1/analysis/{id}    – Poll / fetch results
GET  /api/v1/analysis/{id}/download  – Download JSON report
GET  /api/v1/analysis/{id}/graph     – Graph data for frontend viz
"""

from __future__ import annotations

import io
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Dict

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .detectors.cycle_detector import detect_cycles
from .detectors.shell_detector import detect_shells
from .detectors.smurfing_detector import detect_smurfing
from .filters import apply_filters
from .graph_builder import build_account_profiles, build_graph, build_graph_data
from .models import (
    AnalysisResult,
    AnalysisStatus,
    AnalysisStatusResponse,
    GraphData,
    Summary,
    UploadResponse,
)
from .scoring import build_fraud_rings, build_suspicious_accounts, calculate_scores

app = FastAPI(
    title="Money Muling Detection Engine",
    description="Financial Forensics Engine for RIFT 2026 – detects circular fund routing, smurfing, and shell networks.",
    version="1.0.0",
)

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory store (sufficient for hackathon) ───────────────────────────────
analyses: Dict[str, AnalysisStatusResponse] = {}
graph_cache: Dict[str, GraphData] = {}

executor = ThreadPoolExecutor(max_workers=4)


# ── Helpers ──────────────────────────────────────────────────────────────────

REQUIRED_COLUMNS = {"sender", "receiver", "amount", "timestamp"}


def _validate_csv(df: pd.DataFrame) -> None:
    # Accept either sender/receiver or sender_id/receiver_id
    col_map = {}
    if "sender_id" in df.columns and "sender" not in df.columns:
        col_map["sender_id"] = "sender"
    if "receiver_id" in df.columns and "receiver" not in df.columns:
        col_map["receiver_id"] = "receiver"
    if col_map:
        df.rename(columns=col_map, inplace=True)
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}")


def _run_analysis(analysis_id: str, df: pd.DataFrame) -> None:
    """Background analysis pipeline."""
    try:
        start = time.time()

        # 1. Build graph
        G = build_graph(df)

        # 2. Run detectors
        cycles = detect_cycles(G, df)
        smurfing_results = detect_smurfing(df)
        shell_results = detect_shells(G)

        # 3. Build & filter profiles
        profiles = build_account_profiles(G)
        profiles = apply_filters(profiles, df)

        # 4. Score
        scores = calculate_scores(profiles, cycles, smurfing_results, shell_results)

        # 5. Assign ring IDs to smurfing results
        smurf_ring_counter = len(cycles) + len(shell_results)
        for s in smurfing_results:
            if not s.ring_id:
                smurf_ring_counter += 1
                s.ring_id = f"RING_{smurf_ring_counter:03d}"

        # 6. Build output
        suspicious = build_suspicious_accounts(
            scores, cycles, smurfing_results, shell_results,
            profiles=profiles, graph=G,
        )
        fraud_rings = build_fraud_rings(scores, cycles, smurfing_results, shell_results)

        elapsed = round(time.time() - start, 2)

        # Compute total transaction volume
        total_vol = float(df["amount"].sum()) if "amount" in df.columns else 0.0

        result = AnalysisResult(
            suspicious_accounts=suspicious,
            fraud_rings=fraud_rings,
            summary=Summary(
                total_accounts_analyzed=len(profiles),
                suspicious_accounts_flagged=len(suspicious),
                fraud_rings_detected=len(fraud_rings),
                total_transaction_volume=round(total_vol, 2),
                processing_time_seconds=elapsed,
            ),
        )

        # Build pattern & ring maps for graph data
        pattern_map: Dict[str, list] = {}
        ring_map: Dict[str, list] = {}
        for sa in suspicious:
            pattern_map[sa.account_id] = sa.detected_patterns
            if sa.ring_id:
                ring_map.setdefault(sa.account_id, []).append(sa.ring_id)

        gdata = build_graph_data(G, scores, ring_map, pattern_map)
        graph_cache[analysis_id] = gdata

        analyses[analysis_id] = AnalysisStatusResponse(
            analysis_id=analysis_id,
            status=AnalysisStatus.COMPLETE,
            result=result,
        )

    except Exception as exc:
        analyses[analysis_id] = AnalysisStatusResponse(
            analysis_id=analysis_id,
            status=AnalysisStatus.ERROR,
            error=str(exc),
        )


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/api/v1/analyze", response_model=UploadResponse)
async def analyze(file: UploadFile = File(...)):
    """Upload a CSV file and start analysis."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 10 MB limit.")

    try:
        df = pd.read_csv(io.BytesIO(contents))
        _validate_csv(df)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse CSV file.")

    analysis_id = str(uuid.uuid4())
    analyses[analysis_id] = AnalysisStatusResponse(
        analysis_id=analysis_id,
        status=AnalysisStatus.PROCESSING,
    )

    executor.submit(_run_analysis, analysis_id, df)

    return UploadResponse(
        analysis_id=analysis_id,
        status=AnalysisStatus.PROCESSING,
        message=f"Analysis started. {len(df)} transactions queued.",
    )


@app.get("/api/v1/analysis/{analysis_id}", response_model=AnalysisStatusResponse)
async def get_analysis(analysis_id: str):
    """Poll analysis status / retrieve results."""
    entry = analyses.get(analysis_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    return entry


@app.get("/api/v1/analysis/{analysis_id}/download")
async def download_analysis(analysis_id: str):
    """Download the analysis result as a JSON file."""
    entry = analyses.get(analysis_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    if entry.status != AnalysisStatus.COMPLETE or entry.result is None:
        raise HTTPException(status_code=400, detail="Analysis not yet complete.")

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"analysis_{ts}.json"
    content = entry.result.model_dump_json(indent=2)

    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/v1/analysis/{analysis_id}/graph", response_model=GraphData)
async def get_graph(analysis_id: str):
    """Return graph data for the frontend visualisation."""
    entry = analyses.get(analysis_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Analysis not found.")
    if entry.status != AnalysisStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Analysis not yet complete.")

    gdata = graph_cache.get(analysis_id)
    if not gdata:
        raise HTTPException(status_code=404, detail="Graph data unavailable.")
    return gdata


@app.get("/health")
async def health():
    return {"status": "ok"}
