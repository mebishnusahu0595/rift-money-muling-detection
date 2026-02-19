import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
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
  const bg = score > 70 ? "bg-red-600" : score > 20 ? "bg-yellow-600" : "bg-green-700";
  const label = score > 70 ? "HIGH" : score > 20 ? "MED" : "LOW";
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
  const [maxNodes, setMaxNodes] = useState(500);
  const lastClickedNodeRef = useRef<string | null>(null);
  const lastClickedRingRef = useRef<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"suspicious" | "rings">("suspicious");
  const [highlightedRingMembers, setHighlightedRingMembers] = useState<string[] | undefined>(undefined);
  const highlightedRingIdRef = useRef<string | null>(null);

  /* ── Resizable ring section ── */
  const [ringHeight, setRingHeight] = useState(320);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      // dragging UP ⇒ larger ring section
      const delta = startYRef.current - e.clientY;
      setRingHeight(Math.max(100, Math.min(600, startHRef.current + delta)));
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

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

    // Node limit for large datasets — prioritise suspicious + ring members + their neighbors
    if (maxNodes > 0 && nodes.length > maxNodes) {
      // 1. All suspicious / ring-member nodes first
      const suspicious = nodes.filter((n) => n.suspicion_score > 0);
      const normal = nodes.filter((n) => n.suspicion_score === 0);
      let kept = [...suspicious];
      // 2. Add neighbours of suspicious that are normal
      if (kept.length < maxNodes) {
        const keptIds = new Set(kept.map((n) => n.id));
        const neighborIds = new Set<string>();
        edges.forEach((e) => {
          if (keptIds.has(e.source)) neighborIds.add(e.target);
          if (keptIds.has(e.target)) neighborIds.add(e.source);
        });
        const neighbors = normal.filter((n) => neighborIds.has(n.id));
        kept = [...kept, ...neighbors.slice(0, maxNodes - kept.length)];
      }
      // 3. Fill remaining slots with other nodes
      if (kept.length < maxNodes) {
        const keptIds = new Set(kept.map((n) => n.id));
        const rest = normal.filter((n) => !keptIds.has(n.id));
        kept = [...kept, ...rest.slice(0, maxNodes - kept.length)];
      }
      const finalIds = new Set(kept.map((n) => n.id));
      nodes = kept;
      edges = edges.filter((e) => finalIds.has(e.source) && finalIds.has(e.target));
    }

    if (nodes === graphData.nodes && edges === graphData.edges) return graphData;
    return { nodes, edges };
  }, [graphData, result, patternFilter, minAmount, maxNodes]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (!result) return;

      // Clear ring highlight when clicking a node
      setHighlightedRingMembers(undefined);
      highlightedRingIdRef.current = null;

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
      setHighlightedRingMembers(undefined);
      highlightedRingIdRef.current = null;
    },
    []
  );

  /** Sidebar Fraud Rings tab — click to highlight ring in graph */
  const handleSidebarRingHighlight = useCallback(
    (ringId: string) => {
      if (!result) return;
      // Toggle — same ring clicked again clears highlight
      if (highlightedRingIdRef.current === ringId) {
        highlightedRingIdRef.current = null;
        setHighlightedRingMembers(undefined);
        setZoomToNodes([]);
        return;
      }
      const ring = result.fraud_rings.find((r) => r.ring_id === ringId);
      if (ring && ring.member_accounts.length > 0) {
        highlightedRingIdRef.current = ringId;
        setHighlightedRingMembers([...ring.member_accounts]);
        setSelectedAccount(null);
      }
    },
    [result]
  );

  const isAnalysing = uploading || polling;

  const filteredRings = useMemo(() => {
    const raw =
      result?.fraud_rings.filter(
        (r) => patternFilter === "all" || r.pattern_type === patternFilter
      ) ?? [];
    const seen = new Set<string>();
    return raw.filter((r) => {
      const key = `${r.ring_id}__${r.pattern_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [result, patternFilter]);

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

            {/* Max visible nodes slider */}
            {graphData && graphData.nodes.length > 100 && (
              <>
                <label className="mb-1 mt-3 block text-[10px] text-gray-400">
                  Max Visible Nodes
                </label>
                <input
                  type="range"
                  min={50}
                  max={Math.max(graphData.nodes.length, 50)}
                  step={50}
                  value={Math.min(maxNodes, graphData.nodes.length)}
                  onChange={(e) => setMaxNodes(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <span>{maxNodes >= graphData.nodes.length ? "All" : maxNodes}</span>
                  <span>of {graphData.nodes.length}</span>
                </div>
              </>
            )}
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
                  {filteredGraphData && graphData && filteredGraphData.nodes.length < graphData.nodes.length && (
                    <span className="rounded-full bg-yellow-900/50 px-2 py-0.5 text-[10px] font-semibold text-yellow-300">
                      {filteredGraphData.nodes.length} / {graphData.nodes.length} visible
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1">
                  {filteredGraphData ? (
                    <GraphViz
                      data={filteredGraphData}
                      onNodeClick={handleNodeClick}
                      zoomTo={zoomToNodes}
                      highlightRingNodes={highlightedRingMembers}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-600">Loading graph…</div>
                  )}
                </div>
              </div>

              {/* Ring table -- resizable */}
              <div className="relative shrink-0 flex flex-col" style={{ height: `${ringHeight}px` }}>
                {/* drag handle */}
                <div
                  onMouseDown={(e) => {
                    draggingRef.current = true;
                    startYRef.current = e.clientY;
                    startHRef.current = ringHeight;
                  }}
                  className="absolute -top-2 left-0 right-0 z-20 flex h-4 cursor-ns-resize items-center justify-center group"
                  title="Drag to resize"
                >
                  <span className="flex items-center gap-[3px] rounded-full bg-gray-700/80 px-3 py-[2px] transition-colors group-hover:bg-blue-600/80">
                    <span className="h-[3px] w-[3px] rounded-full bg-gray-400 group-hover:bg-white" />
                    <span className="h-[3px] w-[3px] rounded-full bg-gray-400 group-hover:bg-white" />
                    <span className="h-[3px] w-[3px] rounded-full bg-gray-400 group-hover:bg-white" />
                    <span className="h-[3px] w-[3px] rounded-full bg-gray-400 group-hover:bg-white" />
                    <span className="h-[3px] w-[3px] rounded-full bg-gray-400 group-hover:bg-white" />
                  </span>
                </div>
                <div className="mb-2 flex items-center gap-2 shrink-0">
                  <svg className="h-3.5 w-3.5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Network Graph</span>
                  {filteredRings.length > 0 && (
                    <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[9px] font-bold text-gray-400">
                      {filteredRings.length}{result && filteredRings.length < result.summary.fraud_rings_detected ? ` / ${result.summary.fraud_rings_detected}` : ""}
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <RingTable rings={filteredRings} onRingClick={handleRingClick} />
                </div>
              </div>
            </div>

            {/* Right sidebar — suspicious accounts + fraud rings tabs */}
            <aside className="flex w-64 shrink-0 flex-col border-l border-gray-800 bg-[#10161e] overflow-hidden">
              {/* Tab Header */}
              <div className="flex shrink-0 border-b border-gray-800">
                <button
                  onClick={() => { setSidebarTab("suspicious"); setHighlightedRingMembers(undefined); highlightedRingIdRef.current = null; }}
                  className={`flex flex-1 items-center justify-center gap-1 px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    sidebarTab === "suspicious"
                      ? "border-b-2 border-yellow-400 text-yellow-400"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <IconWarn />
                  <span>Suspicious</span>
                  <span className={`ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                    sidebarTab === "suspicious" ? "bg-yellow-500 text-black" : "bg-gray-700 text-gray-400"
                  }`}>{suspiciousSorted.length}</span>
                </button>
                <button
                  onClick={() => { setSidebarTab("rings"); setSelectedAccount(null); }}
                  className={`flex flex-1 items-center justify-center gap-1 px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    sidebarTab === "rings"
                      ? "border-b-2 border-red-400 text-red-400"
                      : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <IconRing />
                  <span>Rings</span>
                  <span className={`ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                    sidebarTab === "rings" ? "bg-red-500 text-white" : "bg-gray-700 text-gray-400"
                  }`}>{filteredRings.length}</span>
                </button>
              </div>

              {sidebarTab === "suspicious" ? (
              /* ── SUSPICIOUS ACCOUNTS TAB ── */
              <>
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
                        className={`h-full rounded-full ${selectedAccount.suspicion_score > 70 ? "bg-red-500" : selectedAccount.suspicion_score > 20 ? "bg-yellow-500" : "bg-green-500"}`}
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

                  {/* Fraud Ring Summary Table */}
                  <div className="border-b border-gray-800 px-4 py-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Fraud Ring Summary</p>
                    {(() => {
                      const ids = selectedAccount.ring_ids?.length > 0
                        ? selectedAccount.ring_ids
                        : selectedAccount.ring_id ? [selectedAccount.ring_id] : [];
                      const memberRings = result!.fraud_rings.filter((r) => ids.includes(r.ring_id));
                      if (memberRings.length === 0)
                        return <span className="text-[11px] text-gray-600">No ring membership</span>;
                      return (
                        <div className="overflow-x-auto rounded-lg border border-gray-700">
                          <table className="min-w-full text-[10px] text-gray-300">
                            <thead className="border-b border-gray-700 bg-gray-900/80 text-[9px] uppercase tracking-wider text-gray-500">
                              <tr>
                                <th className="px-2 py-1.5 text-left">Ring ID</th>
                                <th className="px-2 py-1.5 text-left">Pattern</th>
                                <th className="px-2 py-1.5 text-center">Members</th>
                                <th className="px-2 py-1.5 text-center">Risk</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                              {memberRings.map((ring) => (
                                <tr key={`${ring.ring_id}_${ring.pattern_type}`} className="hover:bg-gray-800/40">
                                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-blue-400">{ring.ring_id}</td>
                                  <td className="whitespace-nowrap px-2 py-1.5 capitalize">{ring.pattern_type.replace(/_/g, " ")}</td>
                                  <td className="px-2 py-1.5 text-center">{ring.member_accounts.length}</td>
                                  <td className="px-2 py-1.5 text-center">
                                    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                                      ring.risk_score > 30 ? "bg-red-600 text-red-100" : ring.risk_score > 12 ? "bg-yellow-600 text-yellow-100" : "bg-green-700 text-green-100"
                                    }`}>{ring.risk_score}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {/* Member accounts list per ring */}
                          {memberRings.map((ring) => (
                            <div key={`accts_${ring.ring_id}`} className="border-t border-gray-700/60 px-2 py-1.5">
                              <p className="text-[9px] font-semibold text-gray-500">{ring.ring_id} Accounts</p>
                              <p className="mt-0.5 text-[10px] font-mono leading-relaxed text-gray-400">
                                {ring.member_accounts.join(", ")}
                              </p>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
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
                  ) : suspiciousSorted.map((acct) => {
                    const acctRingIds = acct.ring_ids?.length ? acct.ring_ids : acct.ring_id ? [acct.ring_id] : [];
                    const acctRings = result ? result.fraud_rings.filter((r) => acctRingIds.includes(r.ring_id)) : [];
                    return (
                    <button
                      key={acct.account_id}
                      onClick={() => handleAccountListClick(acct)}
                      className="flex w-full items-center gap-2 border-b border-gray-800/60 px-3 py-2.5 text-left transition-colors hover:bg-gray-800/60"
                    >
                      <ScoreBadge score={acct.suspicion_score} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-gray-100">{acct.account_id}</p>
                        {acctRings.length > 0 ? (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {acctRings.slice(0, 3).map((ring) => (
                              <span
                                key={`${ring.ring_id}_${ring.pattern_type}`}
                                className={`inline-block rounded-full px-1.5 py-[1px] text-[8px] font-bold leading-tight ${
                                  ring.risk_score > 30 ? "bg-red-900/60 text-red-300" : ring.risk_score > 12 ? "bg-yellow-900/60 text-yellow-300" : "bg-green-900/60 text-green-300"
                                }`}
                              >
                                {ring.ring_id} · {ring.pattern_type}
                              </span>
                            ))}
                            {acctRings.length > 3 && (
                              <span className="text-[8px] text-gray-500">+{acctRings.length - 3} more</span>
                            )}
                          </div>
                        ) : (
                          <p className="truncate text-[10px] text-gray-500">
                            {acct.detected_patterns[0]
                              ? <span className="text-blue-400">{acct.detected_patterns[0].replace(/_/g, " ")}</span>
                              : "—"
                            }
                          </p>
                        )}
                      </div>
                      <IconChevron />
                    </button>
                    );
                  })}
                </div>
              )}
              </>
              ) : (
              /* ── FRAUD RINGS TAB ── */
              <div className="flex-1 overflow-y-auto">
                {filteredRings.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-gray-600">No fraud rings detected</div>
                ) : filteredRings.map((ring) => {
                  const isActive = highlightedRingIdRef.current === ring.ring_id;
                  return (
                    <button
                      key={`${ring.ring_id}_${ring.pattern_type}`}
                      onClick={() => handleSidebarRingHighlight(ring.ring_id)}
                      className={`flex w-full items-start gap-2.5 border-b border-gray-800/60 px-3 py-3 text-left transition-colors ${
                        isActive ? "bg-red-950/40 border-l-2 border-l-red-500" : "hover:bg-gray-800/60"
                      }`}
                    >
                      {/* Risk badge */}
                      <div className={`flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg ${
                        ring.risk_score > 30 ? "bg-red-600" : ring.risk_score > 12 ? "bg-yellow-600" : "bg-green-700"
                      }`}>
                        <span className="text-sm font-bold leading-none text-white">{ring.risk_score}</span>
                        <span className="text-[8px] font-semibold text-white/80">RISK</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-gray-100">{ring.ring_id}</p>
                        <p className="mt-0.5 text-[10px] capitalize text-gray-400">{ring.pattern_type.replace(/_/g, " ")}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="flex items-center gap-1 rounded-full bg-gray-800 px-1.5 py-0.5 text-[9px] font-medium text-gray-300">
                            <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z"/></svg>
                            {ring.member_accounts.length} members
                          </span>
                          {isActive && (
                            <span className="rounded-full bg-red-900/60 px-1.5 py-0.5 text-[9px] font-bold text-red-300">
                              HIGHLIGHTED
                            </span>
                          )}
                        </div>
                      </div>
                      <IconChevron />
                    </button>
                  );
                })}
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
                <span className="rounded-full border border-blue-800/50 bg-blue-900/30 px-3 py-1 text-[11px] text-blue-300">Pattern Detection</span>
                <span className="rounded-full border border-purple-800/50 bg-purple-900/30 px-3 py-1 text-[11px] text-purple-300">Network Analysis</span>
                <span className="rounded-full border border-yellow-800/50 bg-yellow-900/30 px-3 py-1 text-[11px] text-yellow-300">Risk Scoring</span>
                <span className="rounded-full border border-green-800/50 bg-green-900/30 px-3 py-1 text-[11px] text-green-300">Visual Analytics</span>
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
