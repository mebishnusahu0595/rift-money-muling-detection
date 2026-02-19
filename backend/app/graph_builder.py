"""
Graph Builder – converts a CSV DataFrame into a NetworkX DiGraph.

Nodes: unique account IDs (sender + receiver).
Edges: directed, from sender → receiver, with transaction attributes.
"""

from __future__ import annotations

from typing import Dict, Tuple

import networkx as nx
import pandas as pd

from .models import AccountProfile, AccountType, GraphData, GraphEdge, GraphNode


def build_graph(df: pd.DataFrame) -> nx.MultiDiGraph:
    """
    Build a directed multi-graph from a transactions DataFrame.
    Optimized: vectorized aggregation + itertuples for edge insertion.
    """
    G = nx.MultiDiGraph()

    # Collect all unique accounts
    all_accounts = set(df["sender"].unique()) | set(df["receiver"].unique())

    # Pre-compute per-account aggregates using pandas (fast)
    inflow = df.groupby("receiver")["amount"].agg(["sum", "count"]).rename(
        columns={"sum": "total_inflow", "count": "in_count"}
    )
    outflow = df.groupby("sender")["amount"].agg(["sum", "count"]).rename(
        columns={"sum": "total_outflow", "count": "out_count"}
    )

    first_seen_s = df.groupby("sender")["timestamp"].min()
    first_seen_r = df.groupby("receiver")["timestamp"].min()
    last_seen_s = df.groupby("sender")["timestamp"].max()
    last_seen_r = df.groupby("receiver")["timestamp"].max()

    for acct in all_accounts:
        ti = float(inflow.loc[acct, "total_inflow"]) if acct in inflow.index else 0.0
        to_ = float(outflow.loc[acct, "total_outflow"]) if acct in outflow.index else 0.0
        ic = int(inflow.loc[acct, "in_count"]) if acct in inflow.index else 0
        oc = int(outflow.loc[acct, "out_count"]) if acct in outflow.index else 0

        fs_vals = []
        if acct in first_seen_s.index:
            fs_vals.append(first_seen_s[acct])
        if acct in first_seen_r.index:
            fs_vals.append(first_seen_r[acct])
        fs = min(fs_vals) if fs_vals else None

        ls_vals = []
        if acct in last_seen_s.index:
            ls_vals.append(last_seen_s[acct])
        if acct in last_seen_r.index:
            ls_vals.append(last_seen_r[acct])
        ls = max(ls_vals) if ls_vals else None

        txn_count = ic + oc

        acct_type = (
            AccountType.BUSINESS
            if txn_count > 50 or _looks_like_business(str(acct))
            else AccountType.INDIVIDUAL
        )

        G.add_node(
            acct,
            account_type=acct_type.value,
            total_inflow=ti,
            total_outflow=to_,
            transaction_count=txn_count,
            first_seen=fs,
            last_seen=ls,
        )

    # Add edges using itertuples (100x faster than iterrows)
    has_txn_id = "transaction_id" in df.columns
    for row in df.itertuples(index=False):
        sender = row.sender
        receiver = row.receiver
        if sender == receiver:
            continue
        G.add_edge(
            sender,
            receiver,
            transaction_id=getattr(row, "transaction_id", "") if has_txn_id else "",
            amount=float(row.amount),
            timestamp=row.timestamp,
            currency="USD",
        )

    return G


def _looks_like_business(name: str) -> bool:
    """Very simple heuristic for business-like account names."""
    patterns = ["corp", "inc", "llc", "ltd", "co.", "merchant", "store", "shop", "pay"]
    lower = name.lower()
    return any(p in lower for p in patterns)


# ── Helper: collapse multi-graph to simple DiGraph for cycle detection ───────

def collapse_to_digraph(G: nx.MultiDiGraph) -> nx.DiGraph:
    """
    Collapse multi-edges into a simple DiGraph, summing amounts
    and keeping earliest/latest timestamps.
    """
    simple = nx.DiGraph()
    simple.add_nodes_from(G.nodes(data=True))

    for u, v, data in G.edges(data=True):
        if simple.has_edge(u, v):
            ed = simple[u][v]
            ed["total_amount"] = ed.get("total_amount", 0) + data.get("amount", 0)
            ed["transaction_count"] = ed.get("transaction_count", 0) + 1
            ts = data.get("timestamp")
            if ts is not None:
                ed.setdefault("timestamps", []).append(ts)
        else:
            ts = data.get("timestamp")
            simple.add_edge(
                u,
                v,
                total_amount=data.get("amount", 0),
                transaction_count=1,
                timestamps=[ts] if ts is not None else [],
            )
    return simple


# ── Build account profiles dict ─────────────────────────────────────────────

def build_account_profiles(G: nx.MultiDiGraph) -> Dict[str, AccountProfile]:
    """Create AccountProfile objects for every node in the graph."""
    profiles: Dict[str, AccountProfile] = {}
    for node, attrs in G.nodes(data=True):
        profiles[node] = AccountProfile(
            account_id=node,
            account_type=AccountType(attrs.get("account_type", "individual")),
            total_inflow=attrs.get("total_inflow", 0),
            total_outflow=attrs.get("total_outflow", 0),
            transaction_count=attrs.get("transaction_count", 0),
            first_seen=attrs.get("first_seen"),
            last_seen=attrs.get("last_seen"),
        )
    return profiles


# ── Build frontend-friendly graph data ───────────────────────────────────────

def build_graph_data(
    G: nx.MultiDiGraph,
    scores: Dict[str, float] | None = None,
    ring_map: Dict[str, list] | None = None,
    pattern_map: Dict[str, list] | None = None,
) -> GraphData:
    """Convert graph to serialisable GraphData for the frontend."""
    scores = scores or {}
    ring_map = ring_map or {}
    pattern_map = pattern_map or {}

    nodes = []
    for n, attrs in G.nodes(data=True):
        nodes.append(
            GraphNode(
                id=n,
                suspicion_score=scores.get(n, 0.0),
                ring_ids=ring_map.get(n, []),
                total_inflow=attrs.get("total_inflow", 0),
                total_outflow=attrs.get("total_outflow", 0),
                transaction_count=attrs.get("transaction_count", 0),
                detected_patterns=pattern_map.get(n, []),
            )
        )

    # Aggregate edges for frontend
    edge_agg: Dict[Tuple[str, str], Tuple[float, int]] = {}
    for u, v, data in G.edges(data=True):
        key = (u, v)
        amt, cnt = edge_agg.get(key, (0.0, 0))
        edge_agg[key] = (amt + data.get("amount", 0), cnt + 1)

    edges = [
        GraphEdge(source=u, target=v, amount=amt, transaction_count=cnt)
        for (u, v), (amt, cnt) in edge_agg.items()
    ]

    return GraphData(nodes=nodes, edges=edges)
