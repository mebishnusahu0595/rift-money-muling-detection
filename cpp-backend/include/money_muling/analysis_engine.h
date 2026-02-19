#pragma once
// ============================================================================
// Analysis Engine – orchestrates the complete analysis pipeline
//
// Mirrors Python _run_analysis() in main.py:
//   parse_csv → build_graph → detect_cycles/smurfing/shells
//   → build_profiles → apply_filters → calculate_scores
//   → build_suspicious_accounts → build_fraud_rings → build_graph_data
//
// Spec-compliance notes:
//   • detected_patterns format: "cycle_length_N", "fan_in", "fan_out",
//     "shell", "high_velocity"
//   • Ring IDs are globally unique (RING_NNN, no collision across detectors)
//   • suspicious_accounts sorted by suspicion_score descending
//   • summary.processing_time_seconds matches spec download JSON format
// ============================================================================

#include "models.h"
#include "csv_parser.h"
#include "graph_engine.h"
#include "cycle_detector.h"
#include "smurfing_detector.h"
#include "shell_detector.h"
#include "filters.h"
#include "scoring.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <future>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

namespace mm {

class AnalysisEngine {
public:

    /**
     * Run the full analysis pipeline on raw CSV content.
     * Returns a fully populated AnalysisResult.
     */
    static AnalysisResult run(const std::string& analysis_id,
                              const std::string& csv_content)
    {
        using Clock = std::chrono::steady_clock;

        AnalysisResult result;
        result.analysis_id = analysis_id;
        result.status      = AnalysisStatus::PROCESSING;

        auto t0 = Clock::now();

        try {
            // ── 1. Parse CSV ─────────────────────────────────────────
            auto parsed = parse_csv(csv_content);
            if (!parsed.ok) {
                result.status = AnalysisStatus::FAILED;
                result.error  = parsed.error;
                return result;
            }

            auto& transactions = parsed.transactions;
            if (transactions.empty()) {
                result.status = AnalysisStatus::FAILED;
                result.error  = "No valid transactions found in CSV";
                return result;
            }

            // ── 2. Build Transaction Graph ───────────────────────────
            TransactionGraph graph;
            graph.build(transactions);

            // ── 3. Detect patterns in parallel ───────────────────────
            auto fut_cycles   = std::async(std::launch::async,
                [&]{ return CycleDetector::detect(graph); });
            auto fut_smurfing = std::async(std::launch::async,
                [&]{ return SmurfingDetector::detect(transactions); });
            auto fut_shells   = std::async(std::launch::async,
                [&]{ return ShellDetector::detect(graph); });

            auto cycles   = fut_cycles.get();
            auto smurfing = fut_smurfing.get();
            auto shells   = fut_shells.get();

            // ── 4. Re-assign globally-unique ring IDs ────────────────
            // Each detector uses its own counter; re-number globally so
            // RING_001 is never duplicated across cycles/smurfing/shells.
            assign_global_ring_ids(cycles, smurfing, shells);

            // ── 5. Build account profiles ────────────────────────────
            auto profiles = graph.build_profiles();

            // ── 6. Apply false-positive filters ──────────────────────
            Filters::apply(profiles, transactions);

            // ── 7. Calculate scores (Decision Tree) ──────────────────
            auto scores = Scoring::calculate_scores(profiles, cycles,
                                                     smurfing, shells);

            // ── 8. Build ring_map & pattern_map for graph + scoring ──
            // ring_map:    account → [ring_ids]
            // pattern_map: account → [raw pattern strings]
            // spec_pattern_map: account → [spec-format pattern strings]
            std::unordered_map<std::string, std::vector<std::string>> ring_map;
            std::unordered_map<std::string, std::vector<std::string>> pattern_map;
            std::unordered_map<std::string, std::set<std::string>>    spec_patterns;

            for (const auto& c : cycles) {
                // Spec format: "cycle_length_N"
                std::string spec_pat = "cycle_length_" + std::to_string(c.length);
                for (const auto& n : c.nodes) {
                    ring_map[n].push_back(c.ring_id);
                    pattern_map[n].push_back("cycle");
                    spec_patterns[n].insert(spec_pat);
                }
            }
            for (const auto& s : smurfing) {
                ring_map[s.account_id].push_back(s.ring_id);
                pattern_map[s.account_id].push_back(s.pattern_type);
                spec_patterns[s.account_id].insert(s.pattern_type); // "fan_in"/"fan_out"
                if (s.velocity_per_hour > 5000.0)
                    spec_patterns[s.account_id].insert("high_velocity");
            }
            for (const auto& s : shells) {
                for (const auto& n : s.chain) {
                    ring_map[n].push_back(s.ring_id);
                    pattern_map[n].push_back("shell");
                    spec_patterns[n].insert("shell");
                }
            }

            // ── 9. Build suspicious accounts ─────────────────────────
            auto suspicious = Scoring::build_suspicious_accounts(
                scores, profiles, cycles, smurfing, shells, graph);

            // Inject spec-format detected_patterns into each SuspiciousAccount
            for (auto& sa : suspicious) {
                auto it = spec_patterns.find(sa.account_id);
                if (it != spec_patterns.end()) {
                    sa.detected_patterns.assign(it->second.begin(),
                                                it->second.end());
                }
            }

            // ── 10. Build fraud rings ─────────────────────────────────
            auto fraud_rings = Scoring::build_fraud_rings(
                scores, cycles, smurfing, shells);

            // ── 11. Build graph data for frontend ────────────────────
            auto graph_data = graph.build_graph_data(scores, ring_map,
                                                      pattern_map);

            // Inject spec_patterns into graph nodes too
            for (auto& gn : graph_data.nodes) {
                auto it = spec_patterns.find(gn.id);
                if (it != spec_patterns.end()) {
                    gn.detected_patterns.assign(it->second.begin(),
                                                it->second.end());
                }
            }

            // ── 12. Build summary ────────────────────────────────────
            Summary summary;
            summary.total_transactions       = (int)transactions.size();
            summary.total_accounts_analyzed  = (int)profiles.size();
            summary.suspicious_accounts_flagged = (int)suspicious.size();
            summary.fraud_rings_detected     = (int)fraud_rings.size();
            summary.total_cycles             = (int)cycles.size();
            summary.total_smurfing_patterns  = (int)smurfing.size();
            summary.total_shell_patterns     = (int)shells.size();

            double total_at_risk = 0.0;
            for (const auto& c : cycles)  total_at_risk += c.total_amount;
            for (const auto& s : shells)  total_at_risk += s.total_amount;
            summary.total_amount_at_risk = total_at_risk;

            auto t1        = Clock::now();
            auto elapsed   = std::chrono::duration<double>(t1 - t0).count();
            summary.processing_time_seconds = elapsed;

            // ── 13. Assemble result ──────────────────────────────────
            result.status              = AnalysisStatus::COMPLETED;
            result.summary             = std::move(summary);
            result.suspicious_accounts = std::move(suspicious);
            result.fraud_rings         = std::move(fraud_rings);
            result.cycles              = std::move(cycles);
            result.smurfing            = std::move(smurfing);
            result.shells              = std::move(shells);
            result.graph_data          = std::move(graph_data);
            result.processing_time_ms  = elapsed * 1000.0;

        } catch (const std::exception& e) {
            result.status = AnalysisStatus::FAILED;
            result.error  = std::string("Analysis failed: ") + e.what();
        }

        return result;
    }

private:
    /**
     * Re-number ring IDs globally so cycles, smurfing, and shells
     * never produce duplicate RING_NNN identifiers.
     */
    static void assign_global_ring_ids(
        std::vector<CycleResult>&    cycles,
        std::vector<SmurfingResult>& smurfing,
        std::vector<ShellResult>&    shells)
    {
        int counter = 1;
        auto make_id = [](int n) {
            char buf[16];
            snprintf(buf, sizeof(buf), "RING_%03d", n);
            return std::string(buf);
        };

        for (auto& c : cycles)   c.ring_id = make_id(counter++);
        for (auto& s : smurfing) s.ring_id  = make_id(counter++);
        for (auto& s : shells)   s.ring_id  = make_id(counter++);
    }
};

} // namespace mm
