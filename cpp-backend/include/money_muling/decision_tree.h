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
        
        // Cycle scores: 
        // Length 3: 60pts, Length 4: 40pts, Length 5: 20pts
        // Bonus: +10 if total amount > 10,000
        std::unordered_map<std::string, double> cycle_scores;
        for (const auto& c : cycles) {
            double score = 20.0 * (6.0 - std::min(c.length, 5));
            if (c.total_amount > 10000.0) score += 10.0;
            for (const auto& node : c.nodes) {
                cycle_scores[node] = std::max(cycle_scores[node], score);
            }
        }

        // Smurfing scores: 
        // Base 25 (up from 15)
        // +10 High Velocity (>5000/hr)
        // +5 Many Counterparties (>20)
        // +5 High Volume (>100k total)
        std::unordered_map<std::string, double> smurf_scores;
        for (const auto& s : smurfing) {
            double score = 25.0;
            if (s.velocity_per_hour > 5000.0)     score += 10.0;
            if (s.unique_counterparties > 20)     score += 5.0;
            if (s.total_amount > 100000.0)        score += 5.0;
            smurf_scores[s.account_id] = std::max(smurf_scores[s.account_id], score);
        }

        // Shell scores: 
        // 25 per node, scaled by depth
        std::unordered_map<std::string, double> shell_scores;
        for (const auto& s : shells) {
            double per_node = 25.0;
            for (const auto& node : s.chain) {
                shell_scores[node] = std::max(shell_scores[node], per_node);
            }
            // Intermediate nodes get extra risk
            for (const auto& node : s.intermediate_accounts) {
                shell_scores[node] = std::max(shell_scores[node],
                    per_node + (10.0 * (double)s.shell_depth)); // +10 per depth
            }
        }

        // Calculate final scores
        std::unordered_map<std::string, double> scores;

        for (const auto& [acct_id, profile] : profiles) {
            double score = 0.0;

            // 1. Pattern Scores
            auto ci = cycle_scores.find(acct_id);
            if (ci != cycle_scores.end()) score += ci->second;

            auto si = smurf_scores.find(acct_id);
            if (si != smurf_scores.end()) score += si->second;

            auto shi = shell_scores.find(acct_id);
            if (shi != shell_scores.end()) score += shi->second;

            // 2. Centrality / Activity Bonus (limit to +15)
            // Logarithmic scale of transaction count to detect hubs
            if (profile.transaction_count > 10) {
                double centrality = std::log10((double)profile.transaction_count) * 5.0;
                score += std::min(centrality, 15.0);
            }

            // 3. Amount Anomaly Bonus (limit to +10)
            // If avg transaction size is huge (>50k), add risk
            if (profile.transaction_count > 0) {
                double avg_val = (profile.total_inflow + profile.total_outflow) / (2.0 * profile.transaction_count);
                if (avg_val > 50000.0) score += 10.0;
            }

            // 4. Legitimacy Deductions (False Positive Control)
            if (profile.is_payroll)              score -= 50.0; // Stronger deduction
            if (profile.is_merchant)             score -= 40.0;
            if (profile.is_salary)               score -= 30.0;
            if (profile.is_established_business) score -= 40.0;

            // Clamp to [0, 100]
            score = std::clamp(score, 0.0, 100.0);
            
            // Round to 1 decimal
            scores[acct_id] = std::round(score * 10.0) / 10.0;
        }

        return scores;
    }
};

} // namespace mm
