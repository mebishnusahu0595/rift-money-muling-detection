"""
Shell Detector – identifies layered shell networks.

Looks for chains of 3+ hops where intermediate accounts have very
low activity (≤3 total transactions), indicating pass-through behaviour.
Optimized: limit source/sink enumeration and path exploration.
"""

from __future__ import annotations

from itertools import islice
from typing import Dict, List, Set, Tuple

import networkx as nx
import pandas as pd

from ..models import ShellResult


_MAX_PATHS = 500  # reduced safety cap for speed


def detect_shells(
    G: nx.MultiDiGraph,
    max_intermediate_txns: int = 3,
    min_chain_length: int = 3,
    max_chain_length: int = 5,
) -> List[ShellResult]:
    """
    Find layered shell networks – chains A→B→C→D where intermediate
    nodes (B, C) have very low total transaction counts.
    Optimized: limited source/sink enumeration, BFS with early cuts.
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

    simple_G = nx.DiGraph(G)

    # Only consider shell candidates' neighbors as sources/sinks (much faster)
    # Sources: nodes that send TO shell candidates
    # Sinks: nodes that receive FROM shell candidates
    sources_set: Set[str] = set()
    sinks_set: Set[str] = set()
    for sc in shell_candidates:
        for pred in simple_G.predecessors(sc):
            if pred not in shell_candidates:
                sources_set.add(pred)
        for succ in simple_G.successors(sc):
            if succ not in shell_candidates:
                sinks_set.add(succ)

    # Limit to top sources/sinks by degree to avoid explosion
    sources = sorted(sources_set, key=lambda n: simple_G.out_degree(n), reverse=True)[:100]
    sinks = sorted(sinks_set, key=lambda n: simple_G.in_degree(n), reverse=True)[:100]

    if not sources or not sinks:
        return []

    results: List[ShellResult] = []
    seen_chains: Set[Tuple[str, ...]] = set()
    ring_counter = 0

    for source in sources:
        if ring_counter >= _MAX_PATHS:
            break

        for target in sinks:
            if source == target:
                continue
            if ring_counter >= _MAX_PATHS:
                break
            try:
                paths = nx.all_simple_paths(
                    simple_G, source, target, cutoff=max_chain_length
                )
                for path in islice(paths, 50):  # reduced from 200
                    if len(path) - 1 < min_chain_length:
                        continue

                    intermediates = path[1:-1]
                    if not intermediates:
                        continue

                    # All intermediates must be low-activity
                    if not all(n in shell_candidates for n in intermediates):
                        continue

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
