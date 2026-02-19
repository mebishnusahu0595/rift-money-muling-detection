"""
Cycle Detector – finds circular fund routing (cycles of length 3-5).

Uses Johnson's algorithm via NetworkX ``simple_cycles`` with a cutoff
and filters for temporal coherence (72-hour window).
"""

from __future__ import annotations

from datetime import timedelta
from typing import List

import networkx as nx
import pandas as pd

from ..models import CycleResult


_MAX_CYCLES = 5_000  # safety cap to avoid combinatorial explosion


def detect_cycles(
    G: nx.MultiDiGraph,
    df: pd.DataFrame,
    max_length: int = 5,
    time_window_hours: float = 72.0,
) -> List[CycleResult]:
    """
    Find all simple cycles of length 3..max_length that are temporally
    coherent (all edge timestamps within *time_window_hours*).

    Parameters
    ----------
    G : nx.MultiDiGraph
        Transaction graph.
    df : pd.DataFrame
        Original transactions (used for timestamp look-ups).
    max_length : int
        Maximum cycle length to search for.
    time_window_hours : float
        Maximum time span between first and last transaction in a cycle.

    Returns
    -------
    list[CycleResult]
    """
    # Use a simple DiGraph for cycle detection (much faster)
    simple_G = nx.DiGraph()
    simple_G.add_nodes_from(G.nodes())
    simple_G.add_edges_from(set(G.edges()))

    # Build a fast look-up: (sender, receiver) → list of (amount, timestamp)
    # Ensure amount is numeric in case the caller hasn't sanitised the df.
    df = df.copy()
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.dropna(subset=["timestamp"])

    edge_data: dict[tuple[str, str], list[tuple[float, pd.Timestamp]]] = {}
    for _, row in df.iterrows():
        key = (str(row["sender"]), str(row["receiver"]))
        edge_data.setdefault(key, []).append(
            (float(row["amount"]), pd.Timestamp(row["timestamp"]))
        )

    cycles: List[CycleResult] = []
    ring_counter = 0
    window = timedelta(hours=time_window_hours)

    try:
        for cycle_nodes in nx.simple_cycles(simple_G, length_bound=max_length):
            if len(cycle_nodes) < 3:
                continue

            # Build list of edges in cycle order
            edges_in_cycle = []
            for i in range(len(cycle_nodes)):
                u = cycle_nodes[i]
                v = cycle_nodes[(i + 1) % len(cycle_nodes)]
                edge_txns = edge_data.get((u, v), [])
                edges_in_cycle.append((u, v, edge_txns))

            # Need at least one transaction per edge
            if any(len(txns) == 0 for _, _, txns in edges_in_cycle):
                continue

            # Gather all timestamps from cycle edges
            all_timestamps = []
            total_amount = 0.0
            for _, _, txns in edges_in_cycle:
                for amt, ts in txns:
                    if pd.notna(ts):
                        all_timestamps.append(ts)
                    total_amount += amt

            if not all_timestamps:
                continue

            min_ts = min(all_timestamps)
            max_ts = max(all_timestamps)
            span = max_ts - min_ts

            # Temporal coherence check
            if span <= window:
                ring_counter += 1
                cycles.append(
                    CycleResult(
                        ring_id=f"RING_{ring_counter:03d}",
                        nodes=[str(n) for n in cycle_nodes],
                        length=len(cycle_nodes),
                        total_amount=round(total_amount, 2),
                        time_span_hours=round(span.total_seconds() / 3600, 2),
                        edge_count=len(edges_in_cycle),
                        pattern_type="cycle",
                    )
                )

            if len(cycles) >= _MAX_CYCLES:
                break

    except Exception:
        # NetworkX may raise on very dense graphs – return what we have
        pass

    return cycles
