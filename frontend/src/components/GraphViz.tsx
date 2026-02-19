import CytoscapeComponent from "react-cytoscapejs";
import type { Core, EventObject } from "cytoscape";
import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import type { GraphData, GraphNode } from "../types";

// ── helpers ────────────────────────────────────────────────────────────────

interface Props {
  data: GraphData;
  onNodeClick: (nodeId: string) => void;
  /** Optional: zoom graph to a set of node IDs */
  zoomTo?: string[];
}

const RING_COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

// Stable key derived from data so CytoscapeComponent fully remounts on new data
function dataKey(d: GraphData) {
  return `${d.nodes.length}-${d.edges.length}-${d.nodes.map((n) => n.id).join(",")}`;
}

// ── component ──────────────────────────────────────────────────────────────

export default function GraphViz({ data, onNodeClick, zoomTo }: Props) {
  const cyRef = useRef<Core | null>(null);
  const [showNormal, setShowNormal] = useState(true);
  const [minScore, setMinScore] = useState(0);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [tappedNode, setTappedNode] = useState<{ id: string; score: number } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const focusedRef = useRef<string | null>(null);
  const focusModeRef = useRef(false);
  // always-current callback ref — never stale
  const onNodeClickRef = useRef(onNodeClick);
  useEffect(() => { onNodeClickRef.current = onNodeClick; });

  // Build element definitions (not passed as reactive prop — added manually in handleCyReady)
  const elementDefs = useMemo(() => {
    const iconNormal = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='rgba(255,255,255,0.75)'%3E%3Cpath d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3C/svg%3E";
    const iconSuspicious = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='rgba(255,255,255,0.9)' d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3Cpolygon fill='%23fbbf24' points='20,2 22,6 18,6'/%3E%3C/svg%3E";
    const iconHighRisk = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='rgba(255,255,255,0.9)' d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3Cpolygon fill='%23ef4444' points='20,1 23,7 17,7'/%3E%3Cline x1='20' y1='3' x2='20' y2='5.2' stroke='white' stroke-width='1.2' stroke-linecap='round'/%3E%3Ccircle cx='20' cy='6.3' r='0.5' fill='white'/%3E%3C/svg%3E";

    const nodeEls = data.nodes.map((n: GraphNode) => {
      const score = n.suspicion_score;
      let color = "#3d4a5c";
      let size = 12;
      let icon = iconNormal;
      if (score > 70) { color = "#ef4444"; size = 18; icon = iconHighRisk; }
      else if (score > 20) { color = "#d97706"; size = 15; icon = iconSuspicious; }
      else if (score > 0) { color = "#6b8a3d"; size = 13; icon = iconSuspicious; }

      const ringColor =
        n.ring_ids.length > 0
          ? RING_COLORS[parseInt(n.ring_ids[0].replace(/\D/g, ""), 10) % RING_COLORS.length]
          : "transparent";

      return {
        group: "nodes" as const,
        data: { id: n.id, label: n.id, score, color, size, icon, ringColor,
          inflow: n.total_inflow, outflow: n.total_outflow, isNormal: score === 0,
          patterns: n.detected_patterns ?? [] },
      };
    });

    const edgeEls = data.edges.map((e, i) => ({
      group: "edges" as const,
      data: {
        id: `e${i}`,
        source: e.source,
        target: e.target,
        amount: e.amount,
        width: Math.max(0.5, Math.min(2.5, e.amount / 5000)),
      },
    }));

    return [...nodeEls, ...edgeEls];
  }, [data]);

  const stylesheet = useMemo(
    () => [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "background-color": "data(color)" as string,
          "background-image": "data(icon)" as string,
          "background-fit": "cover" as const,
          width: "data(size)" as unknown as number,
          height: "data(size)" as unknown as number,
          "font-size": "4px",
          "font-family": "Inter, 'Helvetica Neue', Arial, sans-serif",
          "font-weight": 500,
          color: "#e2e8f0",
          "text-valign": "bottom" as const,
          "text-halign": "center" as const,
          "text-margin-y": 2,
          "border-width": 1.5,
          "border-color": "data(ringColor)" as string,
          "text-outline-width": 0,
          "text-background-color": "#0d1117",
          "text-background-opacity": 0.75,
          "text-background-padding": "1px",
          "text-background-shape": "roundrectangle" as const,
          "min-zoomed-font-size": 4,
          "overlay-opacity": 0,
        },
      },
      {
        selector: "edge",
        style: {
          width: "data(width)" as unknown as number,
          "line-color": "#4a6fa5",
          "target-arrow-color": "#4a6fa5",
          "target-arrow-shape": "triangle" as const,
          "arrow-scale": 0.6,
          "curve-style": "bezier" as const,
          "line-style": "dashed" as const,
          "line-dash-pattern": [4, 2] as unknown as number,
          "line-dash-offset": 0,
          opacity: 0.6,
        },
      },
      {
        selector: "node:selected",
        style: { "border-width": 3, "border-color": "#6366f1", "overlay-opacity": 0 },
      },
      { selector: ".dimmed",      style: { opacity: 0.07 } },
      { selector: ".highlighted", style: { opacity: 1 } },
    ],
    []
  );

  // ── Sync focus mode ref ────────────────────────────────────────────────
  useEffect(() => {
    focusModeRef.current = focusModeEnabled;
    if (!focusModeEnabled && cyRef.current) {
      cyRef.current.elements().removeClass("dimmed highlighted");
      focusedRef.current = null;
    }
  }, [focusModeEnabled]);

  // ── Reactive filter — hide/show without re-layout ─────────────────────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const all = cy.nodes();
    const toHide = all.filter((n) => {
      const isNormal: boolean = n.data("isNormal");
      const score: number = n.data("score");
      return (!showNormal && isNormal) || score < minScore;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (toHide as any).hide();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (all.not(toHide) as any).show();
    const hiddenNodes = cy.nodes(":hidden");
    const edgesToHide = cy.edges().filter((e) =>
      hiddenNodes.has(e.source()) || hiddenNodes.has(e.target())
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (edgesToHide as any).hide();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cy.edges().not(edgesToHide) as any).show();
  }, [showNormal, minScore]);

  // ── Animated edge flow ────────────────────────────────────────────────
  useEffect(() => {
    let offset = 0;
    const timer = setInterval(() => {
      const cy = cyRef.current;
      if (!cy) return;
      offset = (offset + 1) % 36;
      cy.edges().style("line-dash-offset", -offset);
    }, 40);
    return () => clearInterval(timer);
  }, []);

  // ── zoomTo prop ────────────────────────────────────────────────────────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    // empty array = zoom out / fit all
    if (zoomTo && zoomTo.length === 0) {
      cy.animate({ fit: { eles: cy.elements(":visible"), padding: 40 }, duration: 400 } as never);
      setIsZoomed(false);
      return;
    }
    if (!zoomTo || zoomTo.length === 0) return;
    const sel = zoomTo.map((id) => `#${CSS.escape(id)}`).join(", ");
    try {
      const nodes = cy.$(sel);
      if (nodes.length > 0) {
        cy.animate({ fit: { eles: nodes, padding: 100 }, duration: 500 } as never);
        setIsZoomed(true);
      }
    } catch { /* ignore bad selectors */ }
  }, [zoomTo]);

  // ── cy callback: runs once per mount (key forces remount on new data) ──
  const handleCyReady = useCallback(
    (cy: Core) => {
      if (cyRef.current === cy) return; // already initialised this instance
      cyRef.current = cy;

      // Add all elements manually — this way cy.json() never resets positions
      cy.add(elementDefs as never);

      // Tap listener on node
      cy.on("tap", "node", (e: EventObject) => {
        const id: string = e.target.id();
        const score: number = e.target.data("score") ?? 0;
        setTappedNode({ id, score });
        if (focusModeRef.current) {
          if (focusedRef.current === id) {
            cy.elements().removeClass("dimmed highlighted");
            focusedRef.current = null;
          } else {
            focusedRef.current = id;
            const hood = cy.getElementById(id).closedNeighborhood();
            cy.elements().addClass("dimmed").removeClass("highlighted");
            hood.removeClass("dimmed").addClass("highlighted");
          }
        }
        onNodeClickRef.current(id);
      });

      // Tap on background — clear focus
      cy.on("tap", (e: EventObject) => {
        if (e.target === cy) {
          cy.elements().removeClass("dimmed highlighted");
          focusedRef.current = null;
          setTappedNode(null);
        }
      });

      // Run cose layout — nodes are already in cy, positions will spread correctly
      const nodeCount = cy.nodes().length;
      cy.layout({
        name: "cose",
        animate: false,
        randomize: true,
        nodeRepulsion: () => Math.max(8000, nodeCount * 2000),
        idealEdgeLength: () => Math.max(80, nodeCount * 8),
        nodeOverlap: 20,
        gravity: 0.18,
        numIter: 4000,
        componentSpacing: 150,
        padding: 60,
      } as never).run();

      // Constrain zoom & fit
      cy.maxZoom(2.0);
      cy.minZoom(0.2);
      cy.fit(undefined, 60);

      // Track zoom level
      const updateZoom = () => setZoomPercent(Math.round(cy.zoom() * 100));
      updateZoom();
      cy.on("zoom", updateZoom);
    },
    // elementDefs identity is stable per data (useMemo keyed on data)
    [elementDefs]
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0d1117]">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-800 bg-gray-900 px-4 py-2 text-xs">
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input type="checkbox" className="accent-blue-500" checked={showNormal}
            onChange={(e) => setShowNormal(e.target.checked)} />
          <span className="text-gray-300">Show Normal</span>
        </label>
        <label className="flex select-none items-center gap-2">
          <span className="text-gray-400">Min Score</span>
          <input type="range" min={0} max={100} step={5} value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-24 accent-yellow-400" />
          <span className="w-6 font-mono text-yellow-300">{minScore}</span>
        </label>
        <button
          onClick={() => setFocusModeEnabled((v) => !v)}
          className={`rounded px-2 py-0.5 font-semibold transition-colors ${
            focusModeEnabled ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {focusModeEnabled ? "Focus ON" : "Focus Mode"}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="rounded bg-gray-800 px-2 py-0.5 font-mono text-[11px] text-gray-400 tabular-nums">{zoomPercent}%</span>
          <button onClick={() => { cyRef.current?.fit(undefined, 30); setIsZoomed(false); }}
            className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-600">Fit</button>
          <button onClick={() => cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 1.3)}
            className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-600">+</button>
          <button onClick={() => cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) / 1.3)}
            className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-600">-</button>
        </div>
      </div>

      {/* ── Canvas — key forces full remount when data changes ── */}
      <div className="relative min-h-0 flex-1">
        {/* Selected node banner */}
        {tappedNode && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
            <div className="flex items-center gap-2.5 rounded-xl border border-gray-700/80 bg-gray-900/90 px-4 py-2 shadow-xl backdrop-blur-md">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white ${
                tappedNode.score > 70 ? "bg-red-600" : tappedNode.score > 20 ? "bg-yellow-600" : "bg-green-700"
              }`}>
                {tappedNode.score}
              </div>
              <div>
                <p className="text-sm font-bold tracking-wide text-white">{tappedNode.id}</p>
                <p className={`text-[10px] font-semibold ${
                  tappedNode.score > 70 ? "text-red-400" : tappedNode.score > 20 ? "text-yellow-400" : "text-green-400"
                }`}>
                  {tappedNode.score > 70 ? "High Risk" : tappedNode.score > 20 ? "Suspicious" : "Normal"}
                </p>
              </div>
            </div>
          </div>
        )}
        {isZoomed && !tappedNode && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[10px] font-medium text-blue-300 backdrop-blur">
            Click same node again to zoom out
          </div>
        )}
        <CytoscapeComponent
          key={dataKey(data)}
          elements={[]}
          stylesheet={stylesheet as never}
          style={{ width: "100%", height: "100%", minHeight: 300, background: "rgba(13,17,23,0.95)" }}
          cy={(cy: Core) => handleCyReady(cy)}
          wheelSensitivity={0.3}
        />
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 bg-gray-900 px-4 py-1.5 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-gray-500" /> Normal</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#6b8a3d]" /> Low Risk</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Suspicious</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> High Risk</span>
        <span className="ml-auto italic text-gray-600">Zoom in for labels · Click node to view details</span>
      </div>
    </div>
  );
}

