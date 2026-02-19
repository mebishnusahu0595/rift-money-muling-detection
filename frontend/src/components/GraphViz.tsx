import CytoscapeComponent from "react-cytoscapejs";
import type { Core, EventObject } from "cytoscape";
import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import type { GraphData, GraphNode } from "../types";

// ── helpers ────────────────────────────────────────────────────────────────

interface Props {
  data: GraphData;
  onNodeClick: (nodeId: string) => void;
}

const RING_COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

// ── component ──────────────────────────────────────────────────────────────

export default function GraphViz({ data, onNodeClick }: Props) {
  const cyRef = useRef<Core | null>(null);
  const [showNormal, setShowNormal] = useState(true);
  const [minScore, setMinScore] = useState(0);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const focusedRef = useRef<string | null>(null);

  const elements = useMemo(() => {
    // Person SVG icons encoded as data URIs
    const iconNormal = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='rgba(255,255,255,0.75)'%3E%3Cpath d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3C/svg%3E";
    const iconSuspicious = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='rgba(255,255,255,0.9)' d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3Cpolygon fill='%23fbbf24' points='20,2 22,6 18,6'/%3E%3C/svg%3E";
    const iconHighRisk = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='rgba(255,255,255,0.9)' d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3Cpolygon fill='%23ef4444' points='20,1 23,7 17,7'/%3E%3Cline x1='20' y1='3' x2='20' y2='5.2' stroke='white' stroke-width='1.2' stroke-linecap='round'/%3E%3Ccircle cx='20' cy='6.3' r='0.5' fill='white'/%3E%3C/svg%3E";

    const nodeEls = data.nodes.map((n: GraphNode) => {
      const score = n.suspicion_score;
      let color = "#3d4a5c";
      let size = 16;
      let icon = iconNormal;
      if (score > 70) { color = "#ef4444"; size = 28; icon = iconHighRisk; }
      else if (score > 0) { color = "#d97706"; size = 22; icon = iconSuspicious; }

      const ringColor =
        n.ring_ids.length > 0
          ? RING_COLORS[parseInt(n.ring_ids[0].replace(/\D/g, ""), 10) % RING_COLORS.length]
          : "transparent";

      return {
        data: {
          id: n.id,
          label: n.id,
          score,
          color,
          size,
          icon,
          ringColor,
          inflow: n.total_inflow,
          outflow: n.total_outflow,
          isNormal: score === 0,
        },
      };
    });

    const edgeEls = data.edges.map((e, i) => ({
      data: {
        id: `e${i}`,
        source: e.source,
        target: e.target,
        amount: e.amount,
        width: Math.max(1, Math.min(5, e.amount / 3000)),
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
          "background-clip": "none" as const,
          width: "data(size)" as unknown as number,
          height: "data(size)" as unknown as number,
          "font-size": "7px",
          color: "#cbd5e1",
          "text-valign": "bottom" as const,
          "text-halign": "center" as const,
          "text-margin-y": 3,
          "border-width": 2,
          "border-color": "data(ringColor)" as string,
          "text-outline-width": 1,
          "text-outline-color": "#0f0f23",
          "overlay-opacity": 0,  // no tap flash
        },
      },
      {
        selector: "edge",
        style: {
          width: "data(width)" as unknown as number,
          "line-color": "#334155",
          "target-arrow-color": "#334155",
          "target-arrow-shape": "triangle" as const,
          "curve-style": "bezier" as const,
          opacity: 0.55,
        },
      },
      {
        selector: "node:selected",
        style: {
          "border-width": 3,
          "border-color": "#6366f1",
          "overlay-opacity": 0,
        },
      },
      { selector: ".dimmed",      style: { opacity: 0.07 } },
      { selector: ".highlighted", style: { opacity: 1 } },
    ],
    []
  );

  // Sync focus mode flag so tap handler can read it without stale closure
  useEffect(() => {
    if (!cyRef.current) return;
    (cyRef.current as any).__focusMode = focusModeEnabled;
    if (!focusModeEnabled) {
      cyRef.current.elements().removeClass("dimmed highlighted");
      focusedRef.current = null;
    }
  }, [focusModeEnabled]);

  // Reactive filter — hide/show without re-layout
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
    const edgesToHide = cy.edges().filter(
      (e) => hiddenNodes.has(e.source()) || hiddenNodes.has(e.target())
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (edgesToHide as any).hide();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cy.edges().not(edgesToHide) as any).show();
  }, [showNormal, minScore]);

  const handleCyReady = useCallback(
    (cy: Core) => {
      cyRef.current = cy;
      (cy as any).__focusMode = focusModeEnabled;

      cy.on("tap", "node", (e: EventObject) => {
        const id: string = e.target.id();
        const fm = (cy as any).__focusMode;
        if (fm) {
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
        onNodeClick(id);
      });

      cy.on("tap", (e: EventObject) => {
        if (e.target === cy) {
          cy.elements().removeClass("dimmed highlighted");
          focusedRef.current = null;
        }
      });

      const nodeCount = data.nodes.length;
      cy.layout({
        name: "cose",
        animate: false,
        nodeRepulsion: () => Math.max(12000, nodeCount * 2500),
        idealEdgeLength: () => Math.max(130, nodeCount * 18),
        nodeOverlap: 40,
        gravity: 0.35,
        numIter: 2000,
        componentSpacing: 100,
        padding: 50,
      } as never).run();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onNodeClick, data.nodes.length]
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-gray-800">
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
          {focusModeEnabled ? "🔍 Focus ON" : "🔍 Focus Mode"}
        </button>
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => cyRef.current?.fit(undefined, 30)}
            className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-600">Fit</button>
          <button onClick={() => cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 1.3)}
            className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-600">+</button>
          <button onClick={() => cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) / 1.3)}
            className="rounded bg-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-600">−</button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <CytoscapeComponent
        elements={elements}
        stylesheet={stylesheet as never}
        style={{ width: "100%", flex: 1, minHeight: 420, background: "rgba(15,15,35,0.6)" }}
        cy={(cy: Core) => handleCyReady(cy)}
        wheelSensitivity={0.3}
      />

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 bg-gray-900 px-4 py-1.5 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-gray-500" /> Normal</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Suspicious</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> High Risk</span>
        <span className="ml-auto italic text-gray-600">Zoom in for labels · Click node to focus</span>
      </div>
    </div>
  );
}

