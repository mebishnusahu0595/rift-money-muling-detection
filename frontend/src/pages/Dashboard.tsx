import React, { useState, useCallback, useRef, useMemo } from "react";
import FileUpload from "../components/FileUpload";
import GraphViz from "../components/GraphViz";
import RingTable from "../components/RingTable";
import JsonDownload from "../components/JsonDownload";
import { useAnalysis } from "../hooks/useAnalysis";
import type { SuspiciousAccount } from "../types";

// ── tiny icon helpers ────────────────────────────────────────────────────────
const IconGlobe = () => (
  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>
  </svg>
);
const IconWarn = () => (
  <svg className="h-5 w-5 text-yellow-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
  </svg>
);
const IconRing = () => (
  <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="5"/>
  </svg>
);
const IconBolt = () => (
  <svg className="h-5 w-5 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>
);
const IconUpload = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4"/>
  </svg>
);
const IconChevron = () => (
  <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
  </svg>
);
const IconNetwork = () => (
  <svg className="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/>
    <path d="M7 12h5m2-5.5L12 12m2 5.5L12 12"/>
  </svg>
);

// ── score badge ──────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const bg = score > 70 ? "bg-red-600" : score > 40 ? "bg-yellow-600" : "bg-green-700";
  const label = score > 70 ? "HIGH" : score > 40 ? "MED" : "LOW";
  return (
    <div className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg ${bg}`}>
      <span className="text-sm font-bold leading-none text-white">{score}</span>
      <span className="text-[9px] font-semibold text-white/80">{label}</span>
    </div>
  );
}

const Dashboard: React.FC = () => {
  const { uploading, polling, analysisId, result, graphData, error, upload, downloadJson } =
    useAnalysis();

  const [selectedAccount, setSelectedAccount] = useState<SuspiciousAccount | null>(null);
  const [zoomToNodes, setZoomToNodes] = useState<string[] | undefined>(undefined);
  const [minAmount, setMinAmount] = useState(0);
  const [patternFilter, setPatternFilter] = useState("all");
  const lastClickedNodeRef = useRef<string | null>(null);
  const lastClickedRingRef = useRef<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);

  /* ── Filtered graph data based on sidebar filters ── */
  const filteredGraphData = useMemo(() => {
    if (!graphData || !result) return graphData;
    let nodes = graphData.nodes;
    let edges = graphData.edges;

    // Pattern filter — keep members of matching rings + their direct neighbours
    if (patternFilter !== "all") {
      const matchingRings = result.fraud_rings.filter(
        (r) => r.pattern_type === patternFilter
      );
      const ringMembers = new Set(matchingRings.flatMap((r) => r.member_accounts));
      const neighbours = new Set<string>();
      edges.forEach((e) => {
        if (ringMembers.has(e.source)) neighbours.add(e.target);
        if (ringMembers.has(e.target)) neighbours.add(e.source);
      });
      const visible = new Set([...ringMembers, ...neighbours]);
      nodes = nodes.filter((n) => visible.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }

    // Min amount filter
    if (minAmount > 0) {
      edges = edges.filter((e) => e.amount >= minAmount);
      const connected = new Set<string>();
      edges.forEach((e) => {
        connected.add(e.source);
        connected.add(e.target);
      });
      nodes = nodes.filter((n) => connected.has(n.id));
    }

    if (nodes === graphData.nodes && edges === graphData.edges) return graphData;
    return { nodes, edges };
  }, [graphData, result, patternFilter, minAmount]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (!result) return;

      // Toggle zoom: same node → zoom out; different node → zoom in
      if (lastClickedNodeRef.current === nodeId) {
        lastClickedNodeRef.current = null;
        lastClickedRingRef.current = null;
        setZoomToNodes([]); // empty = fit all
      } else {
        lastClickedNodeRef.current = nodeId;
        lastClickedRingRef.current = null;
        setZoomToNodes([nodeId]);
      }

      const suspicious = result.suspicious_accounts.find((a) => a.account_id === nodeId);
      if (suspicious) { setSelectedAccount(suspicious); return; }
      const graphNode = graphData?.nodes.find((n) => n.id === nodeId);
      if (graphNode) {
        setSelectedAccount({
          account_id: graphNode.id,
          suspicion_score: graphNode.suspicion_score,
          detected_patterns: graphNode.detected_patterns,
          ring_id: "",
          account_type: "individual",
          total_inflow: graphNode.total_inflow,
          total_outflow: graphNode.total_outflow,
          transaction_count: graphNode.transaction_count,
          connected_accounts: [],
          ring_ids: graphNode.ring_ids,
        });
      }
    },
    [result, graphData]
  );

  const handleRingClick = useCallback(
    (ringId: string) => {
      if (!result) return;

      // Toggle zoom: same ring → zoom out; different ring → zoom in
      if (lastClickedRingRef.current === ringId) {
        lastClickedRingRef.current = null;
        lastClickedNodeRef.current = null;
        setZoomToNodes([]); // empty = fit all
        return;
      }

      const ring = result.fraud_rings.find((r) => r.ring_id === ringId);
      if (ring && ring.member_accounts.length > 0) {
        lastClickedRingRef.current = ringId;
        lastClickedNodeRef.current = null;
        setZoomToNodes([...ring.member_accounts]);
        const acct = result.suspicious_accounts.find((a) => a.account_id === ring.member_accounts[0]) ?? null;
        setSelectedAccount(acct);
      }
    },
    [result]
  );

  const handleAccountListClick = useCallback(
    (acct: SuspiciousAccount) => {
      setSelectedAccount(acct);
      lastClickedNodeRef.current = acct.account_id;
      setZoomToNodes([acct.account_id]);
    },
    []
  );

  const isAnalysing = uploading || polling;

  const filteredRings = result?.fraud_rings.filter(
    (r) => patternFilter === "all" || r.pattern_type === patternFilter
  ) ?? [];

  const patternTypes = result
    ? Array.from(new Set(result.fraud_rings.map((r) => r.pattern_type)))
    : [];

  const suspiciousSorted = result
    ? [...result.suspicious_accounts].sort((a, b) => b.suspicion_score - a.suspicion_score)
    : [];

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d1117] text-gray-100">
      {/* ── LEFT SIDEBAR ─────────────────────────────────────────── */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-[#10161e]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 border-b border-gray-800 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
            <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            </svg>
          </div>
          <div>
            <p className="text-xs font-bold leading-none text-white">Financial Forensics</p>
            <p className="text-[10px] text-gray-500">Money Muling v1.0</p>
          </div>
        </div>

        {/* Upload area */}
        <div className="p-3">
          <FileUpload onUpload={upload} uploading={uploading} polling={polling} />
        </div>

        {/* Status */}
        {isAnalysing && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-blue-950/60 px-3 py-2 text-xs text-blue-300">
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
            Analysing…
          </div>
        )}

        {result && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-green-950/60 px-3 py-2 text-xs text-green-400">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400"/>
            Complete
          </div>
        )}

        {/* Filters */}
        {result && (
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2M13 16h-2"/>
              </svg>
              Filters
            </p>

            <label className="mb-1 block text-[10px] text-gray-400">Pattern Type</label>
            <select
              value={patternFilter}
              onChange={(e) => setPatternFilter(e.target.value)}
              className="mb-3 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 focus:outline-none"
            >
              <option value="all">All Patterns</option>
              {patternTypes.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>

            <label className="mb-1 block text-[10px] text-gray-400">Min Transaction Amount (₹)</label>
            <input
              type="number"
              min={0}
              value={minAmount}
              onChange={(e) => setMinAmount(Number(e.target.value))}
              className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 focus:outline-none"
              placeholder="0"
            />
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-800 px-3 py-2 text-[9px] text-gray-600">
          RIFT 2026 · Financial Forensics
        </div>
      </aside>

      {/* ── MAIN AREA ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex shrink-0 items-center justify-between border-b border-gray-800 bg-[#10161e] px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-100">Financial Forensics Engine</span>
            {result && (
              <span className="flex items-center gap-1 rounded-full bg-green-900/50 px-2 py-0.5 text-[10px] font-medium text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400"/>Complete
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {result && analysisId && (
              <JsonDownload analysisId={analysisId} onDownload={downloadJson} />
            )}
            <button
              onClick={() => document.getElementById("csv-input-trigger")?.click()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
            >
              <IconUpload /> Upload CSV
            </button>
          </div>
        </header>

        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-red-800 bg-red-900/30 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* No result — centered upload prompt */}
        {!result && !isAnalysing && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-gray-500">
            <svg className="h-12 w-12 text-gray-700" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6M5 21h14a2 2 0 002-2V7l-5-5H5a2 2 0 00-2 2v15a2 2 0 002 2z"/>
            </svg>
            <p className="text-sm">Upload a CSV from the sidebar and click <strong className="text-gray-300">Run Detection</strong></p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Center column */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-4 gap-3">
              {/* Stats row */}
              <div className="grid shrink-0 grid-cols-4 gap-3">
                {([
                  ["ACCOUNTS ANALYZED", result.summary.total_accounts_analyzed, "text-white", <IconGlobe key="g"/>],
                  ["SUSPICIOUS FLAGGED", result.summary.suspicious_accounts_flagged, "text-yellow-400", <IconWarn key="w"/>],
                  ["FRAUD RINGS DETECTED", result.summary.fraud_rings_detected, "text-red-400", <IconRing key="r"/>],
                  ["PROCESSING TIME", `${result.summary.processing_time_seconds.toFixed(2)}s`, "text-green-400", <IconBolt key="b"/>],
                ] as [string, string | number, string, React.ReactNode][]).map(([label, value, color, icon]) => (
                  <div key={label} className="rounded-xl border border-gray-800 bg-[#161c26] px-4 py-3">
                    <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                      <span>{label}</span>{icon}
                    </div>
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Transaction Flow Map (graph) */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-800 bg-[#161c26]">
                <div className="flex shrink-0 items-center gap-3 border-b border-gray-800 px-4 py-2.5">
                  <IconNetwork />
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">Transaction Flow Map</span>
                  <span className="rounded-full bg-blue-900/60 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                    {result.summary.total_accounts_analyzed} ACCOUNTS
                  </span>
                </div>
                <div className="min-h-0 flex-1">
                  {filteredGraphData ? (
                    <GraphViz
                      data={filteredGraphData}
                      onNodeClick={handleNodeClick}
                      zoomTo={zoomToNodes}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-600">Loading graph…</div>
                  )}
                </div>
              </div>

              {/* Ring table */}
              <div className="shrink-0 flex flex-col" style={{ maxHeight: "18rem" }}>
                <div className="mb-2 flex items-center gap-2 shrink-0">
                  <svg className="h-3.5 w-3.5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Network Graph</span>
                  {filteredRings.length > 0 && (
                    <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[9px] font-bold text-gray-400">
                      {filteredRings.length}
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <RingTable rings={filteredRings} onRingClick={handleRingClick} />
                </div>
              </div>
            </div>

            {/* Right sidebar — suspicious accounts + detail */}
            <aside className="flex w-64 shrink-0 flex-col border-l border-gray-800 bg-[#10161e] overflow-hidden">
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-3 py-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-yellow-400">
                  <IconWarn />
                  <span className="uppercase tracking-wider">Suspicious Accounts</span>
                </div>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500 text-[10px] font-bold text-black">
                  {suspiciousSorted.length}
                </span>
              </div>

              {selectedAccount ? (
                /* ── DETAIL VIEW ── */
                <div className="flex flex-1 flex-col overflow-y-auto">
                  {/* Back button */}
                  <button
                    onClick={() => setSelectedAccount(null)}
                    className="flex shrink-0 items-center gap-1.5 border-b border-gray-800 px-3 py-2 text-[11px] text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                    </svg>
                    Back to list
                  </button>

                  {/* Account ID + score */}
                  <div className="border-b border-gray-800 px-4 py-3">
                    <div className="mb-1 flex items-center gap-2">
                      <ScoreBadge score={selectedAccount.suspicion_score} />
                      <div>
                        <p className="font-bold text-sm text-gray-100">{selectedAccount.account_id}</p>
                        <p className="text-[10px] text-gray-500 capitalize">{selectedAccount.account_type.replace(/_/g, " ")}</p>
                      </div>
                    </div>
                    {/* Score bar */}
                    <div className="mt-2 h-1.5 w-full rounded-full bg-gray-800">
                      <div
                        className={`h-full rounded-full ${selectedAccount.suspicion_score > 70 ? "bg-red-500" : selectedAccount.suspicion_score > 30 ? "bg-yellow-500" : "bg-green-500"}`}
                        style={{ width: `${selectedAccount.suspicion_score}%` }}
                      />
                    </div>
                  </div>

                  {/* Patterns */}
                  <div className="border-b border-gray-800 px-4 py-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Detected Patterns</p>
                    {selectedAccount.detected_patterns.length === 0
                      ? <span className="text-[11px] text-gray-600">None detected</span>
                      : <div className="flex flex-wrap gap-1.5">
                          {selectedAccount.detected_patterns.map((p, i) => (
                            <span key={i} className="rounded-full bg-red-900/40 border border-red-800/50 px-2 py-0.5 text-[10px] font-medium text-red-300">
                              {p.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                    }
                  </div>

                  {/* Ring membership */}
                  <div className="border-b border-gray-800 px-4 py-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Ring Membership</p>
                    {(selectedAccount.ring_ids?.length ?? 0) === 0 && !selectedAccount.ring_id
                      ? <span className="text-[11px] text-gray-600">No ring</span>
                      : <div className="flex flex-wrap gap-1.5">
                          {(selectedAccount.ring_ids?.length > 0
                            ? selectedAccount.ring_ids
                            : selectedAccount.ring_id ? [selectedAccount.ring_id] : []
                          ).map((r) => (
                            <span key={r} className="rounded-full bg-blue-900/40 border border-blue-800/50 px-2 py-0.5 text-[10px] font-medium text-blue-300">{r}</span>
                          ))}
                        </div>
                    }
                  </div>

                  {/* Transaction stats */}
                  <div className="px-4 py-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Transaction Summary</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-lg bg-gray-900/60 px-3 py-2">
                        <span className="text-[11px] text-gray-400">Inflow</span>
                        <span className="font-bold text-sm text-green-400">₹{selectedAccount.total_inflow.toLocaleString("en-IN")}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-gray-900/60 px-3 py-2">
                        <span className="text-[11px] text-gray-400">Outflow</span>
                        <span className="font-bold text-sm text-red-400">₹{selectedAccount.total_outflow.toLocaleString("en-IN")}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-gray-900/60 px-3 py-2">
                        <span className="text-[11px] text-gray-400">Tx Count</span>
                        <span className="font-bold text-sm text-gray-100">{selectedAccount.transaction_count}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg bg-gray-900/60 px-3 py-2">
                        <span className="text-[11px] text-gray-400">Account Type</span>
                        <span className="font-bold text-sm text-gray-100 capitalize">{selectedAccount.account_type.replace(/_/g, " ")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* ── LIST VIEW ── */
                <div className="flex-1 overflow-y-auto">
                  {suspiciousSorted.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-gray-600">No suspicious accounts</div>
                  ) : suspiciousSorted.map((acct) => (
                    <button
                      key={acct.account_id}
                      onClick={() => handleAccountListClick(acct)}
                      className="flex w-full items-center gap-2 border-b border-gray-800/60 px-3 py-2.5 text-left transition-colors hover:bg-gray-800/60"
                    >
                      <ScoreBadge score={acct.suspicion_score} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-gray-100">{acct.account_id}</p>
                        <p className="truncate text-[10px] text-gray-500">
                          {acct.ring_ids?.[0] ?? acct.ring_id ?? "—"}
                          {acct.detected_patterns[0] && (
                            <span className="ml-1 text-blue-400">{acct.detected_patterns[0].replace(/_/g, " ")}</span>
                          )}
                        </p>
                      </div>
                      <IconChevron />
                    </button>
                  ))}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      {/* ── WELCOME POPUP ── */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-gray-700 bg-gradient-to-b from-[#1a2332] to-[#0d1117] shadow-2xl">
            {/* Header illustration */}
            <div className="relative flex h-44 items-center justify-center overflow-hidden bg-gradient-to-br from-blue-600/20 via-indigo-600/20 to-purple-600/20">
              <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-blue-500/10" />
              <div className="absolute -right-10 bottom-0 h-32 w-32 rounded-full bg-indigo-500/10" />
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
                <svg className="h-12 w-12 text-white" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </div>
            </div>
            {/* Content */}
            <div className="px-8 py-6 text-center">
              <h2 className="mb-1 text-xl font-bold text-white">Financial Forensics Engine</h2>
              <p className="mb-4 text-sm text-gray-400">Money Muling Detection System v1.0</p>
              <p className="mb-5 text-xs leading-relaxed text-gray-500">
                Upload transaction CSVs to detect fraud rings, money muling patterns, and
                suspicious accounts using advanced network analysis and graph-based detection.
              </p>
              <div className="mb-6 flex flex-wrap justify-center gap-2">
                <span className="rounded-full border border-blue-800/50 bg-blue-900/30 px-3 py-1 text-[11px] text-blue-300">🔍 Pattern Detection</span>
                <span className="rounded-full border border-purple-800/50 bg-purple-900/30 px-3 py-1 text-[11px] text-purple-300">🕸️ Network Analysis</span>
                <span className="rounded-full border border-yellow-800/50 bg-yellow-900/30 px-3 py-1 text-[11px] text-yellow-300">⚠️ Risk Scoring</span>
                <span className="rounded-full border border-green-800/50 bg-green-900/30 px-3 py-1 text-[11px] text-green-300">📊 Visual Analytics</span>
              </div>
              <button
                onClick={() => setShowWelcome(false)}
                className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all hover:from-blue-500 hover:to-indigo-500 hover:shadow-blue-500/30"
              >
                Get Started →
              </button>
              <p className="mt-4 text-[10px] text-gray-600">RIFT 2026 · Financial Forensics Challenge</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
