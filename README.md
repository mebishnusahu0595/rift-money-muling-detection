# 🔍 Money Muling Detector — PWIOI

> AI-powered financial fraud detection system that identifies money muling rings, smurfing patterns, and shell account networks from transaction data — visualized as an interactive graph.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![C++](https://img.shields.io/badge/C%2B%2B-20-blue?logo=cplusplus)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)

---

## 🌐 Live Demo

> **URL:** *(Deploy URL — e.g., `https://pwioi.vercel.app`)*  
> Upload any CSV with the format below and get instant fraud analysis.

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + TypeScript + Vite |
| **Graph Visualization** | Cytoscape.js (`react-cytoscapejs`) |
| **Backend** | C++20 (Crow HTTP Server) |
| **Data Structures** | Custom Red-Black Tree, Decision Tree |
| **Styling** | Vanilla CSS + CSS Variables |
| **Build System** | CMake 3.16+ |
| **HTTP Client** | Axios |
| **JSON** | nlohmann/json |

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     React Frontend (Vite)                     │
│                                                              │
│   Dashboard.tsx → useAnalysis.ts → Axios → REST API         │
│        ↓                                                     │
│   GraphViz.tsx (Cytoscape.js)  ←  Graph JSON Response       │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP (multipart/form-data upload)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│               C++ Backend (Crow HTTP, port 8000)             │
│                                                              │
│  POST /api/v1/analyze  →  AnalysisEngine::run()             │
│                                ↓                            │
│          ┌─────────────────────────────────────┐            │
│          │         Analysis Pipeline            │            │
│          │                                     │            │
│          │  1. CSV Parser                      │            │
│          │  2. TransactionGraph (adjacency)    │            │
│          │  3. Parallel Detection:             │            │
│          │     ├─ CycleDetector (DFS + RBTree) │            │
│          │     ├─ SmurfingDetector (RBTree)    │            │
│          │     └─ ShellDetector (BFS)          │            │
│          │  4. AccountProfile Builder          │            │
│          │  5. Filters (false-positive guard)  │            │
│          │  6. DecisionTree Scorer             │            │
│          │  7. FraudRing Assembler             │            │
│          │  8. GraphData Builder               │            │
│          └─────────────────────────────────────┘            │
│                                                              │
│  GET /api/v1/analysis/{id}      → Poll status               │
│  GET /api/v1/analysis/{id}/download → JSON report           │
│  GET /api/v1/analysis/{id}/graph    → Graph viz data        │
└──────────────────────────────────────────────────────────────┘
```

---

## 📂 Folder Structure

```
PWIOI/
├── cpp-backend/                  # C++20 Crow HTTP server
│   ├── src/
│   │   └── main.cpp              # Routes + server entry point
│   ├── include/
│   │   └── money_muling/ 
│   │       ├── models.h          # All data structs (Transaction, GraphNode…)
│   │       ├── analysis_engine.h # Pipeline orchestrator
│   │       ├── csv_parser.h      # Flexible CSV reader with column remapping
│   │       ├── graph_engine.h    # TransactionGraph adjacency-list
│   │       ├── red_black_tree.h  # Custom RBT for O(log n) time queries
│   │       ├── decision_tree.h   # Rule-based suspicion scorer
│   │       ├── cycle_detector.h  # DFS cycle finder (length 3–5)
│   │       ├── smurfing_detector.h # Fan-in/fan-out O(N log N)
│   │       ├── shell_detector.h  # BFS layered shell network finder
│   │       ├── filters.h         # False-positive reduction
│   │       ├── scoring.h         # SuspiciousAccount + FraudRing builder
│   │       ├── json_serializer.h # nlohmann/json serialization
│   │       └── store.h           # Thread-safe in-memory result store
│   └── CMakeLists.txt
│
├── frontend/                     # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/
│   │   │   ├── GraphViz.tsx      # Cytoscape.js interactive graph
│   │   │   ├── Aurora.tsx        # Animated background (WebGL)
│   │   │   └── Logo.tsx
│   │   ├── pages/
│   │   │   └── Dashboard.tsx     # Main UI: upload, results, filters
│   │   ├── hooks/
│   │   │   └── useAnalysis.ts    # Upload + polling state machine
│   │   └── types/
│   │       └── index.ts          # Shared TypeScript types
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── test-data/                    # Sample CSVs for testing
│   ├── cycle_fraud.csv
│   ├── smurfing_fraud.csv
│   ├── shell_fraud.csv
│   ├── mixed_fraud.csv
│   ├── merchant_trap.csv         # Legitimate merchant (should NOT flag)
│   └── clean_transactions.csv
│
└── README.md
```

---

## 🧠 Algorithm Approach

### 1. Cycle Detection — Circular Fund Routing
**Algorithm:** DFS-based simple cycle enumeration  
**Finds:** Cycles of length 3–5 where all edges occur within a configured time window

| Optimization | Detail |
|---|---|
| Path membership | `unordered_set` → O(1) vs O(depth) linear |
| Early termination | Max 30,000 DFS frames per root node |
| Node ordering | Sorted by out-degree descending → hubs found first |
| Temporal filter | RBT range query on timestamps |

**Complexity:** O(N × min(branches, cap) × depth) ≈ **O(N log N)** in practice

### 2. Smurfing Detection — Fan-in / Fan-out
**Algorithm:** Sliding window with counterparty frequency map  
**Finds:** Accounts with ≥10 unique counterparties within a time window

| Phase | Complexity |
|---|---|
| RBT build (global sort) | O(N log N) |
| Sliding window per account | **O(N) amortised** via frequency map |
| Total | **O(N log N)** |

> Previous implementation was O(N²) per account — now 10-100× faster.

### 3. Shell Network Detection — Layered Accounts
**Algorithm:** BFS path enumeration from sources to sinks  
**Finds:** Chains of 3–6 hops where intermediate accounts have ≤3 total transactions and pass-through flow ratio ≥0.5

**Complexity:** O(V + E) per source, capped at 2,000 paths total

### 4. False-Positive Filters
| Filter | Criteria |
|---|---|
| Payroll | Single dominant sender, monthly interval (25–35 days), low amount variance (CV < 10%) |
| Merchant | ≥20 inflows, average outflow > average inflow, ≥30% round-number amounts |
| Salary | Monthly large deposits + ≥3 regular outflows |
| Established Business | ≥180 days history, ≥10 unique counterparties, known business name pattern |

---

## 📊 Suspicion Score Methodology

Scores are computed by a **Decision Tree** on pre-built lookup maps:

```
Score = Σ(pattern scores) − Σ(legitimacy reductions)
Clamped to [0, 100]
```

| Signal | Score Contribution |
|---|---|
| Cycle of length 3 | +60 |
| Cycle of length 4 | +40 |
| Cycle of length 5 | +20 |
| Cycle total > $10,000 | +10 bonus |
| Smurfing base | +15 |
| >20 unique counterparties | +5 |
| Velocity > 5,000/hr | +10 |
| Shell chain (per node) | +25 × depth |

| Legitimacy Deduction | Reduction |
|---|---|
| Payroll account | −30 |
| Merchant account | −25 |
| Salary account | −20 |
| Established business | −35 |

Accounts with `suspicion_score ≥ 25` are flagged as suspicious.

---

## 📥 CSV Input Format

```csv
transaction_id,sender_id,receiver_id,amount,timestamp
TXN_001,ACC_A,ACC_B,5000.00,2024-01-15 10:30:00
TXN_002,ACC_B,ACC_C,4950.00,2024-01-15 14:22:00
TXN_003,ACC_C,ACC_A,4900.00,2024-01-15 18:45:00
```

| Column | Type | Description |
|---|---|---|
| `transaction_id` | String | Unique transaction ID |
| `sender_id` | String | Sending account (graph node) |
| `receiver_id` | String | Receiving account (graph node) |
| `amount` | Float | Transaction amount |
| `timestamp` | DateTime | `YYYY-MM-DD HH:MM:SS` or ISO 8601 |

---

## 📤 JSON Output Format (Download)

```json
{
  "suspicious_accounts": [
    {
      "account_id": "ACC_00123",
      "suspicion_score": 87.5,
      "detected_patterns": ["cycle_length_3", "high_velocity"],
      "ring_id": "RING_001"
    }
  ],
  "fraud_rings": [
    {
      "ring_id": "RING_001",
      "member_accounts": ["ACC_00123", "ACC_00456"],
      "pattern_type": "cycle",
      "risk_score": 95.3
    }
  ],
  "summary": {
    "total_accounts_analyzed": 500,
    "suspicious_accounts_flagged": 15,
    "fraud_rings_detected": 4,
    "processing_time_seconds": 2.3
  }
}
```

---

## 🚀 Installation & Setup

### Prerequisites
- **C++20** compiler (GCC 11+ / Clang 13+)
- **CMake** 3.16+
- **Node.js** 18+ and npm
- **Crow** HTTP library + **nlohmann/json** (fetched by CMake)

### Backend

```bash
cd cpp-backend

# Configure and build (Release mode)
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)

