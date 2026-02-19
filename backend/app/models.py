"""
Pydantic models for the Money Muling Detection API.
Defines request/response schemas and internal data structures.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


# ── Enums ────────────────────────────────────────────────────────────────────

class AnalysisStatus(str, Enum):
    PROCESSING = "processing"
    COMPLETE = "complete"
    ERROR = "error"


class PatternType(str, Enum):
    CYCLE = "cycle"
    SMURFING = "smurfing"
    SHELL = "shell"


class AccountType(str, Enum):
    INDIVIDUAL = "individual"
    BUSINESS = "business"


# ── Internal detection dataclasses ───────────────────────────────────────────

class CycleResult(BaseModel):
    ring_id: str
    nodes: List[str]
    length: int
    total_amount: float
    time_span_hours: float
    edge_count: int
    pattern_type: str = "cycle"


class SmurfingResult(BaseModel):
    account_id: str
    pattern_type: str  # "fan_in" | "fan_out"
    unique_counterparties: int
    total_amount: float
    velocity_per_hour: float
    window_start: datetime
    window_end: datetime
    ring_id: str = ""


class ShellResult(BaseModel):
    ring_id: str
    pattern_type: str = "shell"
    chain: List[str]
    intermediate_accounts: List[str]
    total_amount: float
    shell_depth: int
    risk_score: float = 0.0


class AccountProfile(BaseModel):
    account_id: str
    is_payroll: bool = False
    is_merchant: bool = False
    is_salary: bool = False
    is_established_business: bool = False
    account_type: AccountType = AccountType.INDIVIDUAL
    total_inflow: float = 0.0
    total_outflow: float = 0.0
    transaction_count: int = 0
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None


# ── API Response Models ──────────────────────────────────────────────────────

class SuspiciousAccount(BaseModel):
    account_id: str
    suspicion_score: float = Field(..., ge=0, le=100)
    detected_patterns: List[str]
    ring_id: str
    account_type: str = "individual"
    total_inflow: float = 0.0
    total_outflow: float = 0.0
    transaction_count: int = 0
    connected_accounts: List[str] = []
    ring_ids: List[str] = []


class FraudRing(BaseModel):
    ring_id: str
    member_accounts: List[str]
    pattern_type: str  # "cycle", "smurfing", "shell"
    risk_score: float


class Summary(BaseModel):
    total_accounts_analyzed: int
    suspicious_accounts_flagged: int
    fraud_rings_detected: int
    total_transaction_volume: float = 0.0
    processing_time_seconds: float = 0.0


class AnalysisResult(BaseModel):
    suspicious_accounts: List[SuspiciousAccount]
    fraud_rings: List[FraudRing]
    summary: Summary


class AnalysisStatusResponse(BaseModel):
    analysis_id: str
    status: AnalysisStatus
    result: Optional[AnalysisResult] = None
    error: Optional[str] = None


class UploadResponse(BaseModel):
    analysis_id: str
    status: AnalysisStatus
    message: str


# ── Graph data for frontend ─────────────────────────────────────────────────

class GraphNode(BaseModel):
    id: str
    suspicion_score: float = 0.0
    ring_ids: List[str] = []
    total_inflow: float = 0.0
    total_outflow: float = 0.0
    transaction_count: int = 0
    detected_patterns: List[str] = []


class GraphEdge(BaseModel):
    source: str
    target: str
    amount: float
    transaction_count: int = 1


class GraphData(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]
