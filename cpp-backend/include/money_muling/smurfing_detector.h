#pragma once
// ============================================================================
// Smurfing Detector – fan-in / fan-out structuring patterns
//
// Fan-in:  receiver with >=10 unique senders within a 72-hour window.
// Fan-out: sender with >=10 unique receivers within a 72-hour window.
//
// Performance optimisations:
//   • Uses RedBlackTree for O(log n) time-range queries per account
//   • Pre-groups transaction indices by account using unordered_map
//   • Inner sliding window uses a deque + hash set for O(1) amortised ops
//   • Sorts once globally, reuses sorted order for all accounts
// ============================================================================

#include "models.h"
#include "red_black_tree.h"

#include <algorithm>
#include <chrono>
#include <deque>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace mm {

class SmurfingDetector {
public:
    static constexpr int    DEFAULT_FAN_THRESHOLD = 10;
    static constexpr double DEFAULT_WINDOW_HRS    = 72.0;

    /**
     * Detect fan-in and fan-out smurfing patterns.
     *
     * Uses a globally-sorted index + per-account sliding window for
     * O(N log N) overall complexity (vs original O(N²) per account window).
     * RedBlackTree provides the sorted timestamp index.
     */
    static std::vector<SmurfingResult> detect(
        const std::vector<Transaction>& txns,
        int    fan_threshold = DEFAULT_FAN_THRESHOLD,
        double window_hours  = DEFAULT_WINDOW_HRS)
    {
        if (txns.empty()) return {};

        std::vector<SmurfingResult> results;

        // Build RBT over all transactions (sorted by timestamp)
        RedBlackTree rbt;
        for (const auto& t : txns)
            rbt.insert(t);

        // Get all transactions in timestamp order via RBT in-order traversal
        auto sorted_ptrs = rbt.all();  // O(N), already sorted

        // Build sorted index array (indices into txns)
        std::vector<size_t> sorted_idx;
        sorted_idx.reserve(sorted_ptrs.size());
        // Map pointer back to index (needed for fan detection referencing txns[])
        std::unordered_map<const Transaction*, size_t> ptr_to_idx;
        ptr_to_idx.reserve(txns.size());
        for (size_t i = 0; i < txns.size(); ++i)
            ptr_to_idx[&txns[i]] = i;

        for (const auto* p : sorted_ptrs)
            sorted_idx.push_back(ptr_to_idx[p]);

        auto window_dur = std::chrono::duration_cast<std::chrono::system_clock::duration>(
            std::chrono::duration<double, std::ratio<3600>>(window_hours));

        // Fan-in:  group by receiver, sliding window over counterparty senders
        detect_fan_opt(txns, sorted_idx, results, fan_threshold, window_dur, false);

        // Fan-out: group by sender, sliding window over counterparty receivers
        detect_fan_opt(txns, sorted_idx, results, fan_threshold, window_dur, true);

        return results;
    }

private:
    /**
     * Optimised fan detection using a proper O(N) per-account sliding window.
     *
     * Key: instead of rebuilding the counterparty set on every right-pointer
     * move (O(window_size)), we maintain a count map.  Adding/removing a
     * counterparty is O(1).  Total complexity per account = O(txns_for_account).
     */
    static void detect_fan_opt(
        const std::vector<Transaction>& txns,
        const std::vector<size_t>&      sorted_idx,
        std::vector<SmurfingResult>&    results,
        int                             threshold,
        std::chrono::system_clock::duration window,
        bool                            group_by_sender)
    {
        // Group indices by account (in sorted order → already sorted per account)
        std::unordered_map<std::string, std::vector<size_t>> groups;
        groups.reserve(256);
        for (auto idx : sorted_idx) {
            const auto& key = group_by_sender ? txns[idx].sender : txns[idx].receiver;
            groups[key].push_back(idx);
        }

        for (const auto& [acct, indices] : groups) {
            const int n = (int)indices.size();
            if (n < threshold) continue;

            // Sliding window with counterparty frequency map
            // Allows O(1) unique-count maintenance
            std::unordered_map<std::string, int> cp_count;
            cp_count.reserve(threshold * 2);
            int unique_in_window = 0;
            double total_in_window = 0.0;

            int best_unique = 0;
            TimePoint best_start{};
            TimePoint best_end{};
            double best_total = 0.0;

            int left = 0;
            for (int right = 0; right < n; ++right) {
                // Add right element
                const auto& rt = txns[indices[right]];
                const auto& rcp = group_by_sender ? rt.receiver : rt.sender;
                int& cnt = cp_count[rcp];
                if (cnt == 0) ++unique_in_window;
                ++cnt;
                total_in_window += rt.amount;

                // Shrink left so window fits
                while (left < right &&
                       (rt.timestamp - txns[indices[left]].timestamp) > window) {
                    const auto& lt  = txns[indices[left]];
                    const auto& lcp = group_by_sender ? lt.receiver : lt.sender;
                    int& lc = cp_count[lcp];
                    --lc;
                    if (lc == 0) --unique_in_window;
                    total_in_window -= lt.amount;
                    ++left;
                }

                if (unique_in_window > best_unique) {
                    best_unique = unique_in_window;
                    best_start  = txns[indices[left]].timestamp;
                    best_end    = rt.timestamp;
                    best_total  = total_in_window;
                }
            }

            if (best_unique >= threshold) {
                using namespace std::chrono;
                double hours_span = std::max(
                    duration_cast<duration<double, std::ratio<3600>>>(best_end - best_start).count(),
                    1.0);

                SmurfingResult sr;
                sr.account_id            = acct;
                sr.pattern_type          = group_by_sender ? "fan_out" : "fan_in";
                sr.unique_counterparties  = best_unique;
                sr.total_amount          = std::round(best_total * 100.0) / 100.0;
                sr.velocity_per_hour     = std::round((best_total / hours_span) * 100.0) / 100.0;
                sr.window_start          = timepoint_to_iso(best_start);
                sr.window_end            = timepoint_to_iso(best_end);
                // ring_id generated later in pipeline; use account as placeholder
                sr.ring_id               = "SMURF_" + acct.substr(0, std::min((int)acct.size(), 8));
                results.push_back(std::move(sr));
            }
        }
    }

    static std::string timepoint_to_iso(TimePoint tp) {
        auto t = std::chrono::system_clock::to_time_t(tp);
        std::tm tm{};
        gmtime_r(&t, &tm);
        char buf[32];
        strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tm);
        return std::string(buf);
    }
};

} // namespace mm
