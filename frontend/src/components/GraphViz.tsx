import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { GraphData, GraphNode } from "../types";

// ── helpers ────────────────────────────────────────────────────────────────

const _nodeColor = (n: GraphNode) => {
  if (n.suspicion_score > 70) return "#ef4444";
  if (n.suspicion_score > 30) return "#f59e0b";
  return "#6b7280";
};

// Continuous sizing: 18px (score 0) → 42px (score 100)
const _nodeSize = (n: GraphNode) => Math.round(18 + (n.suspicion_score / 100) * 24);

interface Props {
  data: GraphData;
  onNodeClick: (nodeId: string) => void;
}

const RING_COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

// ── component ──────────────────────────────────────────────────────────────

const GraphViz: React.FC<Props> = ({ data, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const focusedRef = useRef<string | null>(null);

  const [showNormal, setShowNormal] = useState(true);
  const [minScore, setMinScore] = useState(0);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);

  // Build ring → colour map
  const ringColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    let idx = 0;
    data.nodes.forEach((n) =>
      n.ring_ids.forEach((r) => {
        if (!map[r]) { map[r] = RING_COLORS[idx % RING_COLORS.length]; idx++; }
      })
    );
    return map;
  }, [data]);

  // ── Build / rebuild Cytoscape instance ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const elements: cytoscape.ElementDefinition[] = [];

    // Compound parent nodes — one per ring (visual cluster container)
    Object.keys(ringColorMap).forEach((rid) => {
      elements.push({
        data: { id: `__ring__${rid}`, label: rid, ringColor: ringColorMap[rid] },
        group: "nodes",
      });
    });

    // Member nodes
    data.nodes.forEach((n) => {
      const borderColor = n.ring_ids.length > 0 ? ringColorMap[n.ring_ids[0]] : "transparent";
      const parent = n.ring_ids.length > 0 ? `__ring__${n.ring_ids[0]}` : undefined;
      elements.push({
        data: {
          id: n.id,
          label: n.id,
          score: n.suspicion_score,
          bgColor: _nodeColor(n),
          borderColor,
          size: _nodeSize(n),
          ring_ids: n.ring_ids,
          isNormal: n.suspicion_score === 0,
          ...(parent ? { parent } : {}),
        },
        group: "nodes",
      });
    });

    // Edges
    const maxAmt = Math.max(...data.edges.map((e) => e.amount), 1);
    data.edges.forEach((e, i) => {
      elements.push({
        data: {
          id: `e${i}`,
          source: e.source,
          target: e.target,
          amount: e.amount,
          width: Math.max(1, (e.amount / maxAmt) * 5),
        },
        group: "edges",
      });
    });

    // Layout params scaled to node count
    const nodeCount = data.nodes.length;
    const repulsion = Math.max(12000, nodeCount * 2500);
    const edgeLen = Math.max(130, nodeCount * 18);

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        // Compound ring containers
        {
          selector: ":parent",
          style: {
            "background-opacity": 0.07,
            "background-color": "data(ringColor)" as any,
            "border-color": "data(ringColor)" as any,
            "border-width": 2,
            "border-opacity": 0.55,
            label: "data(label)",
            "font-size": "10px",
            color: "#9ca3af",
            "text-valign": "top",
            "text-halign": "center",
            "text-margin-y": -6,
            "text-outline-width": 0,
            shape: "roundrectangle",
            "padding-top": "20px" as any,
            "padding-bottom": "20px" as any,
            "padding-left": "20px" as any,
            "padding-right": "20px" as any,
          },
        },
        // Regular member nodes — labels hidden by default, shown on zoom
        {
          selector: "node:childless",
          style: {
            "background-color": "data(bgColor)" as any,
            label: "data(label)",
            "font-size": "0px",
            color: "#e5e7eb",
            "text-outline-width": 2,
            "text-outline-color": "#111827",
            "text-valign": "bottom",
            "text-margin-y": 4,
            width: "data(size)",
            height: "data(size)",
            "border-width": 3,
            "border-color": "data(borderColor)" as any,
          },
        },
        // Edges
        {
          selector: "edge",
          style: {
            width: "data(width)" as any,
            "line-color": "#374151",
            "target-arrow-color": "#374151",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            opacity: 0.65,
          },
        },
        // Focus mode — dimmed
        { selector: ".dimmed",       style: { opacity: 0.08 } },
        // Focus mode — highlighted
        { selector: ".highlighted",  style: { opacity: 1 } },
      ],
      layout: {
        name: "cose",
        animate: false,
        nodeRepulsion: () => repulsion,
        idealEdgeLength: () => edgeLen,
        nodeOverlap: 40,
        gravity: 0.35,
        numIter: 2500,
        componentSpacing: 100,
        coolingFactor: 0.95,
        nestingFactor: 1.2,
        padding: 60,
      } as any,
      minZoom: 0.08,
      maxZoom: 5,
    });

    // ── Zoom → reveal / hide labels ──────────────────────────────────────
    const LABEL_THRESHOLD = 1.3;
    const updateLabels = (zoom: number) => {
      cy.nodes("node:childless").style("font-size", zoom >= LABEL_THRESHOLD ? "10px" : "0px");
    };
    cy.on("zoom", () => updateLabels(cy.zoom()));

    // ── Node tap ─────────────────────────────────────────────────────────
    cy.on("tap", "node:childless", (evt) => {
      const id: string = evt.target.id();

      // Focus mode logic
      const fm = (cy as any).__focusModeEnabled;
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

    // Background tap → clear focus
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass("dimmed highlighted");
        focusedRef.current = null;
      }
    });

    cyRef.current = cy;
    (cy as any).__focusModeEnabled = false;

    return () => { cy.destroy(); cyRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ringColorMap]);

  // ── Sync focus mode flag into cy instance ────────────────────────────
  useEffect(() => {
    if (!cyRef.current) return;
    (cyRef.current as any).__focusModeEnabled = focusModeEnabled;
    if (!focusModeEnabled) {
      cyRef.current.elements().removeClass("dimmed highlighted");
      focusedRef.current = null;
    }
  }, [focusModeEnabled]);

  // ── Reactive filters (show/hide without re-layout) ───────────────────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const all = cy.nodes("node:childless");
    const toHide = all.filter((n) => {
      const isNormal: boolean = n.data("isNormal");
      const score: number = n.data("score");
      return (!showNormal && isNormal) || score < minScore;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (toHide as any).hide();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (all.not(toHide) as any).show();

    // Hide edges whose endpoint is hidden
    const hiddenNodes = cy.nodes(":hidden");
    const edgesToHide = cy.edges().filter(
      (e) => hiddenNodes.has(e.source()) || hiddenNodes.has(e.target())
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (edgesToHide as any).hide();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cy.edges().not(edgesToHide) as any).show();
  }, [showNormal, minScore]);

  const handleFit = useCallback(() => cyRef.current?.fit(undefined, 40), []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl">

      {/* ── Filter toolbar ── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-gray-800 bg-gray-900/90 px-4 py-2 text-xs">
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input
            type="checkbox"
            className="accent-blue-500"
            checked={showNormal}
            onChange={(e) => setShowNormal(e.target.checked)}
          />
          <span className="text-gray-300">Show Normal</span>
        </label>

        <label className="flex select-none items-center gap-2">
          <span className="text-gray-400">Min Score</span>
          <input
            type="range"
            min={0} max={100} step={5}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-24 accent-yellow-400"
          />
          <span className="w-6 font-mono text-yellow-300">{minScore}</span>
        </label>

        <button
          onClick={() => setFocusModeEnabled((v) => !v)}
          className={`rounded px-2 py-0.5 font-semibold transition-colors ${
            focusModeEnabled
              ? "bg-indigo-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          {focusModeEnabled ? "🔍 Focus ON" : "🔍 Focus Mode"}
        </button>

        <button
          onClick={handleFit}
          className="ml-auto rounded bg-gray-700 px-2 py-0.5 text-gray-200 hover:bg-gray-600"
        >
          Fit
        </button>
      </div>

      {/* ── Graph canvas ── */}
      <div ref={containerRef} className="flex-1 bg-gray-900/60" />

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 bg-gray-900/80 px-4 py-1.5 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> High (&gt;70)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> Medium (30–70)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-500" /> Normal
        </span>
        <span className="ml-auto italic text-gray-600">Zoom in for labels · Ring boxes = fraud clusters</span>
      </div>
    </div>
  );
};

export default GraphViz;

