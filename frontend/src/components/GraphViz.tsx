import CytoscapeComponent from "react-cytoscapejs";
import type { Core, EventObject } from "cytoscape";
import { useMemo, useRef, useCallback, useState, useEffect } from "react";
import type { GraphData, GraphNode } from "../types";

// ── helpers ────────────────────────────────────────────────────────────────

interface Props {
  data: GraphData;
  onNodeClick: (nodeId: string) => void;
  /** Controls full remount — should ONLY change on new CSV upload, not on filter changes */
  graphKey: string;
  /** Optional: zoom graph to a set of node IDs */
  zoomTo?: string[];
  /** Optional: highlight these node IDs as a fraud ring (red nodes + red edges between them, dim rest) */
  highlightRingNodes?: string[];
  showLabels?: boolean;
}

const RING_COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

// Stable key derived from data so CytoscapeComponent fully remounts on new data.
// We sort & join only the first 30 IDs to keep this cheap while still being
// sensitive to actual graph structure changes (not just filter-driven array
// reference changes on the same underlying nodes).
function dataKey(d: GraphData) {
  const sample = d.nodes
    .slice(0, 30)
    .map((n) => n.id)
    .sort()
    .join(",");
  return `${d.nodes.length}-${d.edges.length}-${sample}`;
}

// Zoom presets
const ZOOM_PRESETS = [
  { label: "Overview", value: 0.07, desc: "Cluster view" },
  { label: "Area", value: 0.25, desc: "Sub-clusters" },
  { label: "Local", value: 0.50, desc: "Key nodes" },
  { label: "Detail", value: 1.00, desc: "Full detail" },
] as const;

// Zoom-based label level
type LabelLevel = "none" | "high-risk" | "suspicious" | "all";
function getLabelLevel(zoom: number): LabelLevel {
  if (zoom < 0.15) return "none";
  if (zoom < 0.35) return "high-risk";
  if (zoom < 0.6) return "suspicious";
  return "all";
}

// ── component ──────────────────────────────────────────────────────────────

