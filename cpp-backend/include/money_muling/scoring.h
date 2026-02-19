#pragma once
// ============================================================================
// Scoring – build suspicious accounts & fraud rings
//
// Mirrors Python scoring.py:
//   calculate_scores()        → DecisionTree::score_all  (in decision_tree.h)
//   build_suspicious_accounts → Scoring::build_suspicious_accounts
//   build_fraud_rings         → Scoring::build_fraud_rings
// ============================================================================

#include "models.h"
#include "graph_engine.h"
#include "decision_tree.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace mm {

class Scoring {
public:

    // -----------------------------------------------------------------------
    // calculate_scores – delegates to DecisionTree
    // -----------------------------------------------------------------------
    static std::unordered_map<std::string, double> calculate_scores(
        const std::unordered_map<std::string, AccountProfile>& profiles,
        const std::vector<CycleResult>&   cycles,
        const std::vector<SmurfingResult>& smurfing,
        const std::vector<ShellResult>&    shells)
    {
        return DecisionTree::score_all(profiles, cycles, smurfing, shells);
    }

    // -----------------------------------------------------------------------
    // build_suspicious_accounts
    // -----------------------------------------------------------------------
    static std::vector<SuspiciousAccount> build_suspicious_accounts(
        const std::unordered_map<std::string, double>&          scores,
        const std::unordered_map<std::string, AccountProfile>&  profiles,
        const std::vector<CycleResult>&   cycles,
        const std::vector<SmurfingResult>& smurfing,
        const std::vector<ShellResult>&    shells,
        const TransactionGraph&            graph)
    {
        // Build pattern_map  account_id -> set of pattern strings
        // Build ring_map     account_id -> set of ring_ids
        std::unordered_map<std::string, std::set<std::string>> pattern_map;
        std::unordered_map<std::string, std::set<std::string>> ring_map;

        for (const auto& c : cycles) {
            for (const auto& node : c.nodes) {
                pattern_map[node].insert("cycle");
                ring_map[node].insert(c.ring_id);
            }
        }
        for (const auto& s : smurfing) {
            pattern_map[s.account_id].insert(s.pattern_type);
            ring_map[s.account_id].insert(s.ring_id);
        }
        for (const auto& s : shells) {
            for (const auto& node : s.chain) {
                pattern_map[node].insert("shell");
                ring_map[node].insert(s.ring_id);
            }
        }

        // Build suspicious accounts (score > 0)
        std::vector<SuspiciousAccount> result;

        for (const auto& [acct_id, score] : scores) {
            if (score <= 0.0) continue;

            SuspiciousAccount sa;
            sa.account_id     = acct_id;
            sa.suspicion_score = score;

            // Detected patterns
            auto pit = pattern_map.find(acct_id);
            if (pit != pattern_map.end()) {
                sa.detected_patterns.assign(pit->second.begin(),
                                            pit->second.end());
            }

            // Ring IDs
            auto rit = ring_map.find(acct_id);
            if (rit != ring_map.end()) {
                sa.ring_ids.assign(rit->second.begin(), rit->second.end());
                if (!sa.ring_ids.empty()) sa.ring_id = sa.ring_ids.front();
            }

            // Profile data
            auto profi = profiles.find(acct_id);
            if (profi != profiles.end()) {
                sa.account_type      = profi->second.account_type;
                sa.total_inflow      = profi->second.total_inflow;
                sa.total_outflow     = profi->second.total_outflow;
                sa.transaction_count = profi->second.transaction_count;
            }

            // Connected accounts (graph neighbours)
            std::unordered_set<std::string> connected;
            for (const auto& s : graph.successors(acct_id))   connected.insert(s);
            for (const auto& p : graph.predecessors(acct_id)) connected.insert(p);
            connected.erase(acct_id);
            sa.connected_accounts.assign(connected.begin(), connected.end());

            result.push_back(std::move(sa));
        }

        // Sort by suspicion_score descending
        std::sort(result.begin(), result.end(),
            [](const SuspiciousAccount& a, const SuspiciousAccount& b) {
                return a.suspicion_score > b.suspicion_score;
            });

        return result;
    }

    // -----------------------------------------------------------------------
    // build_fraud_rings – aggregate from cycles, smurfing groups, shells
    // -----------------------------------------------------------------------
    static std::vector<FraudRing> build_fraud_rings(
        const std::unordered_map<std::string, double>& scores,
        const std::vector<CycleResult>&   cycles,
        const std::vector<SmurfingResult>& smurfing,
        const std::vector<ShellResult>&    shells)
    {
        std::unordered_map<std::string, FraudRing> ring_map;

        // From cycles
        for (const auto& c : cycles) {
            FraudRing& ring = ring_map[c.ring_id];
            ring.ring_id      = c.ring_id;
            ring.pattern_type = "cycle";
            std::set<std::string> members(c.nodes.begin(), c.nodes.end());
            ring.member_accounts.assign(members.begin(), members.end());

            // Risk = max score among members
            double max_score = 0.0;
            for (const auto& node : c.nodes) {
                auto it = scores.find(node);
                if (it != scores.end())
                    max_score = std::max(max_score, it->second);
            }
            ring.risk_score = max_score;
        }

        // From smurfing  –  group by ring_id
        {
            std::unordered_map<std::string, std::set<std::string>> smurf_groups;
            std::unordered_map<std::string, std::string> smurf_pattern;
            for (const auto& s : smurfing) {
                smurf_groups[s.ring_id].insert(s.account_id);
                smurf_pattern[s.ring_id] = s.pattern_type;
            }
            for (auto& [rid, members] : smurf_groups) {
                FraudRing& ring = ring_map[rid];
                ring.ring_id      = rid;
                ring.pattern_type = smurf_pattern[rid];
                ring.member_accounts.assign(members.begin(), members.end());

                double max_score = 0.0;
                for (const auto& acct : members) {
                    auto it = scores.find(acct);
                    if (it != scores.end())
                        max_score = std::max(max_score, it->second);
                }
                ring.risk_score = max_score;
            }
        }

        // From shells
        for (const auto& s : shells) {
            FraudRing& ring = ring_map[s.ring_id];
            ring.ring_id      = s.ring_id;
            ring.pattern_type = "shell";
            std::set<std::string> members(s.chain.begin(), s.chain.end());
            ring.member_accounts.assign(members.begin(), members.end());

            double max_score = 0.0;
            for (const auto& node : s.chain) {
                auto it = scores.find(node);
                if (it != scores.end())
                    max_score = std::max(max_score, it->second);
            }
            ring.risk_score = max_score;
        }

        // Flatten and sort by risk_score descending
        std::vector<FraudRing> result;
        result.reserve(ring_map.size());
        for (auto& [_, ring] : ring_map) {
            result.push_back(std::move(ring));
        }
        std::sort(result.begin(), result.end(),
            [](const FraudRing& a, const FraudRing& b) {
                return a.risk_score > b.risk_score;
            });

        return result;
    }
};

} // namespace mm
