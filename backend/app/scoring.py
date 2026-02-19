"""
Scoring module – calculates a suspicion score (0-100) for every account
based on detection results and false-positive filters.
"""

from __future__ import annotations

from typing import Dict, List

from .models import (
    AccountProfile,
    CycleResult,
    FraudRing,
    ShellResult,
    SmurfingResult,
    SuspiciousAccount,
)

import networkx as nx


def calculate_scores(
    profiles: Dict[str, AccountProfile],
    cycles: List[CycleResult],
    smurfing: List[SmurfingResult],
    shells: List[ShellResult],
) -> Dict[str, float]:
    """
    Return ``{account_id: suspicion_score}`` for every account.
    Optimized: pre-build lookup maps to avoid O(N*M) loops.
    """
    # Pre-build per-account contribution maps
    cycle_scores: Dict[str, float] = {}
    for cyc in cycles:
        contrib = 20 * (6 - cyc.length)
        if cyc.total_amount > 10_000:
            contrib += 10
        for node in cyc.nodes:
            cycle_scores[node] = cycle_scores.get(node, 0) + contrib

    smurf_scores: Dict[str, float] = {}
    for s in smurfing:
        base = 15.0
        if s.unique_counterparties > 20:
            base += 5
        if s.velocity_per_hour > 5_000:
            base += 10
        smurf_scores[s.account_id] = smurf_scores.get(s.account_id, 0) + base

    shell_scores: Dict[str, float] = {}
    for sh in shells:
        for node in sh.intermediate_accounts:
            shell_scores[node] = shell_scores.get(node, 0) + 25

    scores: Dict[str, float] = {}
    for acct_id, profile in profiles.items():
        score = cycle_scores.get(acct_id, 0) + smurf_scores.get(acct_id, 0) + shell_scores.get(acct_id, 0)

        if score <= 0:
            continue

        # False-positive reductions
        if profile.is_payroll:
            score = max(0, score - 30)
        if profile.is_merchant:
            score = max(0, score - 25)
        if profile.is_salary:
            score = max(0, score - 20)
        if profile.is_established_business:
            score = max(0, score - 35)

        score = min(100.0, round(score, 1))
        if score > 0:
            scores[acct_id] = score

    return scores


# ── Build output objects ─────────────────────────────────────────────────────

def build_suspicious_accounts(
    scores: Dict[str, float],
    cycles: List[CycleResult],
    smurfing: List[SmurfingResult],
    shells: List[ShellResult],
    profiles: Dict[str, AccountProfile] | None = None,
    graph: nx.MultiDiGraph | None = None,
) -> List[SuspiciousAccount]:
    """
    Create SuspiciousAccount entries for all accounts with score > 0,
    sorted descending by score.
    """
    # Build pattern and ring maps
    pattern_map: Dict[str, List[str]] = {}
    ring_map: Dict[str, List[str]] = {}

    for cyc in cycles:
        for node in cyc.nodes:
            pattern_map.setdefault(node, []).append(f"cycle_length_{cyc.length}")
            if cyc.total_amount > 10_000:
                pattern_map.setdefault(node, []).append("high_value_cycle")
            ring_map.setdefault(node, []).append(cyc.ring_id)

    for s in smurfing:
        # Emit clean, separate pattern tags (spec format)
        pattern_map.setdefault(s.account_id, []).append(s.pattern_type)  # "fan_in" or "fan_out"
        if s.velocity_per_hour > 5_000:
            pattern_map.setdefault(s.account_id, []).append("high_velocity")
        if s.unique_counterparties > 20:
            pattern_map.setdefault(s.account_id, []).append("structuring")
        if s.ring_id:
            ring_map.setdefault(s.account_id, []).append(s.ring_id)

    for sh in shells:
        for node in sh.chain:
            pattern_map.setdefault(node, []).append(f"shell_depth_{sh.shell_depth}")
            ring_map.setdefault(node, []).append(sh.ring_id)

    accounts = []
    for acct_id, score in scores.items():
        if score <= 0:
            continue
        rings = ring_map.get(acct_id, [])
        profile = profiles.get(acct_id) if profiles else None
        connected: List[str] = []
        if graph and graph.has_node(acct_id):
            connected = list(set(list(graph.successors(acct_id)) + list(graph.predecessors(acct_id))))
        accounts.append(
            SuspiciousAccount(
                account_id=acct_id,
                suspicion_score=score,
                detected_patterns=list(set(pattern_map.get(acct_id, []))),
                ring_id=rings[0] if rings else "",
                account_type=profile.account_type.value if profile else "individual",
                total_inflow=profile.total_inflow if profile else 0.0,
                total_outflow=profile.total_outflow if profile else 0.0,
                transaction_count=profile.transaction_count if profile else 0,
                connected_accounts=connected,
                ring_ids=list(set(rings)),
            )
        )

    accounts.sort(key=lambda a: a.suspicion_score, reverse=True)
    return accounts


def build_fraud_rings(
    scores: Dict[str, float],
    cycles: List[CycleResult],
    smurfing: List[SmurfingResult],
    shells: List[ShellResult],
) -> List[FraudRing]:
    """Create FraudRing entries from all detected patterns."""
    rings: List[FraudRing] = []

    for cyc in cycles:
        member_scores = [scores.get(n, 0) for n in cyc.nodes]
        avg = sum(member_scores) / len(member_scores) if member_scores else 0
        # Boost if all members are high risk
        if all(s > 70 for s in member_scores) and member_scores:
            avg = min(100, avg * 1.2)
        rings.append(
            FraudRing(
                ring_id=cyc.ring_id,
                member_accounts=cyc.nodes,
                pattern_type="cycle",
                risk_score=round(avg, 1),
            )
        )

    # Group smurfing by ring_id
    smurf_groups: Dict[str, List[str]] = {}
    for s in smurfing:
        if s.ring_id:
            smurf_groups.setdefault(s.ring_id, []).append(s.account_id)
        else:
            # Assign ad hoc ring
            rid = f"SMURF_{s.account_id}"
            smurf_groups.setdefault(rid, []).append(s.account_id)

    for rid, members in smurf_groups.items():
        member_scores = [scores.get(m, 0) for m in members]
        avg = sum(member_scores) / len(member_scores) if member_scores else 0
        rings.append(
            FraudRing(
                ring_id=rid,
                member_accounts=members,
                pattern_type="smurfing",
                risk_score=round(avg, 1),
            )
        )

    for sh in shells:
        member_scores = [scores.get(n, 0) for n in sh.chain]
        avg = sum(member_scores) / len(member_scores) if member_scores else 0
        rings.append(
            FraudRing(
                ring_id=sh.ring_id,
                member_accounts=sh.chain,
                pattern_type="shell",
                risk_score=round(avg, 1),
            )
        )

    rings.sort(key=lambda r: r.risk_score, reverse=True)
    return rings