export default function GraphViz({ data, onNodeClick, graphKey, zoomTo, highlightRingNodes, showLabels = true }: Props) {
  const cyRef = useRef<Core | null>(null);
  const [showNormal, setShowNormal] = useState(true);
  const [showLowRisk, setShowLowRisk] = useState(true);
  const [showSuspicious, setShowSuspicious] = useState(true);
  const [showHighRisk, setShowHighRisk] = useState(true);
  const [minScore, setMinScore] = useState(0);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [tappedNode, setTappedNode] = useState<{ id: string; score: number } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [labelLevel, setLabelLevel] = useState<LabelLevel>("all");
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [layoutElapsedMs, setLayoutElapsedMs] = useState(0);
  const [showMinimap, setShowMinimap] = useState(true);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const minimapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawMinimapRef = useRef<(() => void) | null>(null); // late-bound ref to drawMinimap
  const focusedRef = useRef<string | null>(null);
  const focusModeRef = useRef(false);
  const isZoomedRef = useRef(false);          // always-current mirror of isZoomed state
  const focusedNodeRef = useRef<string | null>(null); // which node is currently zoomed into
  // always-current callback ref — never stale
  const onNodeClickRef = useRef(onNodeClick);
  useEffect(() => { onNodeClickRef.current = onNodeClick; });
  useEffect(() => { isZoomedRef.current = isZoomed; }, [isZoomed]);

  // Live counter while layout is computing
  useEffect(() => {
    if (!layoutRunning) { setLayoutElapsedMs(0); return; }
    const start = Date.now();
    const t = setInterval(() => setLayoutElapsedMs(Date.now() - start), 50);
    return () => clearInterval(t);
  }, [layoutRunning]);

  // Build element definitions (not passed as reactive prop — added manually in handleCyReady)
  const elementDefs = useMemo(() => {
    const iconNormal = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='rgba(255,255,255,0.75)'%3E%3Cpath d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3C/svg%3E";
    const iconSuspicious = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='rgba(255,255,255,0.9)' d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3Cpolygon fill='%23fbbf24' points='20,2 22,6 18,6'/%3E%3C/svg%3E";
    const iconHighRisk = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='rgba(255,255,255,0.9)' d='M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z'/%3E%3Cpolygon fill='%23ef4444' points='20,1 23,7 17,7'/%3E%3Cline x1='20' y1='3' x2='20' y2='5.2' stroke='white' stroke-width='1.2' stroke-linecap='round'/%3E%3Ccircle cx='20' cy='6.3' r='0.5' fill='white'/%3E%3C/svg%3E";

    // Pre-compute degree (connection count) for each node
    const degreeMap = new Map<string, number>();
    for (const e of data.edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }

    const nodeEls = data.nodes.map((n: GraphNode) => {
      const score = n.suspicion_score;
      const degree = degreeMap.get(n.id) ?? 0;
      let color = "#3d4a5c";
      let baseSize = 10;
      let icon = iconNormal;
      // Risk category tag for filter toggles
      let riskCategory: "high" | "suspicious" | "low" | "normal" = "normal";
      if (score > 70) { color = "#ef4444"; baseSize = 16; icon = iconHighRisk; riskCategory = "high"; }
      else if (score > 20) { color = "#d97706"; baseSize = 13; icon = iconSuspicious; riskCategory = "suspicious"; }
      else if (score > 0) { color = "#6b8a3d"; baseSize = 11; icon = iconSuspicious; riskCategory = "low"; }
      // Dynamic size: base + degree bonus (capped)
      const size = baseSize + Math.min(degree * 1.5, 18);

      const ringColor =
        n.ring_ids.length > 0
          ? RING_COLORS[parseInt(n.ring_ids[0].replace(/\D/g, ""), 10) % RING_COLORS.length]
          : "transparent";

      return {
        group: "nodes" as const,
        data: {
          id: n.id, label: n.id, score, color, size, icon, ringColor, degree,
          riskCategory, inflow: n.total_inflow, outflow: n.total_outflow, isNormal: score === 0,
          patterns: n.detected_patterns ?? []
        },
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
          // Label hidden by default — dynamically set via zoom level
          label: "",
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
          "min-zoomed-font-size": 0,
          "overlay-opacity": 0,
        },
      },
      // Dynamic label classes toggled by zoom level
      { selector: ".show-label", style: { label: "data(label)" } },
      {
        selector: "edge",
        style: {
          width: "data(width)" as unknown as number,
          "line-color": "#b0c4de",
          "target-arrow-color": "#b0c4de",
          "target-arrow-shape": "triangle" as const,
          "arrow-scale": 0.6,
          "curve-style": "bezier" as const,
          "line-style": "dashed" as const,
          "line-dash-pattern": [4, 2] as unknown as number,
          "line-dash-offset": 0,
          opacity: 0.85,
        },
      },
      {
        selector: "node:selected",
        style: { "border-width": 3, "border-color": "#6366f1", "overlay-opacity": 0 },
      },
      { selector: ".dimmed", style: { opacity: 0.07 } },
      { selector: ".highlighted", style: { opacity: 1 } },
      {
        selector: ".ring-node",
        style: {
          "background-color": "#ef4444",
          "border-color": "#ff0000",
          "border-width": 3,
          width: 22,
          height: 22,
          opacity: 1,
          "z-index": 999,
        },
      },
      {
        selector: ".ring-edge",
        style: {
          "line-color": "#ef4444",
          "target-arrow-color": "#ef4444",
          "line-style": "solid" as const,
          width: 3,
          opacity: 1,
          "z-index": 998,
        },
      },
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

  // ── Reactive filter — hide/show by risk category without re-layout ────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const all = cy.nodes();
    const toHide = all.filter((n) => {
      const cat: string = n.data("riskCategory");
      const score: number = n.data("score");
      if (cat === "high" && !showHighRisk) return true;
      if (cat === "suspicious" && !showSuspicious) return true;
      if (cat === "low" && !showLowRisk) return true;
      if (cat === "normal" && !showNormal) return true;
      if (score < minScore) return true;
      return false;
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
  }, [showNormal, showLowRisk, showSuspicious, showHighRisk, minScore]);

  // ── Sync external filtered data → Cytoscape show/hide ─────────────────
  // When the parent passes a new filtered `data` (patternFilter / minAmount
  // changed), we show only the nodes/edges present in the new data, and
  // hide the rest — WITHOUT remounting or re-running layout.
  const filteredNodeIds = useMemo(
    () => new Set(data.nodes.map((n) => n.id)),
    [data.nodes]
  );
  const filteredEdgeKeys = useMemo(
    () => new Set(data.edges.map((e) => `${e.source}__${e.target}`)),
    [data.edges]
  );

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    // Use rAF so the show/hide runs after React paints — feels instantaneous
    const raf = requestAnimationFrame(() => {
      if (!cyRef.current) return;
      cy.startBatch();
      cy.nodes().forEach((n) => {
        if (filteredNodeIds.has(n.id())) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (n as any).show();
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (n as any).hide();
        }
      });
      cy.edges().forEach((e) => {
        const key = `${e.source().id()}__${e.target().id()}`;
        const bothVisible =
          filteredNodeIds.has(e.source().id()) &&
          filteredNodeIds.has(e.target().id());
        if (bothVisible && filteredEdgeKeys.has(key)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e as any).show();
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e as any).hide();
        }
      });
      cy.endBatch();
      // Trigger minimap redraw immediately via another rAF (after Cytoscape redraws)
      requestAnimationFrame(() => {
        const cv = minimapRef.current;
        const cyInst = cyRef.current;
        if (!cv || !cyInst) return;
        const ctx = cv.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
        // drawMinimap defined later — call via ref to avoid forward-reference error
        if (minimapTimerRef.current) clearTimeout(minimapTimerRef.current);
        minimapTimerRef.current = setTimeout(() => drawMinimapRef.current?.(), 50);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [filteredNodeIds, filteredEdgeKeys]);

  // ── Animated edge flow (disabled for large graphs — major perf win) ──
  useEffect(() => {
    const nodeCount = data.nodes.length;
    if (nodeCount > 3000) return;              // skip only for very large graphs
    let offset = 0;
    const interval = nodeCount > 150 ? 120 : 60;
    const timer = setInterval(() => {
      const cy = cyRef.current;
      if (!cy) return;
      offset = (offset + 1) % 36;
      cy.edges().style("line-dash-offset", -offset);
    }, interval);
    return () => clearInterval(timer);
  }, [data.nodes.length]);

  // ── zoomTo prop ────────────────────────────────────────────────────────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    // empty array = "zoom out" — go to 100% centered on last node (not fit-all)
    if (zoomTo && zoomTo.length === 0) {
      cy.animate({
        zoom: 1.0,
        center: focusedNodeRef.current
          ? { eles: cy.getElementById(focusedNodeRef.current) }
          : { eles: cy.elements(":visible") },
        duration: 400,
      } as never);
      setIsZoomed(false);
      return;
    }
    if (!zoomTo || zoomTo.length === 0) return;
    const sel = zoomTo.map((id) => `#${CSS.escape(id)}`).join(", ");
    try {
      const nodes = cy.$(sel);
      if (nodes.length > 0) {
        if (nodes.length === 1) {
          // Single node — zoom to 200% centred on it + select it (blue border)
          focusedNodeRef.current = nodes[0].id();
          cy.elements().unselect();
          nodes[0].select();
          cy.animate({ zoom: 2.0, center: { eles: nodes }, duration: 450 } as never);
        } else {
          // Multi-node (ring zoom) — fit to show all members
          cy.animate({ fit: { eles: nodes, padding: 80 }, duration: 500 } as never);
          focusedNodeRef.current = nodes[0].id(); // center zoom-out on first member
        }
        setIsZoomed(true);
      }
    } catch { /* ignore bad selectors */ }
  }, [zoomTo]);

  // ── highlightRingNodes prop — dim all, red-highlight ring members ───────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Batch ALL class changes for instant repaint (eliminates ring-click lag)
    cy.startBatch();

    // Clear previous ring highlight
    cy.elements().removeClass("ring-node ring-edge dimmed highlighted");

    if (!highlightRingNodes || highlightRingNodes.length === 0) {
      cy.endBatch();
      return;
    }

    const ringSet = new Set(highlightRingNodes);
    const ringNodeEls = cy.nodes().filter((n) => ringSet.has(n.id()));

    if (ringNodeEls.length === 0) {
      cy.endBatch();
      return;
    }

    // Dim everything first
    cy.elements().addClass("dimmed");

    // Highlight ring member nodes
    ringNodeEls.removeClass("dimmed").addClass("ring-node");

    // Find and highlight edges between ring members
    cy.edges().forEach((edge) => {
      const srcId = edge.source().id();
      const tgtId = edge.target().id();
      if (ringSet.has(srcId) && ringSet.has(tgtId)) {
        edge.removeClass("dimmed").addClass("ring-edge");
      }
    });

    cy.endBatch();

    // Zoom to ring (outside batch for smooth animation)
    cy.animate({ fit: { eles: ringNodeEls, padding: 80 }, duration: 300 } as never);
  }, [highlightRingNodes]);

  // ── Minimap renderer (sampled for large graphs) ────────────────────────
  const drawMinimap = useCallback(() => {
    const cy = cyRef.current;
    const canvas = minimapRef.current;
    if (!cy || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(13,17,23,0.85)";
    ctx.fillRect(0, 0, W, H);

    const visibleEls = cy.elements(":visible");
    const bb = visibleEls.boundingBox();
    if (!bb || bb.w === 0 || bb.h === 0) return;
    const pad = 10;
    const scaleX = (W - pad * 2) / bb.w;
    const scaleY = (H - pad * 2) / bb.h;
    const scale = Math.min(scaleX, scaleY);
    const offX = pad + ((W - pad * 2) - bb.w * scale) / 2;
    const offY = pad + ((H - pad * 2) - bb.h * scale) / 2;

    const visibleNodes = cy.nodes(":visible");
    const visibleEdges = cy.edges(":visible");
    const nodeCount = visibleNodes.length;
    const maxSampled = 3000;

    // Draw edges (skip for >2000 nodes for perf)
    if (nodeCount <= 2000) {
      ctx.strokeStyle = "rgba(74,111,165,0.3)";
      ctx.lineWidth = 0.5;
      const edgeStep = Math.max(1, Math.ceil(visibleEdges.length / maxSampled));
      for (let i = 0; i < visibleEdges.length; i += edgeStep) {
        const edge = visibleEdges[i];
        const sp = edge.source().position();
        const tp = edge.target().position();
        ctx.beginPath();
        ctx.moveTo(offX + (sp.x - bb.x1) * scale, offY + (sp.y - bb.y1) * scale);
        ctx.lineTo(offX + (tp.x - bb.x1) * scale, offY + (tp.y - bb.y1) * scale);
        ctx.stroke();
      }
    }

    // Draw nodes (sample if too many)
    const nodeStep = Math.max(1, Math.ceil(nodeCount / maxSampled));
    for (let i = 0; i < nodeCount; i += nodeStep) {
      const node = visibleNodes[i];
      const p = node.position();
      const x = offX + (p.x - bb.x1) * scale;
      const y = offY + (p.y - bb.y1) * scale;
      const color: string = node.data("color") ?? "#3d4a5c";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, 1.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw viewport rectangle
    const ext = cy.extent();
    const vx1 = offX + (ext.x1 - bb.x1) * scale;
    const vy1 = offY + (ext.y1 - bb.y1) * scale;
    const vw = (ext.x2 - ext.x1) * scale;
    const vh = (ext.y2 - ext.y1) * scale;
    ctx.strokeStyle = "rgba(99,102,241,0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      Math.max(0, vx1), Math.max(0, vy1),
      Math.min(vw, W), Math.min(vh, H)
    );
  }, []);
  // Keep ref in sync so useEffects declared before can call it without forward-ref errors
  drawMinimapRef.current = drawMinimap;

  // ── Dynamic label updater ─────────────────────────────────────────────
  // ── Dynamic label updater ─────────────────────────────────────────────
  const updateLabels = useCallback((cy: Core, zoom: number) => {
    const level = showLabels ? getLabelLevel(zoom) : "none";
    if (level === labelLevel) return; // no change
    setLabelLevel(level);
    cy.startBatch();
    cy.nodes().forEach((n) => {
      const score: number = n.data("score") ?? 0;
      let shouldShow = false;
      if (level === "all") shouldShow = true;
      else if (level === "suspicious") shouldShow = score > 20;
      else if (level === "high-risk") shouldShow = score > 70;
      // "none" → shouldShow stays false
      if (shouldShow) n.addClass("show-label");
      else n.removeClass("show-label");
    });
    cy.endBatch();
  }, [labelLevel, showLabels]);

  // When showLabels prop toggles, force update immediately
  useEffect(() => {
    const cy = cyRef.current;
    if (cy) updateLabels(cy, cy.zoom());
  }, [showLabels, updateLabels]);

  // ── cy callback: runs once per mount (key forces remount on new data) ──
  const handleCyReady = useCallback(
    (cy: Core) => {
      if (cyRef.current === cy) return; // already initialised this instance
      cyRef.current = cy;

      // ── Performance hints for large graphs ──
      const nodeCount = data.nodes.length;
      // Properly set renderer performance options
      const renderer = (cy as unknown as Record<string, Record<string, unknown>>)._private?.renderer as Record<string, unknown> | undefined;
      if (renderer) {
        if (nodeCount > 150) renderer["textureOnViewport"] = true;
        // NOTE: hideEdgesOnViewport intentionally NOT set — it causes animated
        // flow edges to disappear during pan/drag which breaks the UX.
      }
      if (nodeCount > 200) {
        cy.style().selector("node").style("text-max-width" as string, "60px" as never);
      }

      // Auto-disable minimap for very large graphs
      if (nodeCount > 5000) setShowMinimap(false);

      // Add all elements manually — this way cy.json() never resets positions
      cy.add(elementDefs as never);

      // Tap listener — selection/focus only; zoom is handled by the zoomTo prop.
      // onNodeClickRef → Dashboard.handleNodeClick → setZoomToNodes → zoomTo useEffect → cy.animate
      // NEVER call cy.animate here — would create a second competing animation (flicker/bounce).
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

        // Single source of zoom: delegate to Dashboard via onNodeClick
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

      // Run layout — optimized per graph size
      const edgeCount = cy.edges().length;
      const density = edgeCount / Math.max(nodeCount, 1);
      const sqrtN = Math.sqrt(nodeCount);

      setLayoutRunning(true);

      // Use setTimeout(0) to let React paint the loading overlay BEFORE
      // the synchronous layout blocks the main thread.
      // ── Component-aware layout ─────────────────────────────────────────
      // Strategy:
      //  1. BFS to find connected components (O(N+E))
      //  2. Sort components: largest first
      //  3. Each component gets its own region, laid out by size:
      //     - isolated nodes (single node, no edges) → grid strip at bottom
      //     - small (≤30 nodes)  → cose (physics, best looking)
      //     - medium (≤200)      → concentric
      //     - large (>200)       → circle
      //  4. Components packed left→right, row-wrapping at max canvas width

      const runComponentLayout = async () => {
        // ── Step 1: Build adjacency list in pure JS (no Cytoscape DOM calls) ──
        // This is the critical optimisation: cy.getElementById() inside BFS was
        // calling into the Cytoscape collection API for every node, making BFS
        // O(N²) in practice. With a JS Map it's truly O(N+E).
        const adj = new Map<string, Set<string>>();
        const degreeMap = new Map<string, number>();

        // Initialise every node
        data.nodes.forEach((n) => {
          adj.set(n.id, new Set());
          degreeMap.set(n.id, 0);
        });

        // Fill from edge list
        data.edges.forEach((e) => {
          adj.get(e.source)?.add(e.target);
          adj.get(e.target)?.add(e.source);
          degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
          degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
        });

        // ── Step 2: BFS component finder ── O(N+E), pure JS
        const visited = new Set<string>();
        const components: string[][] = [];
        data.nodes.forEach((n) => {
          const nid = n.id;
          if (visited.has(nid)) return;
          const component: string[] = [];
          const queue = [nid];
          visited.add(nid);
          while (queue.length) {
            const cur = queue.shift()!;
            component.push(cur);
            adj.get(cur)?.forEach((neighbor) => {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
              }
            });
          }
          components.push(component);
        });

        // Sort: largest component first
        components.sort((a, b) => b.length - a.length);

        // Separate isolated nodes (degree 0)
        const isolated: string[] = [];
        const clusters: string[][] = [];
        for (const comp of components) {
          if (comp.length === 1 && (degreeMap.get(comp[0]) ?? 0) === 0) {
            isolated.push(comp[0]);
          } else {
            clusters.push(comp);
          }
        }

        // Canvas packing config
        const CANVAS_W = Math.max(3000, Math.sqrt(nodeCount) * 180);
        const COMP_PADDING = 80;  // gap between components

        let curX = 0;
        let curY = 0;
        let rowMaxH = 0;

        const layoutPromises: Array<Promise<void>> = [];

        for (const comp of clusters) {
          const n = comp.length;
          // radius scales with sqrt(n) — gives good spacing
          const radius = Math.max(100, Math.sqrt(n) * 28);
          const compW = radius * 2 + COMP_PADDING;
          const compH = radius * 2 + COMP_PADDING;

          // Wrap row
          if (curX + compW > CANVAS_W && curX > 0) {
            curX = 0;
            curY += rowMaxH + COMP_PADDING * 1.5;
            rowMaxH = 0;
          }

          const cx = curX + radius;
          const cy2 = curY + radius;

          // Select this component's node elements — layout finds their edges internally
          const sel = comp.map((id) => `#${CSS.escape(id)}`).join(", ");
          const compEls = cy.$(sel);
          const subgraph = compEls;


          const p = new Promise<void>((resolve) => {
            let layoutName: string;
            let layoutOpts: Record<string, unknown>;

            // Hub detection uses pre-computed degreeMap (no Cytoscape calls)
            const maxDegree = Math.max(...comp.map((id) => degreeMap.get(id) ?? 0));
            const isHubStar = maxDegree > Math.max(5, n * 0.25);

            const bb = { x1: cx - radius, y1: cy2 - radius, x2: cx + radius, y2: cy2 + radius };

            if (n === 2) {
              // Two nodes — side by side
              layoutName = "grid";
              layoutOpts = { animate: false, rows: 1, boundingBox: bb };
            } else if (n <= 15 && !isHubStar) {
              // Small true peer cluster — cose for organic look (O(N²·iter), ok up to ~15)
              layoutName = "cose";
              layoutOpts = {
                animate: false, randomize: true,
                nodeRepulsion: () => Math.max(6000, n * 700),
                idealEdgeLength: () => Math.max(50, n * 4),
                nodeOverlap: 20, gravity: 0.3,
                numIter: Math.min(400, n * 20),
                padding: 10, boundingBox: bb,
              };
            } else if (n <= 60 && !isHubStar) {
              // Medium peer cluster — breadthfirst circle (clean, O(N+E))
              layoutName = "breadthfirst";
              layoutOpts = {
                animate: false, directed: false,
                circle: true, grid: false,
                spacingFactor: Math.max(0.55, 1.1 - n * 0.005),
                padding: 10, boundingBox: bb,
              };
            } else if (n <= 150 && !isHubStar) {
              // Large peer cluster — breadthfirst tree (O(N+E))
              layoutName = "breadthfirst";
              layoutOpts = {
                animate: false, directed: false,
                circle: false, grid: false,
                spacingFactor: Math.max(0.5, 1.0 - n * 0.003),
                padding: 10, boundingBox: bb,
              };
            } else {
              // Hub-star or very large — circle (O(N), instant)
              layoutName = "circle";
              layoutOpts = {
                animate: false, padding: 10,
                spacingFactor: Math.max(0.45, 0.95 - n * 0.001),
                boundingBox: bb,
              };
            }


            // Fix race condition: resolve only when layout stops
            (layoutOpts as any).stop = () => resolve();
            subgraph.layout({ name: layoutName, ...layoutOpts } as never).run();
          });

          layoutPromises.push(p);

          curX += compW + COMP_PADDING;
          rowMaxH = Math.max(rowMaxH, compH);
        }

        // Place isolated nodes in a neat compact grid — centred under clusters
        await Promise.all(layoutPromises);

        if (isolated.length > 0) {
          const GRID_CELL = 28;
          const gridCols = Math.ceil(Math.sqrt(isolated.length * 4)); // wide, short grid
          const totalGridW = gridCols * GRID_CELL;
          const gridStartX = Math.max(0, (CANVAS_W / 2) - totalGridW / 2); // centred
          const gridStartY = curY + rowMaxH + COMP_PADDING * 2;

          isolated.forEach((id, i) => {
            const col = i % gridCols;
            const row = Math.floor(i / gridCols);
            cy.getElementById(id).position({
              x: gridStartX + col * GRID_CELL,
              y: gridStartY + row * GRID_CELL,
            });
          });
        }

        // After layout: fit to specific relevant cluster to avoid blank space
        // Prioritize largest cluster with suspicious activity
        let targetClusterIds: string[] | undefined;

        // Find first cluster with a suspicious node (score > 20)
        // Clusters are sorted by size descending (from BFS/Connected Components logic usually)
        if (clusters.length > 0) {
          // Sort clusters by size just in case they aren't fully sorted
          clusters.sort((a, b) => b.length - a.length);

          for (const c of clusters) {
            // Check if cluster has any node with score > 20 (suspicious)
            const hasSuspicious = c.some(id => (cy.getElementById(id).data("score") || 0) > 20);
            if (hasSuspicious) {
              targetClusterIds = c;
              break;
            }
          }
          // Fallback: just use largest cluster if no suspicious found
          if (!targetClusterIds) targetClusterIds = clusters[0];
        }

        if (targetClusterIds && targetClusterIds.length > 0) {
          const targetSet = new Set(targetClusterIds);
          const targetEls = cy.nodes().filter(n => targetSet.has(n.id()));
          if (targetEls.length > 0) {
            cy.fit(targetEls, 40);
          } else {
            cy.fit(undefined, 40);
          }
        } else {
          // All isolated or empty — fit everything
          cy.fit(undefined, 40);
        }
        setLayoutRunning(false);
        setTimeout(drawMinimap, 400);
      };

      // Need async IIFE because we use await inside setTimeout
      setTimeout(async () => {
        try {
          if (nodeCount > 3000) {
            // Very large graph: plain circle — component layout would be too slow
            cy.layout({ name: "circle", fit: true, animate: false, padding: 20, spacingFactor: 0.5 } as never).run();
            setLayoutRunning(false);
            setTimeout(drawMinimap, 400);
          } else {
            await runComponentLayout();
          }
        } catch {
          // Fallback to grid if anything explodes
          cy.layout({ name: "grid", fit: true, animate: false, padding: 30, avoidOverlap: true } as never).run();
          setLayoutRunning(false);
        }
      }, 0);


      // Constrain zoom range
      cy.maxZoom(10.0);   // 1000%
      cy.minZoom(0.01);   // ~0%
      // NOTE: do NOT fit/center here — layout runs in setTimeout(0) and
      // will call cy.fit() when it finishes with correct positions.

      // Initial label update
      updateLabels(cy, cy.zoom());

      // Debounced zoom tracking — adaptive timers based on graph size
      const zoomDebounce = nodeCount > 1000 ? 120 : nodeCount > 300 ? 80 : 30;
      const minimapDebounce = nodeCount > 1000 ? 300 : nodeCount > 300 ? 150 : 60;
      let zoomTimer: ReturnType<typeof setTimeout> | null = null;
      cy.on("zoom", () => {
        if (zoomTimer) clearTimeout(zoomTimer);
        zoomTimer = setTimeout(() => {
          const z = cy.zoom();
          setZoomPercent(Math.round(z * 100));
          // Auto-dismiss node tooltip when zooming out below 0.3
          if (z < 0.3) setTappedNode(null);
          if (nodeCount <= 5000) updateLabels(cy, z);  // skip for very large graphs
          // Schedule minimap redraw
          if (minimapTimerRef.current) clearTimeout(minimapTimerRef.current);
          minimapTimerRef.current = setTimeout(drawMinimap, minimapDebounce);
        }, zoomDebounce);
      });

      // Also redraw minimap on pan AND drag
      const scheduleMinimapRedraw = () => {
        if (minimapTimerRef.current) clearTimeout(minimapTimerRef.current);
        minimapTimerRef.current = setTimeout(drawMinimap, minimapDebounce);
      };
      cy.on("pan", scheduleMinimapRedraw);
      cy.on("dragfree", scheduleMinimapRedraw);
      cy.on("drag", scheduleMinimapRedraw);

      // Initial minimap draw after layout settles
      setTimeout(drawMinimap, 500);
    },
    // elementDefs identity is stable per data (useMemo keyed on data)
    [elementDefs, updateLabels, drawMinimap, data.nodes.length]
  );

  // ── Zoom preset handler ───────────────────────────────────────────────
  const handleZoomPreset = useCallback((level: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({
      zoom: level,
      center: { eles: cy.elements(":visible") },
      duration: 400,
      easing: "ease-in-out-cubic",
    } as never);
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0d1117]">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-gray-800 bg-gray-900 px-3 py-1.5 text-[11px]">
        {/* Risk filter toggles */}
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer select-none items-center gap-1">
            <input type="checkbox" className="accent-red-500 h-3 w-3" checked={showHighRisk}
              onChange={(e) => setShowHighRisk(e.target.checked)} />
            <span className="text-red-400 font-medium">High</span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-1">
            <input type="checkbox" className="accent-amber-500 h-3 w-3" checked={showSuspicious}
              onChange={(e) => setShowSuspicious(e.target.checked)} />
            <span className="text-amber-400 font-medium">Suspicious</span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-1">
            <input type="checkbox" className="accent-green-500 h-3 w-3" checked={showLowRisk}
              onChange={(e) => setShowLowRisk(e.target.checked)} />
            <span className="text-green-400 font-medium">Low</span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-1">
            <input type="checkbox" className="accent-gray-400 h-3 w-3" checked={showNormal}
              onChange={(e) => setShowNormal(e.target.checked)} />
            <span className="text-gray-400 font-medium">Normal</span>
          </label>
        </div>

        <div className="h-4 w-px bg-gray-700" />

        {/* Min Score slider */}
        <label className="flex select-none items-center gap-1.5">
          <span className="text-gray-500">Score≥</span>
          <input type="range" min={0} max={100} step={5} value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-16 accent-yellow-400" />
          <span className="w-5 font-mono text-yellow-300 text-[10px]">{minScore}</span>
        </label>

        <div className="h-4 w-px bg-gray-700" />

        {/* Focus mode */}
        <button
          onClick={() => setFocusModeEnabled((v) => !v)}
          className={`rounded px-1.5 py-0.5 font-semibold transition-colors ${focusModeEnabled ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
        >
          {focusModeEnabled ? "Focus ON" : "Focus"}
        </button>

        <div className="ml-auto flex items-center gap-1">
          {/* Zoom presets */}
          <div className="flex items-center gap-0.5 mr-1">
            {ZOOM_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => handleZoomPreset(p.value)}
                title={`${p.desc} (${Math.round(p.value * 100)}%)`}
                className={`rounded px-1.5 py-0.5 transition-colors ${Math.abs(zoomPercent - p.value * 100) < 5
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                  }`}
              >{p.label}</button>
            ))}
          </div>

          <div className="h-4 w-px bg-gray-700" />

          <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-400 tabular-nums min-w-[36px] text-center">{zoomPercent}%</span>
          <button onClick={() => { cyRef.current?.fit(undefined, 30); setIsZoomed(false); }}
            className="rounded bg-gray-700 px-1.5 py-0.5 text-gray-200 hover:bg-gray-600">Fit</button>
          <button onClick={() => cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 1.3)}
            className="rounded bg-gray-700 px-1.5 py-0.5 text-gray-200 hover:bg-gray-600">+</button>
          <button onClick={() => cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) / 1.3)}
            className="rounded bg-gray-700 px-1.5 py-0.5 text-gray-200 hover:bg-gray-600">−</button>
          {/* Minimap toggle */}
          <button
            onClick={() => setShowMinimap((v) => !v)}
            title="Toggle minimap"
            className={`rounded px-1.5 py-0.5 transition-colors ${showMinimap ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
          >🗺</button>
        </div>
      </div>

      {/* ── Canvas — key forces full remount when data changes ── */}
      <div className="relative min-h-0 flex-1">

        {/* Label level + selected node info — compact bottom-left strip */}
        <div className="pointer-events-none absolute bottom-10 left-3 z-10 flex flex-col gap-1">
          <div className="rounded bg-black/60 px-2 py-0.5 text-[9px] font-medium text-gray-500 backdrop-blur-sm">
            Labels: {labelLevel === "none" ? "hidden" : labelLevel === "high-risk" ? "high risk only" : labelLevel === "suspicious" ? "suspicious+" : "all"}
            {isZoomed && <span className="ml-2 text-blue-400">· click node again to zoom out</span>}
          </div>
          {tappedNode && (
            <div className="flex items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-[10px] backdrop-blur-sm">
              <span className={`h-2 w-2 rounded-full shrink-0 ${tappedNode.score > 70 ? "bg-red-500" : tappedNode.score > 20 ? "bg-yellow-500" : "bg-green-500"}`} />
              <span className="font-mono font-semibold text-white">{tappedNode.id}</span>
              <span className={`ml-0.5 ${tappedNode.score > 70 ? "text-red-400" : tappedNode.score > 20 ? "text-yellow-400" : "text-green-400"}`}>
                {tappedNode.score > 70 ? "High Risk" : tappedNode.score > 20 ? "Suspicious" : "Normal"}
              </span>
              <span className="ml-auto text-gray-500">score {tappedNode.score}</span>
            </div>
          )}
        </div>

        {/* Layout-running overlay — prevents interaction while cose runs */}
        {layoutRunning && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm">
            <div className="relative h-12 w-12 mb-3">
              <div className="absolute inset-0 animate-spin rounded-full border-4 border-red-900 border-t-red-500" />
              <div className="absolute inset-2 animate-spin rounded-full border-2 border-red-800 border-b-red-400" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
            <p className="text-sm font-semibold text-white">Computing layout…</p>
            <p className="text-[11px] text-gray-400 mt-1">{data.nodes.length.toLocaleString()} nodes · {data.edges.length.toLocaleString()} edges</p>
            <p className="text-[11px] text-red-400 mt-0.5 tabular-nums">{(layoutElapsedMs / 1000).toFixed(2)}s</p>
          </div>
        )}

        <CytoscapeComponent
          key={graphKey}
          elements={[]}
          stylesheet={stylesheet as never}
          style={{ width: "100%", height: "100%", minHeight: 300, background: "rgba(13,17,23,0.95)" }}
          cy={(cy: Core) => handleCyReady(cy)}
          wheelSensitivity={0.3}
        />

        {/* ── Minimap ── */}
        {showMinimap && (
          <div className="absolute bottom-3 right-3 z-20 overflow-hidden rounded-lg border border-gray-600/70 shadow-2xl"
            style={{ boxShadow: "0 0 0 1px rgba(99,102,241,0.3), 0 8px 32px rgba(0,0,0,0.6)" }}
          >
            <canvas
              ref={minimapRef}
              width={220}
              height={160}
              className="block"
              style={{ background: "rgba(13,17,23,0.92)", cursor: "crosshair" }}
              onClick={(e) => {
                const cy = cyRef.current;
                const canvas = minimapRef.current;
                if (!cy || !canvas) return;
                const rect = canvas.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;
                const W = rect.width;
                const H = rect.height;
                const pad = 10;
                const visibleEls = cy.elements(":visible");
                const bb = visibleEls.boundingBox();
                if (!bb || bb.w === 0 || bb.h === 0) return;
                const scaleX = (W - pad * 2) / bb.w;
                const scaleY = (H - pad * 2) / bb.h;
                const scale = Math.min(scaleX, scaleY);
                const offX = pad + ((W - pad * 2) - bb.w * scale) / 2;
                const offY = pad + ((H - pad * 2) - bb.h * scale) / 2;
                const worldX = bb.x1 + (clickX - offX) / scale;
                const worldY = bb.y1 + (clickY - offY) / scale;

                // Zoom in to at least 150% (stay at current if already deeper)
                const targetZoom = Math.max(cy.zoom(), 1.5);

                // Find nearest visible node within 200 world-units of the click point
                let nearestNode: ReturnType<typeof cy.nodes>[0] | null = null;
                let nearestDist = 200; // threshold in world units
                cy.nodes(":visible").forEach((n) => {
                  const pos = n.position();
                  const dx = pos.x - worldX;
                  const dy = pos.y - worldY;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestNode = n;
                  }
                });

                if (nearestNode) {
                  // Center on nearest node + zoom in + select it
                  const nPos = (nearestNode as ReturnType<typeof cy.nodes>[0]).position();
                  cy.animate({
                    zoom: targetZoom,
                    pan: {
                      x: cy.width() / 2 - nPos.x * targetZoom,
                      y: cy.height() / 2 - nPos.y * targetZoom,
                    },
                    duration: 300,
                    easing: "ease-out",
                  } as never);
                  const nId: string = (nearestNode as ReturnType<typeof cy.nodes>[0]).id();
                  const nScore: number = (nearestNode as ReturnType<typeof cy.nodes>[0]).data("score") ?? 0;
                  setTappedNode({ id: nId, score: nScore });
                  focusedNodeRef.current = nId;
                  setIsZoomed(true);
                  onNodeClickRef.current(nId);
                } else {
                  // No nearby node — just pan + zoom to the clicked area
                  cy.animate({
                    zoom: targetZoom,
                    pan: {
                      x: cy.width() / 2 - worldX * targetZoom,
                      y: cy.height() / 2 - worldY * targetZoom,
                    },
                    duration: 250,
                    easing: "ease-out",
                  } as never);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 bg-gray-900 px-4 py-1.5 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-gray-500" /> Normal</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#6b8a3d]" /> Low Risk</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Suspicious</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> High Risk</span>
        <span className="text-gray-600">•</span>
        <span className="text-gray-600">Node size = connections</span>
        <span className="ml-auto italic text-gray-600">Zoom in for labels · Click node for details</span>
      </div>
    </div>
  );
}

