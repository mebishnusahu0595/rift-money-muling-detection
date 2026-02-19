#pragma once
// ============================================================================
// Filters – false-positive reduction heuristics
//
// Identifies legitimate accounts: payroll, merchant, salary, established
// business patterns.  Mirrors Python filters.py exactly.
// ============================================================================

#include "models.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <regex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace mm {

class Filters {
public:
    /**
     * Enrich each AccountProfile with boolean flags for legitimate-account
     * heuristics.  Mutates profiles in-place.
     */
    static void apply(
        std::unordered_map<std::string, AccountProfile>& profiles,
        const std::vector<Transaction>& txns)
    {
        // Group transactions by receiver and sender
        std::unordered_map<std::string, std::vector<const Transaction*>> incoming;
        std::unordered_map<std::string, std::vector<const Transaction*>> outgoing;

        for (const auto& t : txns) {
            incoming[t.receiver].push_back(&t);
            outgoing[t.sender].push_back(&t);
        }

        for (auto& [acct_id, profile] : profiles) {
            const auto& inc = incoming.count(acct_id) ? incoming[acct_id]
                                                       : empty_txns_;
            const auto& out = outgoing.count(acct_id) ? outgoing[acct_id]
                                                       : empty_txns_;

            profile.is_payroll              = is_payroll(inc);
            profile.is_merchant             = is_merchant(inc, out);
            profile.is_salary               = is_salary(inc, out);
            profile.is_established_business = is_established_business(inc, out, acct_id);
        }
    }

private:
    static inline const std::vector<const Transaction*> empty_txns_{};

    // ── Payroll: single dominant sender, monthly, consistent amount ─────
    static bool is_payroll(const std::vector<const Transaction*>& inc,
                           double tolerance = 0.10) {
        if (inc.size() < 3) return false;

        // Count senders
        std::unordered_map<std::string, int> sender_counts;
        for (auto* t : inc) sender_counts[t->sender]++;

        // Find dominant sender
        std::string dominant;
        int max_count = 0;
        for (const auto& [s, c] : sender_counts) {
            if (c > max_count) { max_count = c; dominant = s; }
        }

        double dominant_ratio = (double)max_count / (double)inc.size();
        if (dominant_ratio < 0.80) return false;

        // Get amounts from dominant sender, sorted by timestamp
        std::vector<std::pair<TimePoint, double>> dom_txns;
        for (auto* t : inc) {
            if (t->sender == dominant) dom_txns.push_back({t->timestamp, t->amount});
        }
        std::sort(dom_txns.begin(), dom_txns.end());
        if (dom_txns.size() < 3) return false;

        // Check amount consistency (coefficient of variation)
        double sum = 0, sum_sq = 0;
        for (const auto& [_, amt] : dom_txns) {
            sum += amt;
            sum_sq += amt * amt;
        }
        double mean = sum / dom_txns.size();
        if (mean == 0) return false;
        double variance = sum_sq / dom_txns.size() - mean * mean;
        double std_dev = std::sqrt(std::max(variance, 0.0));
        double cv = std_dev / mean;
        if (cv > tolerance) return false;

        // Check roughly monthly interval (25-35 days)
        std::vector<double> diffs;
        for (size_t i = 1; i < dom_txns.size(); ++i) {
            auto diff = dom_txns[i].first - dom_txns[i - 1].first;
            double days = std::chrono::duration_cast<std::chrono::hours>(diff).count() / 24.0;
            diffs.push_back(days);
        }
        if (diffs.empty()) return false;

        // Median diff
        std::sort(diffs.begin(), diffs.end());
        double median = diffs[diffs.size() / 2];
        return median >= 25 && median <= 35;
    }

