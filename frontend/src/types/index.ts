/* ── API / Domain Types ─────────────────────────────────────────────────── */

export interface SuspiciousAccount {
  account_id: string;
  suspicion_score: number;
  detected_patterns: string[];
  ring_id: string;
  /* Enriched fields from graph / profile data */
  account_type: string;
  total_inflow: number;
  total_outflow: number;
  transaction_count: number;
  connected_accounts: string[];
  ring_ids: string[];
}

export interface FraudRing {
  ring_id: string;
  member_accounts: string[];
  pattern_type: "cycle" | "smurfing" | "shell" | "fan_in" | "fan_out";
  risk_score: number;
}

export interface Summary {
  total_accounts_analyzed: number;
  suspicious_accounts_flagged: number;
  fraud_rings_detected: number;
  total_transaction_volume: number;
  processing_time_seconds: number;
}

export interface AnalysisResult {
  suspicious_accounts: SuspiciousAccount[];
  fraud_rings: FraudRing[];
  summary: Summary;
}

export interface AnalysisStatusResponse {
  analysis_id: string;
  status: "processing" | "complete" | "error";
  result?: AnalysisResult;
  error?: string;
}

export interface UploadResponse {
  analysis_id: string;
  status: string;
  message: string;
}

/* ── Graph data ────────────────────────────────────────────────────────── */

export interface GraphNode {
  id: string;
  suspicion_score: number;
  ring_ids: string[];
  total_inflow: number;
  total_outflow: number;
  transaction_count: number;
  detected_patterns: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  amount: number;
  transaction_count: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
