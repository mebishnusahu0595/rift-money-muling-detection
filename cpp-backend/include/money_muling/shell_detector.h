#pragma once
// ============================================================================
// Shell Detector – identifies layered shell networks
//
// Finds chains of 3+ hops where intermediate accounts have very low
// activity (<=3 total transactions), indicating pass-through behaviour.
// Uses BFS path enumeration.  Mirrors Python shell_detector.py.
// ============================================================================

#include "graph_engine.h"
#include "models.h"

#include <algorithm>
#include <cmath>
#include <queue>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace mm {

class ShellDetector {
public:
    static constexpr int MAX_PATHS                     = 2000;
    static constexpr int DEFAULT_MAX_INTERMEDIATE_TXNS = 3;
    static constexpr int DEFAULT_MIN_CHAIN_LENGTH      = 3;
    static constexpr int DEFAULT_MAX_CHAIN_LENGTH      = 6;

    /**
     * Find layered shell networks – chains A→B→C→D where intermediate
     * nodes (B, C) have very low total transaction counts.
     */
    static std::vector<ShellResult> detect(
        const TransactionGraph& graph,
        int max_intermediate_txns = DEFAULT_MAX_INTERMEDIATE_TXNS,
        int min_chain_length      = DEFAULT_MIN_CHAIN_LENGTH,
        int max_chain_length      = DEFAULT_MAX_CHAIN_LENGTH)
    {
        // Pre-compute node transaction counts
        std::unordered_map<std::string, int> txn_counts;
        for (const auto& [id, attr] : graph.all_nodes()) {
            txn_counts[id] = attr.transaction_count;
        }

        // Identify shell candidates (low-activity nodes with > 0 txns)
        std::unordered_set<std::string> shell_candidates;
        for (const auto& [id, cnt] : txn_counts) {
            if (cnt > 0 && cnt <= max_intermediate_txns) {
                shell_candidates.insert(id);
            }
        }

        if (shell_candidates.empty()) return {};

        // Find sources and sinks
        std::vector<std::string> sources, sinks;
        for (const auto& [id, _] : graph.all_nodes()) {
            int in_d  = graph.in_degree(id);
            int out_d = graph.out_degree(id);
            if (in_d == 0 || out_d > in_d) sources.push_back(id);
            if (out_d == 0 || in_d > out_d) sinks.push_back(id);
        }

        // Fallback
        if (sources.empty()) {
            for (const auto& [id, _] : graph.all_nodes()) sources.push_back(id);
        }
        if (sinks.empty()) {
            for (const auto& [id, _] : graph.all_nodes()) sinks.push_back(id);
        }

        // Convert sinks to set for O(1) lookup
        std::unordered_set<std::string> sink_set(sinks.begin(), sinks.end());

        std::vector<ShellResult> results;
        std::unordered_set<std::string> seen_chains;
        int ring_counter = 0;

        for (const auto& source : sources) {
            if (ring_counter >= MAX_PATHS) break;

            // BFS for paths from source through shell candidates to sinks
            // Stack: {node, path}
            struct Frame {
                std::string              node;
                std::vector<std::string> path;
            };

            std::vector<Frame> stack;
            stack.push_back({source, {source}});

            int paths_from_source = 0;

            while (!stack.empty() && ring_counter < MAX_PATHS) {
                auto [curr, path] = std::move(stack.back());
                stack.pop_back();

                if ((int)path.size() > max_chain_length + 1) continue;
                if (paths_from_source > 200) break; // safety cap per source

                for (const auto& next : graph.successors(curr)) {
                    // Check if already in path (simple path)
                    bool in_path = false;
                    for (const auto& p : path) {
                        if (p == next) { in_path = true; break; }
                    }
                    if (in_path) continue;

                    auto new_path = path;
                    new_path.push_back(next);

                    int edges = (int)new_path.size() - 1;

                    // Check if this forms a valid shell chain to a sink
                    if (edges >= min_chain_length && sink_set.count(next)) {
                        auto chain_result = validate_shell_chain(
                            graph, new_path, shell_candidates,
                            seen_chains, ring_counter);
                        if (chain_result.has_value()) {
                            results.push_back(std::move(*chain_result));
                            ++paths_from_source;
                            if (ring_counter >= MAX_PATHS) break;
                        }
                    }

                    // Continue exploring if not too long
                    if (edges < max_chain_length) {
                        stack.push_back({next, std::move(new_path)});
                    }
                }
            }
        }

        return results;
    }

private:
    static std::optional<ShellResult> validate_shell_chain(
        const TransactionGraph& graph,
        const std::vector<std::string>& path,
        const std::unordered_set<std::string>& shell_candidates,
        std::unordered_set<std::string>& seen_chains,
        int& ring_counter)
    {
        // Extract intermediates (exclude first and last)
        std::vector<std::string> intermediates(path.begin() + 1, path.end() - 1);
        if (intermediates.empty()) return std::nullopt;

        // All intermediates must be shell candidates
        for (const auto& n : intermediates) {
            if (!shell_candidates.count(n)) return std::nullopt;
        }

        // Build chain key for deduplication
        std::string chain_key;
        for (const auto& n : path) {
            if (!chain_key.empty()) chain_key += "→";
            chain_key += n;
        }
        if (!seen_chains.insert(chain_key).second) return std::nullopt;

        // Verify pass-through: inflow ≈ outflow for intermediates
        for (const auto& inode : intermediates) {
            const auto& attr = graph.node(inode);
            double inflow  = attr.total_inflow;
            double outflow = attr.total_outflow;
            if (inflow > 0 && outflow > 0) {
                double ratio = std::min(inflow, outflow) / std::max(inflow, outflow);
                if (ratio < 0.5) return std::nullopt;
            } else {
                return std::nullopt;
            }
        }

        // Calculate total amount through chain
        double total_amount = chain_amount(graph, path);

        ++ring_counter;

        ShellResult sr;
        sr.ring_id               = "RING_" + pad3(ring_counter);
        sr.pattern_type          = "shell";
        sr.chain                 = path;
        sr.intermediate_accounts = intermediates;
        sr.total_amount          = std::round(total_amount * 100.0) / 100.0;
        sr.shell_depth           = (int)intermediates.size();
        sr.risk_score            = 0.0; // Calculated later by scoring engine
        return sr;
    }

    static double chain_amount(const TransactionGraph& graph,
                                const std::vector<std::string>& path) {
        double total = 0.0;
        for (size_t i = 0; i + 1 < path.size(); ++i) {
            const auto& txns = graph.edge_transactions(path[i], path[i + 1]);
            for (const auto& [amt, _] : txns) {
                total += amt;
            }
        }
        return total;
    }

    static std::string pad3(int n) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%03d", n);
        return std::string(buf);
    }
};

} // namespace mm
