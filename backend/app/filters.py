"""
False-positive filters – identify legitimate accounts to reduce
their suspicion scores.

Categories detected:
 • Payroll accounts   (regular monthly deposits from one employer)
 • Merchant accounts  (many small inflows, few large outflows)
 • Salary accounts    (single large monthly deposit + regular bills)
 • Established business (long history, diverse counterparties)
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import timedelta
from typing import Dict

import numpy as np
import pandas as pd

from .models import AccountProfile


def apply_filters(
    profiles: Dict[str, AccountProfile],
    df: pd.DataFrame,
) -> Dict[str, AccountProfile]:
    """
    Enrich each AccountProfile with boolean flags for legitimate-account
    heuristics.  Returns the same dict, mutated in-place for efficiency.
    """
    # Data already sanitized by _run_analysis — no need to re-copy/convert

    # Group once for reuse
    incoming = df.groupby("receiver")
    outgoing = df.groupby("sender")

    for acct_id, profile in profiles.items():
        inc = incoming.get_group(acct_id) if acct_id in incoming.groups else pd.DataFrame()
        out = outgoing.get_group(acct_id) if acct_id in outgoing.groups else pd.DataFrame()

        profile.is_payroll = _is_payroll(inc)
        profile.is_merchant = _is_merchant(inc, out)
        profile.is_salary = _is_salary(inc, out)
        profile.is_established_business = _is_established_business(inc, out, acct_id)

    return profiles


# ── Individual detection functions ───────────────────────────────────────────

def _is_payroll(inc: pd.DataFrame, tolerance: float = 0.10) -> bool:
    """
    Payroll pattern: single dominant sender, regular monthly interval,
    consistent amount (±10 %).
    """
    if inc.empty or len(inc) < 3:
        return False

    sender_counts = inc["sender"].value_counts()
    dominant_ratio = sender_counts.iloc[0] / len(inc)

    if dominant_ratio < 0.80:
        return False

    # Check amount consistency
    dominant_sender = sender_counts.index[0]
    sub = inc[inc["sender"] == dominant_sender].sort_values("timestamp")
    amounts = sub["amount"].values

    if len(amounts) < 3:
        return False

    mean_amt = np.mean(amounts)
    if mean_amt == 0:
        return False
    cv = np.std(amounts) / mean_amt  # coefficient of variation
    if cv > tolerance:
        return False

    # Check roughly monthly interval (25-35 days)
    ts = pd.to_datetime(sub["timestamp"]).sort_values()
    diffs = ts.diff().dropna().dt.days
    if diffs.empty:
        return False
    median_diff = diffs.median()

    return 25 <= median_diff <= 35


def _is_merchant(inc: pd.DataFrame, out: pd.DataFrame) -> bool:
    """
    Merchant pattern: many small inflows, fewer larger outflows,
    round-number amounts frequent.
    """
    if inc.empty or len(inc) < 20:
        return False

    avg_in = inc["amount"].mean()
    avg_out = out["amount"].mean() if not out.empty else 0

    # Many small in, fewer large out
    if avg_out <= avg_in:
        return False
    if len(inc) < 5 * max(len(out), 1):
        return False

    # Round-number amounts (pricing)
    round_count = sum(
        1 for a in inc["amount"] if _is_round_number(a)
    )
    round_ratio = round_count / len(inc)

    return round_ratio > 0.3


def _is_salary(inc: pd.DataFrame, out: pd.DataFrame) -> bool:
    """
    Salary account: one large monthly deposit, regular outgoing bill payments.
    """
    if inc.empty or len(inc) < 2:
        return False

    # Check for a single large recurring deposit
    amounts = inc["amount"].values
    max_amt = np.max(amounts)
    large_deposits = inc[inc["amount"] > 0.7 * max_amt]

    if len(large_deposits) < 2:
        return False

    # Check monthly pattern for large deposits
    ts = pd.to_datetime(large_deposits["timestamp"]).sort_values()
    diffs = ts.diff().dropna().dt.days
    if diffs.empty:
        return False
    median_diff = diffs.median()

    if not (25 <= median_diff <= 35):
        return False

    # Should also have regular outgoing
    if out.empty or len(out) < 3:
        return False

    return True


def _is_established_business(
    inc: pd.DataFrame, out: pd.DataFrame, acct_id: str
) -> bool:
    """
    Established business: long history, diverse counterparties, consistent
    patterns, or business-like name.
    """
    all_txns = pd.concat([inc, out]) if not out.empty else inc
    if all_txns.empty or len(all_txns) < 20:
        return False

    ts = pd.to_datetime(all_txns["timestamp"]).sort_values()
    history_days = (ts.max() - ts.min()).days

    if history_days < 180:  # < 6 months
        return False

    # Diverse counterparties
    counterparties = set()
    if not inc.empty:
        counterparties.update(inc["sender"].unique())
    if not out.empty:
        counterparties.update(out["receiver"].unique())

    if len(counterparties) < 10:
        return False

    # Business-name heuristic
    patterns = [
        r"(?i)(corp|inc|llc|ltd|co\b|merchant|store|shop|pay|bank|services)"
    ]
    if any(re.search(p, str(acct_id)) for p in patterns):
        return True

    return len(all_txns) > 100  # high-volume fallback


def _is_round_number(amount: float) -> bool:
    """Check if amount ends in .00, .99, .95, .49, .50 (common pricing)."""
    cents = round(amount % 1, 2)
    return cents in (0.0, 0.99, 0.95, 0.49, 0.50)
