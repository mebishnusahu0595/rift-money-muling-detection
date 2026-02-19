import React, { useCallback, useMemo, useRef, useEffect } from "react";
import cytoscape from "cytoscape";
import type { GraphData, GraphNode } from "../types";

interface Props {
  data: GraphData;
  onNodeClick: (nodeId: string) => void;
}

const RING_COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

const GraphViz: React.FC<Props> = ({ data, onNodeClick }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  // Build ring → colour map
  const ringColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    let idx = 0;
    data.nodes.forEach((n) => {
      n.ring_ids.forEach((r) => {
        if (!map[r]) {
          map[r] = RING_COLORS[idx % RING_COLORS.length];
          idx++;
        }
      });
    });
    return map;
  }, [data]);

  const nodeColor = useCallback(
    (n: GraphNode) => {
      if (n.suspicion_score > 70) return "#ef4444";
      if (n.suspicion_score > 30) return "#f59e0b";
      return "#6b7280";
    },
    []
  );

  const nodeSize = useCallback((n: GraphNode) => {
    if (n.suspicion_score > 70) return 40;
    if (n.suspicion_score > 30) return 30;
    return 20;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const elements: cytoscape.ElementDefinition[] = [];

    data.nodes.forEach((n) => {
      const borderColor =
        n.ring_ids.length > 0 ? ringColorMap[n.ring_ids[0]] ?? "#6b7280" : "transparent";
      elements.push({
        data: {
          id: n.id,
          label: n.id.length > 10 ? n.id.slice(0, 8) + "…" : n.id,
          score: n.suspicion_score,
          bgColor: nodeColor(n),
          borderColor,
          size: nodeSize(n),
          ring_ids: n.ring_ids,
          total_inflow: n.total_inflow,
          total_outflow: n.total_outflow,
          transaction_count: n.transaction_count,
          detected_patterns: n.detected_patterns,
          suspicion_score: n.suspicion_score,
        },
        group: "nodes",
      });
    });

    const maxAmt = Math.max(...data.edges.map((e) => e.amount), 1);

    data.edges.forEach((e, i) => {
      elements.push({
        data: {
          id: `e${i}`,
          source: e.source,
          target: e.target,
          amount: e.amount,
          width: Math.max(1, (e.amount / maxAmt) * 6),
        },
        group: "edges",
      });
    });

    const nodeCount = data.nodes.length;
    // Dynamically scale repulsion and edge length so graph breathes with more nodes
    const repulsion = Math.max(10000, nodeCount * 2000);
    const edgeLen = Math.max(120, nodeCount * 15);
    const fontSize = nodeCount > 20 ? "8px" : nodeCount > 12 ? "9px" : "10px";

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(bgColor)" as any,
            label: "data(label)",
            "font-size": fontSize as any,
            color: "#d1d5db",
            "text-outline-width": 1,
            "text-outline-color": "#111827",
            width: "data(size)",
            height: "data(size)",
            "border-width": 3,
            "border-color": "data(borderColor)" as any,
          },
        },
        {
          selector: "edge",
          style: {
            width: "data(width)" as any,
            "line-color": "#4b5563",
            "target-arrow-color": "#4b5563",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            opacity: 0.6,
          },
        },
      ],
      layout: {
        name: "cose",
        animate: false,
        nodeRepulsion: () => repulsion,
        idealEdgeLength: () => edgeLen,
        nodeOverlap: 30,
        gravity: 0.4,
        numIter: 2500,
        componentSpacing: 80,
        coolingFactor: 0.95,
        padding: 50,
      } as any,
      minZoom: 0.1,
      maxZoom: 5,
    });

    cy.on("tap", "node", (evt) => {
      const id = evt.target.id();
      onNodeClick(id);
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [data, ringColorMap, nodeColor, nodeSize, onNodeClick]);

  const handleFit = useCallback(() => {
    cyRef.current?.fit(undefined, 30);
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-xl bg-gray-900/60" />
      <button
        onClick={handleFit}
        className="absolute top-2 right-2 rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600"
      >
        Fit
      </button>
    </div>
  );
};

export default GraphViz;
