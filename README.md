# Money Muling Detector

> Graph-Based Financial Crime Detection Engine — **RIFT 2026 Hackathon**  
> Graph Theory / Financial Crime Detection Track

A full-stack web application that processes transaction CSV data, builds a directed account graph, and exposes money muling networks through multi-pattern detection algorithms, interactive graph visualisation, and a downloadable JSON forensic report.

---

## Live Demo

🔗 **[https://your-deployment-url.com](https://your-deployment-url.com)** *(update with deployed URL)*

---

## Team Members

| Name | Role |
|------|------|
| *(your name here)* | Full-stack & Graph Algorithms |

---

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Python 3.11, FastAPI 0.104, uvicorn |
| Graph Engine | NetworkX 3.2 (Johnson's algo, BFS/DFS) |
| Data Processing | pandas 2.1, NumPy 1.26 |
| Schema Validation | Pydantic v2 |
| Frontend | React 18, TypeScript 5.3, Vite 5 |
| Graph Visualisation | Cytoscape.js 3.28 |
| Styling | Tailwind CSS 3.4 |
| HTTP Client | Axios 1.6 |

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        Browser (React)                         │
│  FileUpload → useAnalysis hook (upload + poll) → Dashboard     │
│  GraphViz (Cytoscape.js) │ RingTable │ NodeDetails │ JSON DL   │
└──────────────────────────┬─────────────────────────────────────┘
                           │ HTTP  (proxy /api → :8000)
┌──────────────────────────▼─────────────────────────────────────┐
│                    FastAPI Backend (:8000)                      │
│  POST /api/v1/analyze  →  ThreadPoolExecutor (workers=4)       │
│           ┌──────────────────────────────────────┐             │
│           │         Analysis Pipeline            │             │
│           │  1. graph_builder  →  NetworkX Graph │             │
│           │  2. cycle_detector →  Johnson's algo │             │
│           │  3. smurfing_detector → sliding win  │             │
│           │  4. shell_detector →  BFS/DFS paths  │             │
│           │  5. filters        →  FP reduction   │             │
│           │  6. scoring        →  0–100 scores   │             │
│           └──────────────────────────────────────┘             │
│  In-memory dict store (analyses + graph_cache)                 │
└────────────────────────────────────────────────────────────────┘
```

**Project structure:**
```
money-muling-detector/
├── backend/app/
│   ├── main.py              # FastAPI endpoints
│   ├── models.py            # Pydantic schemas
│   ├── graph_builder.py     # CSV → NetworkX MultiDiGraph
│   ├── scoring.py           # Suspicion scoring
│   ├── filters.py           # False-positive reduction
│   └── detectors/
│       ├── cycle_detector.py
│       ├── smurfing_detector.py
│       └── shell_detector.py
├── frontend/src/
│   ├── pages/Dashboard.tsx
│   ├── components/          # FileUpload, GraphViz, RingTable, NodeDetails, JsonDownload
│   ├── hooks/useAnalysis.ts
│   └── types/index.ts
└── test-data/               # 6 sample CSVs
```

---

## Algorithm Approach & Complexity Analysis

### 1. Graph Construction — `O(E)`
Convert CSV rows into a `NetworkX.MultiDiGraph`. Each unique account is a node, each transaction is a directed edge. Per-node aggregates (total inflow/outflow, transaction count) computed via vectorised `pandas.groupby` — `O(E)`.

### 2. Cycle Detection (Circular Fund Routing) — `O((V + E)(C + 1))`
Uses **Johnson's algorithm** via `nx.simple_cycles(G, length_bound=5)`.
- Searches only for simple cycles of length 3–5 (mule rings rarely exceed 5 hops)
- Applies **72-hour temporal coherence filter**: all transaction timestamps in a cycle must fall within a 72h window
- Safety cap: `_MAX_CYCLES = 5000` to prevent combinatorial blowup on dense graphs
- `C` = number of elementary circuits found

### 3. Smurfing Detection (Fan-in / Fan-out) — `O(E log E)`
**Two-pointer sliding window** on time-sorted transactions:
- Per account, sort transactions by timestamp: `O(k log k)`
- Slide a 72-hour window, track unique counterparty set
- Flag when unique counterparties ≥ 10 within any window
- Overall: `O(E log E)` dominated by the global timestamp sort

### 4. Shell Network Detection — `O(V² · P)` (pruned BFS)
- Pre-identify shell candidates: nodes with `transaction_count ≤ 3`
- BFS/DFS via `nx.all_simple_paths(cutoff=6)` between source/sink pairs
- Only accept paths where **all intermediate nodes are shell candidates** AND pass-through ratio > 50% (inflow ≈ outflow)
- Safety cap: `_MAX_PATHS = 2000`, 200 paths per source/sink pair

### 5. False-Positive Filters — `O(E)`
Heuristic deductions applied post-scoring:
- **Payroll**: dominant sender (>80% of inflows), ±10% amount variance, 25–35 day cadence
- **Merchant**: ≥20 inflows, avg outflow > avg inflow, >30% round-number pricing amounts
- **Salary**: single large recurring monthly deposit + regular outgoing
- **Established Business**: ≥180 day history, ≥10 diverse counterparties, or business keyword in account ID

---

## Suspicion Score Methodology

Every account receives a score in **[0, 100]**:

```
# Cycle contribution (per cycle membership):
+20 × (6 − cycle_length)     # shorter cycles are more suspicious
+10                           # bonus if cycle total > $10,000

# Smurfing contribution (per fan event):
+15  base
+5   if unique counterparties > 20
+10  if velocity > $5,000 / hour

# Shell contribution (intermediary nodes only):
+25  flat per chain

# False-positive deductions:
−30  payroll  │  −25 merchant  │  −20 salary  │  −35 established business

score = clamp(score, 0, 100), rounded to 1 decimal
```

**Pattern tags produced:**

| Tag | Meaning |
|-----|---------|
| `cycle_length_3` … `cycle_length_5` | Member of a cycle of that length |
| `high_value_cycle` | Cycle total > $10,000 |
| `fan_in` | Receives from 10+ senders in 72h |
| `fan_out` | Sends to 10+ receivers in 72h |
| `high_velocity` | Transaction velocity > $5,000/hour |
| `structuring` | 20+ unique counterparties (threshold evasion) |
| `shell_depth_N` | Intermediate node in an N-hop shell chain |

---

## Installation & Setup

### Prerequisites
- Python 3.11+ and Node.js 18+

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API → `http://localhost:8000` · Swagger docs → `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App → `http://localhost:5173`

> For production deployment set `VITE_API_URL=https://your-backend.com` in `frontend/.env`

---

## Usage Instructions

1. Open the app in your browser
2. Drag-and-drop or click to upload a `.csv` transaction file
3. Click **Analyze Transactions** — results appear within seconds
4. **Graph panel**: red = high risk (>70), yellow = medium (30–70), grey = low. Click any node for details
5. **Fraud Rings table**: sortable by ring ID, pattern type, member count, risk score
6. Click **Download JSON** for the full machine-readable forensic report

### Accepted CSV Format

```csv
transaction_id,sender_id,receiver_id,amount,timestamp
TXN001,ACC_001,ACC_002,5000.00,2024-01-15 10:30:00
```

Columns `sender_id` / `receiver_id` are the canonical names (per RIFT spec). Bare `sender` / `receiver` columns are also accepted automatically.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/analyze` | Upload CSV; returns `analysis_id` immediately |
| `GET` | `/api/v1/analysis/{id}` | Poll status; returns full result when `status=complete` |
| `GET` | `/api/v1/analysis/{id}/download` | Stream JSON report as file download |
| `GET` | `/api/v1/analysis/{id}/graph` | Graph node/edge data for Cytoscape.js |
| `GET` | `/health` | `{"status": "ok"}` |

---

## Test Data

| File | Scenario |
|------|----------|
| `clean_transactions.csv` | Normal activity — no rings expected |
| `cycle_fraud.csv` | Circular routing (3–4 node rings) |
| `smurfing_fraud.csv` | Fan-in aggregation + fan-out dispersal |
| `shell_fraud.csv` | Layered shell network (3–5 hops) |
| `mixed_fraud.csv` | Overlapping cycle + smurfing patterns |
| `merchant_trap.csv` | Legitimate merchant — false-positive suppression test |

---

## Known Limitations

1. **In-memory store** — results are lost on server restart; replace with Redis for production
2. **Scale** — `ThreadPoolExecutor(max_workers=4)` suits demo scale; use Celery + Redis for production throughput
3. **10K transaction target** — dense graphs (>50K edges) may approach the 30s budget due to shell path enumeration
4. **72h window sensitivity** — slow-burn laundering schemes operating over weeks may be missed
5. **USD-centric thresholds** — $10,000 and $5,000/hr thresholds assume USD; multi-currency data needs normalisation
6. **No deduplication** — uploading the same file twice creates two separate analyses
7. **Smurfing ring ID ordering** — IDs are assigned after cycle/shell processing, so numbering may differ across runs if concurrency timing varies

---

*Built for RIFT 2026 Hackathon · Graph Theory / Financial Crime Detection Track*
