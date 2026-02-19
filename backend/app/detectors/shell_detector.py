"""
Shell Detector – identifies layered shell networks.

Looks for chains of 3+ hops where intermediate accounts have very
low activity (≤3 total transactions), indicating pass-through behaviour.
"""

from __future__ import annotations

from itertools import islice
from typing import Dict, List, Set, Tuple

import networkx as nx
import pandas as pd

from ..models import ShellResult


_MAX_PATHS = 2_000  # safety cap


def detect_shells(
    G: nx.MultiDiGraph,
    max_intermediate_txns: int = 3,
    min_chain_length: int = 3,
    max_chain_length: int = 6,
) -> List[ShellResult]:
    """
    Find layered shell networks – chains A→B→C→D where intermediate
    nodes (B, C) have very low total transaction counts.

    Parameters
    ----------
    G : nx.MultiDiGraph
        Transaction graph.
    max_intermediate_txns : int
        Maximum transactions for a node to be considered a "shell".
    min_chain_length : int
        Minimum hops (edges) in a chain.
    max_chain_length : int
        Maximum hops to search.

    Returns
    -------
    list[ShellResult]
    """
    # Pre-compute node transaction counts
    txn_counts: Dict[str, int] = {}
    for node, attrs in G.nodes(data=True):
        txn_counts[node] = attrs.get("transaction_count", 0)

    # Identify potential shell (low-activity) nodes
    shell_candidates: Set[str] = {
        n for n, c in txn_counts.items() if 0 < c <= max_intermediate_txns
    }

    if not shell_candidates:
        return []

    # Find sources (nodes with in-degree == 0 or high out-degree)
    # and sinks (nodes with out-degree == 0 or high in-degree)
    simple_G = nx.DiGraph(G)
    sources = [n for n in simple_G.nodes() if simple_G.in_degree(n) == 0 or simple_G.out_degree(n) > simple_G.in_degree(n)]
    sinks = [n for n in simple_G.nodes() if simple_G.out_degree(n) == 0 or simple_G.in_degree(n) > simple_G.out_degree(n)]

    # Fallback: use all nodes if no clear sources/sinks
    if not sources:
        sources = list(simple_G.nodes())
    if not sinks:
        sinks = list(simple_G.nodes())

    results: List[ShellResult] = []
    seen_chains: Set[Tuple[str, ...]] = set()
    ring_counter = 0

    for source in sources:
        if ring_counter >= _MAX_PATHS:
            break

        # BFS/DFS for paths through shell candidates
        for target in sinks:
            if source == target:
                continue
            try:
                paths = nx.all_simple_paths(
                    simple_G, source, target, cutoff=max_chain_length
                )
                for path in islice(paths, 200):
                    if len(path) - 1 < min_chain_length:
                        continue

                    # Check intermediates
                    intermediates = path[1:-1]
                    if not intermediates:
                        continue

                    # All intermediates must be low-activity
                    if all(n in shell_candidates for n in intermediates):
                        chain_key = tuple(path)
                        if chain_key in seen_chains:
                            continue
                        seen_chains.add(chain_key)

                        # Verify pass-through: inflow ≈ outflow for intermediates
                        is_passthrough = True
                        for inode in intermediates:
                            inflow = G.nodes[inode].get("total_inflow", 0)
                            outflow = G.nodes[inode].get("total_outflow", 0)
                            if inflow > 0 and outflow > 0:
                                ratio = min(inflow, outflow) / max(inflow, outflow)
                                if ratio < 0.5:
                                    is_passthrough = False
                                    break
                            else:
                                is_passthrough = False
                                break

                        if not is_passthrough:
                            continue

                        # Calculate total amount through chain
                        total_amount = _chain_amount(G, path)

                        ring_counter += 1
                        results.append(
                            ShellResult(
                                ring_id=f"RING_{ring_counter:03d}",
                                pattern_type="shell",
                                chain=[str(n) for n in path],
                                intermediate_accounts=[str(n) for n in intermediates],
                                total_amount=round(total_amount, 2),
                                shell_depth=len(intermediates),
                            )
                        )

                        if ring_counter >= _MAX_PATHS:
                            break
            except (nx.NetworkXError, nx.NodeNotFound):
                continue

    return results


def _chain_amount(G: nx.MultiDiGraph, path: list) -> float:
    """Sum the minimum edge amount along the chain (bottleneck)."""
    total = 0.0
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        edge_amounts = [d.get("amount", 0) for _, _, d in G.edges(u, data=True) if _ == v]
        if not edge_amounts:
            # Try alternate lookup for MultiDiGraph
            if G.has_edge(u, v):
                edge_amounts = [
                    G[u][v][k].get("amount", 0) for k in G[u][v]
                ]
        total += sum(edge_amounts) if edge_amounts else 0
    return total
