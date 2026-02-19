"""
Smurfing Detector – identifies fan-in / fan-out structuring patterns.

Fan-in:  a receiver with ≥10 unique senders within a 72-hour window.
Fan-out: a sender with ≥10 unique receivers within a 72-hour window.
"""

from __future__ import annotations

from datetime import timedelta
from typing import List

import pandas as pd

from ..models import SmurfingResult


def detect_smurfing(
    df: pd.DataFrame,
    fan_threshold: int = 10,
    window_hours: float = 72.0,
) -> List[SmurfingResult]:
    """
    Detect fan-in and fan-out smurfing patterns using a 72-hour sliding
    window approach.

    Parameters
    ----------
    df : pd.DataFrame
        Transaction data.
    fan_threshold : int
        Minimum unique counterparties within the window to trigger.
    window_hours : float
        Sliding window size in hours.

    Returns
    -------
    list[SmurfingResult]
    """
    df = df.sort_values("timestamp")

    window = timedelta(hours=window_hours)
    results: List[SmurfingResult] = []

    # ── Fan-in detection ─────────────────────────────────────────────────
    results.extend(
        _detect_fan(
            df,
            group_col="receiver",
            counter_col="sender",
            pattern="fan_in",
            threshold=fan_threshold,
            window=window,
            amount_col="amount",
        )
    )

    # ── Fan-out detection ────────────────────────────────────────────────
    results.extend(
        _detect_fan(
            df,
            group_col="sender",
            counter_col="receiver",
            pattern="fan_out",
            threshold=fan_threshold,
            window=window,
            amount_col="amount",
        )
    )

    return results


def _detect_fan(
    df: pd.DataFrame,
    group_col: str,
    counter_col: str,
    pattern: str,
    threshold: int,
    window: timedelta,
    amount_col: str,
) -> List[SmurfingResult]:
    """
    Generic fan detection for a given direction.

    For each account (group_col), we slide a window across its transactions
    and check whether the number of unique counterparties (counter_col) in
    any window meets the threshold.
    """
    results: List[SmurfingResult] = []
    grouped = df.groupby(group_col)

    for acct, grp in grouped:
        grp = grp.sort_values("timestamp")
        timestamps = grp["timestamp"].values
        counterparties = grp[counter_col].values
        amounts = grp[amount_col].values

        n = len(grp)
        if n < threshold:
            continue  # impossible to meet threshold

        left = 0
        best_unique = 0
        best_window_start = None
        best_window_end = None
        best_total = 0.0

        for right in range(n):
            # Shrink left pointer so window fits
            while left < right and (
                pd.Timestamp(timestamps[right]) - pd.Timestamp(timestamps[left])
            ) > window:
                left += 1

            window_cps = set(counterparties[left : right + 1])
            window_total = float(amounts[left : right + 1].sum())
            unique = len(window_cps)

            if unique > best_unique:
                best_unique = unique
                best_window_start = pd.Timestamp(timestamps[left])
                best_window_end = pd.Timestamp(timestamps[right])
                best_total = window_total

        if best_unique >= threshold and best_window_start is not None:
            hours_span = max(
                (best_window_end - best_window_start).total_seconds() / 3600, 1.0
            )
            velocity = best_total / hours_span

            results.append(
                SmurfingResult(
                    account_id=str(acct),
                    pattern_type=pattern,
                    unique_counterparties=best_unique,
                    total_amount=round(best_total, 2),
                    velocity_per_hour=round(velocity, 2),
                    window_start=best_window_start,
                    window_end=best_window_end,
                )
            )

    return results