# Run (defaults to port 8000)
./build/money_muling_detector

# Or with custom port
PORT=8080 ./build/money_muling_detector
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Set backend URL (create .env.local)
echo "VITE_API_URL=http://localhost:8000" > .env.local

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 📖 Usage Instructions

1. **Open** the web app in your browser
2. **Upload** a CSV file matching the format above (drag & drop or click)
3. **Wait** for analysis — a live timer shows progress (typically 1–5 seconds for 10K rows)
4. **Explore** the interactive graph:
   - 🔴 Red/large nodes = high suspicion
   - 🟡 Orange nodes = medium suspicion  
   - ⚪ Small nodes = normal accounts
   - **Click** a node to see full account details
   - **Hover** over fraud ring IDs in the sidebar to highlight members
5. **Filter** the graph using the sidebar:
   - Pattern type (cycle / fan_in / fan_out / shell)
   - Minimum transaction amount
   - Max Visible Nodes (for huge datasets)
6. **Download** the JSON report using the download button

---

## ⚡ Performance

| Dataset Size | Processing Time |
|---|---|
| 1,000 rows | ~0.5 seconds |
| 5,000 rows | ~1–2 seconds |
| 10,000 rows | ~3–5 seconds |

Parallel pattern detection (cycles + smurfing + shells run concurrently via `std::async`) plus RBT-based O(N log N) algorithms makes large datasets feasible well within the 30-second requirement.

---

## ⚠️ Known Limitations

- **In-memory store** — analysis results are lost on server restart (no database persistence)
- **Single-threaded Crow** — concurrent uploads share one analysis queue; suitable for demo use
- **Cycle cap** — capped at 5,000 cycles maximum to prevent memory exhaustion on highly-connected graphs
- **Shell detection** — requires explicit source→sink topology; disconnected subgraphs may reduce recall
- **Timestamp parsing** — assumes UTC for all timestamps; local timezone offsets are not corrected
- **False positive rate** — legitimacy filters use heuristics; unusual-but-legitimate high-velocity accounts may be flagged

---

## 👥 Team Members

| Name | Role |
|---|---|
| Bishnu Prasad Sahu | Full-stack dev · C++ backend · Graph algorithms |

---

## 📄 License

MIT © 2024 PWIOI Team
