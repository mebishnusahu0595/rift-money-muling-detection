#pragma once
// ============================================================================
// Cycle Detector – finds circular fund routing (cycles of length 3-5)
//
// Uses DFS-based simple cycle enumeration with temporal coherence check
// (all edge timestamps within a configured window).
//
// Performance optimisations for large graphs:
//   • O(1) path-membership via unordered_set (was O(path_len) linear scan)
//   • Per-root frame budget to prevent exponential blowup on dense graphs
//   • Nodes sorted by out-degree so high-connectivity hubs found first
//   • Skips zero-out-degree nodes immediately
// ============================================================================

#include "graph_engine.h"
#include "models.h"
#include "red_black_tree.h"

#include <algorithm>
#include <chrono>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace mm {

class CycleDetector {
public:
    static constexpr int    MAX_CYCLES          = 5000;
    static constexpr int    DEFAULT_MAX_LENGTH   = 5;
    static constexpr double DEFAULT_WINDOW_HRS   = 72.0;
    // Max DFS frames per root node — prevents O(∞) on dense graphs
    static constexpr int    MAX_FRAMES_PER_ROOT  = 30000;

    /**
     * Find all simple cycles of length 3..max_length that are temporally
     * coherent (all edge timestamps within time_window_hours).
     *
     * Uses RBT-backed temporal checks for O(log n) edge-timestamp lookup.
     */
    static std::vector<CycleResult> detect(
        const TransactionGraph& graph,
        int    max_length        = DEFAULT_MAX_LENGTH,
        double time_window_hours = DEFAULT_WINDOW_HRS)
    {
        using namespace std::chrono;

        auto window = duration_cast<system_clock::duration>(
            duration<double, std::ratio<3600>>(time_window_hours));

        // Build RBT per edge for fast timestamp range queries
        // (maps "sender→receiver" → sorted timestamps)
        // We don't need RBT here since edge_transactions() already stores
        // timestamps; RBT gives O(log n) range_query on the global stream.
        // For cycle coherence we just iterate the (small) per-edge list.

        // Collect all nodes — filter out zero-out-degree immediately
        std::vector<std::string> node_list;
        node_list.reserve(graph.all_nodes().size());
        for (const auto& [id, _] : graph.all_nodes()) {
            if (graph.out_degree(id) > 0)
                node_list.push_back(id);
        }

        // Sort by out-degree descending so hubs are explored first
        // (allows MAX_CYCLES to be hit faster → early exit)
        std::sort(node_list.begin(), node_list.end(),
            [&](const std::string& a, const std::string& b) {
                return graph.out_degree(a) > graph.out_degree(b);
            });

        std::vector<CycleResult> results;
        results.reserve(std::min((int)node_list.size(), MAX_CYCLES));
        int ring_counter = 0;

        // ── DFS-based cycle enumeration ─────────────────────────────────
        struct Frame {
            std::string              node;
            std::vector<std::string> path;
            std::unordered_set<std::string> in_path; // O(1) membership
        };

        for (const auto& start : node_list) {
            if ((int)results.size() >= MAX_CYCLES) break;

            std::vector<Frame> stack;
            stack.reserve(64);
            stack.push_back({start, {start}, {start}});

            int frames_this_root = 0;

            while (!stack.empty() && (int)results.size() < MAX_CYCLES) {
                if (++frames_this_root > MAX_FRAMES_PER_ROOT) break;

                auto frame = std::move(stack.back());
                stack.pop_back();

                const int depth = (int)frame.path.size();
                if (depth > max_length + 1) continue;

                for (const auto& next : graph.successors(frame.node)) {
                    // Cycle closes back to start
                    if (next == start && depth >= 3) {
                        auto cycle_result = check_temporal_coherence(
                            graph, frame.path, window, ring_counter);
                        if (cycle_result.has_value()) {
                            results.push_back(std::move(*cycle_result));
                            if ((int)results.size() >= MAX_CYCLES) break;
                        }
                        continue;
                    }

                    // Only extend if within depth budget and node not in path
                    if (depth < max_length && !frame.in_path.count(next)) {
                        Frame nf;
                        nf.node    = next;
                        nf.path    = frame.path;
                        nf.in_path = frame.in_path;
                        nf.path.push_back(next);
                        nf.in_path.insert(next);
                        stack.push_back(std::move(nf));
                    }
                }
            }
        }

        results = deduplicate(std::move(results));
        return results;
    }

private:
    static std::optional<CycleResult> check_temporal_coherence(
        const TransactionGraph& graph,
        const std::vector<std::string>& path,
        std::chrono::system_clock::duration window,
        int& ring_counter)
    {
        using namespace std::chrono;

        TimePoint min_ts = TimePoint::max();
        TimePoint max_ts = TimePoint::min();
        double total_amount = 0.0;
        int edge_count = (int)path.size();

        for (size_t i = 0; i < path.size(); ++i) {
            const auto& u = path[i];
            const auto& v = path[(i + 1) % path.size()];

            const auto& txns = graph.edge_transactions(u, v);
            if (txns.empty()) return std::nullopt;

            for (const auto& [amt, ts] : txns) {
                total_amount += amt;
                if (ts < min_ts) min_ts = ts;
                if (ts > max_ts) max_ts = ts;
            }
        }

        if ((max_ts - min_ts) > window) return std::nullopt;

        ++ring_counter;
        double span_hours = duration_cast<duration<double, std::ratio<3600>>>(
            max_ts - min_ts).count();

        CycleResult cr;
        cr.ring_id         = "RING_" + pad3(ring_counter);
        cr.nodes           = path;
        cr.length          = (int)path.size();
        cr.total_amount    = std::round(total_amount * 100.0) / 100.0;
        cr.time_span_hours = std::round(span_hours * 100.0) / 100.0;
        cr.edge_count      = edge_count;
        cr.pattern_type    = "cycle";
        return cr;
    }

    static std::string pad3(int n) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%03d", n);
        return std::string(buf);
    }

    static std::vector<CycleResult> deduplicate(std::vector<CycleResult> cycles) {
        std::unordered_set<std::string> seen;
        std::vector<CycleResult> unique;
        unique.reserve(cycles.size());
        for (auto& c : cycles) {
            auto key = canonical_key(c.nodes);
            if (seen.insert(key).second)
                unique.push_back(std::move(c));
        }
        return unique;
    }

    static std::string canonical_key(const std::vector<std::string>& nodes) {
        if (nodes.empty()) return "";
        std::string best;
        for (size_t start = 0; start < nodes.size(); ++start) {
            std::string key;
            key.reserve(128);
            for (size_t i = 0; i < nodes.size(); ++i) {
                if (!key.empty()) key += ',';
                key += nodes[(start + i) % nodes.size()];
            }
            if (best.empty() || key < best) best = std::move(key);
        }
        return best;
    }
};

} // namespace mm
