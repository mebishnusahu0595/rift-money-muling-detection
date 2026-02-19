#pragma once
// ============================================================================
// Decision Tree – rule-based fraud scoring via a decision tree structure
//
// Replaces the hardcoded scoring rules from Python scoring.py with a
// structured decision tree that evaluates account features and detection
// results to produce a 0-100 suspicion score.
// ============================================================================

#include "models.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace mm {

class DecisionTree {
public:
    /**
     * Calculate suspicion scores for all accounts.
     * Uses the same logic as Python scoring.py but structured as a
     * decision tree traversal.
     */
    static std::unordered_map<std::string, double> score_all(
        const std::unordered_map<std::string, AccountProfile>& profiles,
        const std::vector<CycleResult>&   cycles,
        const std::vector<SmurfingResult>& smurfing,
        const std::vector<ShellResult>&    shells)
    {
        // Pre-build lookup maps for O(1) per account
        // Cycle scores: 20 * (6 - length) + 10 if amount > 10000
        std::unordered_map<std::string, double> cycle_scores;
        for (const auto& c : cycles) {
            double score = 20.0 * (6.0 - std::min(c.length, 5));
            if (c.total_amount > 10000.0) score += 10.0;
            for (const auto& node : c.nodes) {
                cycle_scores[node] = std::max(cycle_scores[node], score);
            }
        }

        // Smurfing scores: 15 base + 5 if >20 counterparties + 10 if velocity > 5000/hr
        std::unordered_map<std::string, double> smurf_scores;
        for (const auto& s : smurfing) {
            double score = 15.0;
            if (s.unique_counterparties > 20) score += 5.0;
            if (s.velocity_per_hour > 5000.0) score += 10.0;
            smurf_scores[s.account_id] = std::max(smurf_scores[s.account_id], score);
        }

        // Shell scores: 25 per intermediate node
        std::unordered_map<std::string, double> shell_scores;
        for (const auto& s : shells) {
            double per_node = 25.0;
            for (const auto& node : s.chain) {
                shell_scores[node] = std::max(shell_scores[node], per_node);
            }
            // Intermediate nodes get extra
            for (const auto& node : s.intermediate_accounts) {
                shell_scores[node] = std::max(shell_scores[node],
                    per_node * (double)s.shell_depth);
            }
        }

        // Calculate final scores
        std::unordered_map<std::string, double> scores;

        for (const auto& [acct_id, profile] : profiles) {
            double score = 0.0;

            // Apply detection scores (decision tree leaves)
            auto ci = cycle_scores.find(acct_id);
            if (ci != cycle_scores.end()) score += ci->second;

            auto si = smurf_scores.find(acct_id);
            if (si != smurf_scores.end()) score += si->second;

            auto shi = shell_scores.find(acct_id);
            if (shi != shell_scores.end()) score += shi->second;

            // Apply false-positive reductions (legitimacy branch)
            if (profile.is_payroll)              score -= 30.0;
            if (profile.is_merchant)             score -= 25.0;
            if (profile.is_salary)               score -= 20.0;
            if (profile.is_established_business)  score -= 35.0;

            // Clamp to [0, 100]
            score = std::clamp(score, 0.0, 100.0);
            scores[acct_id] = std::round(score * 100.0) / 100.0;
        }

        return scores;
    }
};

} // namespace mm