    // ── Merchant: many small inflows, fewer larger outflows ────────────
    static bool is_merchant(const std::vector<const Transaction*>& inc,
                            const std::vector<const Transaction*>& out) {
        // Name check fallback (optimization)
        if (!inc.empty() && looks_like_business(inc[0]->receiver)) return true;

        if (inc.size() < 20) return false;

        double sum_in = 0;
        for (auto* t : inc) sum_in += t->amount;
        double avg_in = sum_in / inc.size();

        double avg_out = 0;
        if (!out.empty()) {
            double sum_out = 0;
            for (auto* t : out) sum_out += t->amount;
            avg_out = sum_out / out.size();
        }

        // Many small in, fewer large out
        if (avg_out <= avg_in) return false;
        if (inc.size() < 5 * std::max(out.size(), (size_t)1)) return false;

        // Round-number amounts (pricing)
        int round_count = 0;
        for (auto* t : inc) {
            if (is_round_number(t->amount)) ++round_count;
        }
        double round_ratio = (double)round_count / (double)inc.size();
        return round_ratio > 0.3;
    }

    static bool looks_like_business(const std::string& id) {
        static const std::regex biz_pat(
            "(corp|inc|llc|ltd|co\\b|merchant|store|shop|pay|bank|services|mart|pvt)",
            std::regex::icase | std::regex::optimize);
        return std::regex_search(id, biz_pat);
    }

    // ── Salary: one large monthly deposit + regular outgoing bills ─────
    static bool is_salary(const std::vector<const Transaction*>& inc,
                          const std::vector<const Transaction*>& out) {
        if (inc.size() < 2) return false;

        // Find max amount
        double max_amt = 0;
        for (auto* t : inc) {
            if (t->amount > max_amt) max_amt = t->amount;
        }

        // Large deposits (> 70% of max)
        std::vector<TimePoint> large_ts;
        for (auto* t : inc) {
            if (t->amount > 0.7 * max_amt) large_ts.push_back(t->timestamp);
        }
        if (large_ts.size() < 2) return false;

        // Check monthly pattern
        std::sort(large_ts.begin(), large_ts.end());
        std::vector<double> diffs;
        for (size_t i = 1; i < large_ts.size(); ++i) {
            auto diff = large_ts[i] - large_ts[i - 1];
            double days = std::chrono::duration_cast<std::chrono::hours>(diff).count() / 24.0;
            diffs.push_back(days);
        }
        if (diffs.empty()) return false;
        std::sort(diffs.begin(), diffs.end());
        double median = diffs[diffs.size() / 2];
        if (median < 25 || median > 35) return false;

        // Should have regular outgoing
        return out.size() >= 3;
    }

    // ── Established business: long history, diverse counterparties ─────
    static bool is_established_business(
        const std::vector<const Transaction*>& inc,
        const std::vector<const Transaction*>& out,
        const std::string& acct_id)
    {
        size_t total = inc.size() + out.size();
        if (total < 20) return false;

        // History span
        TimePoint min_ts = TimePoint::max(), max_ts = TimePoint::min();
        for (auto* t : inc) {
            if (t->timestamp < min_ts) min_ts = t->timestamp;
            if (t->timestamp > max_ts) max_ts = t->timestamp;
        }
        for (auto* t : out) {
            if (t->timestamp < min_ts) min_ts = t->timestamp;
            if (t->timestamp > max_ts) max_ts = t->timestamp;
        }

        double days = std::chrono::duration_cast<std::chrono::hours>(max_ts - min_ts).count() / 24.0;
        if (days < 180) return false; // < 6 months

        // Diverse counterparties
        std::unordered_set<std::string> cps;
        for (auto* t : inc) cps.insert(t->sender);
        for (auto* t : out) cps.insert(t->receiver);
        if (cps.size() < 10) return false;

        // Business-name heuristic
        static const std::regex biz_pat(
            "(corp|inc|llc|ltd|co\\b|merchant|store|shop|pay|bank|services)",
            std::regex::icase);
        if (std::regex_search(acct_id, biz_pat)) return true;

        return total > 100; // high-volume fallback
    }

    static bool is_round_number(double amount) {
        double cents = std::fmod(std::round(amount * 100.0), 100.0) / 100.0;
        return cents == 0.0 || cents == 0.99 || cents == 0.95
            || cents == 0.49 || cents == 0.50;
    }
};

} // namespace mm
