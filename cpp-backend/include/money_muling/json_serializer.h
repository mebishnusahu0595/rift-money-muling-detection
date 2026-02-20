#pragma once
// ============================================================================
// JSON Serializer – nlohmann/json serialisation for all model types
//
// Produces identical JSON output to Python Pydantic models so the
// React frontend works unchanged.
// ============================================================================

#include "models.h"
#include <nlohmann/json.hpp>

namespace mm {

using json = nlohmann::json;

// ── helpers ──────────────────────────────────────────────────────────────

inline json summary_to_json(const Summary& s) {
    return json{
        {"total_accounts_analyzed",     s.total_accounts_analyzed},
        {"suspicious_accounts_flagged", s.suspicious_accounts_flagged},
        {"fraud_rings_detected",        s.fraud_rings_detected},
        {"processing_time_seconds",     s.processing_time_seconds},
        {"total_transactions",          s.total_transactions},
        {"total_cycles",                s.total_cycles},
        {"total_smurfing_patterns",     s.total_smurfing_patterns},
        {"total_shell_patterns",        s.total_shell_patterns},
        {"total_amount_at_risk",        s.total_amount_at_risk}
    };
}

inline json cycle_to_json(const CycleResult& c) {
    return json{
        {"ring_id",          c.ring_id},
        {"nodes",            c.nodes},
        {"length",           c.length},
        {"total_amount",     c.total_amount},
        {"time_span_hours",  c.time_span_hours},
        {"edge_count",       c.edge_count},
        {"pattern_type",     "cycle"}
    };
}

inline json smurfing_to_json(const SmurfingResult& s) {
    return json{
        {"account_id",           s.account_id},
        {"pattern_type",         s.pattern_type},
        {"unique_counterparties", s.unique_counterparties},
        {"total_amount",         s.total_amount},
        {"velocity_per_hour",    s.velocity_per_hour},
        {"window_start",         s.window_start},
        {"window_end",           s.window_end},
        {"ring_id",              s.ring_id}
    };
}

inline json shell_to_json(const ShellResult& s) {
    return json{
        {"ring_id",                s.ring_id},
        {"pattern_type",           "shell"},
        {"chain",                  s.chain},
        {"intermediate_accounts",  s.intermediate_accounts},
        {"total_amount",           s.total_amount},
        {"shell_depth",            s.shell_depth},
        {"risk_score",             s.risk_score}
    };
}

inline json suspicious_account_to_json(const SuspiciousAccount& sa) {
    return json{
        {"account_id",         sa.account_id},
        {"suspicion_score",    sa.suspicion_score},
        {"detected_patterns",  sa.detected_patterns},
        {"ring_id",            sa.ring_id},
        {"account_type",       sa.account_type},
        {"total_inflow",       sa.total_inflow},
        {"total_outflow",      sa.total_outflow},
        {"transaction_count",  sa.transaction_count},
        {"connected_accounts", sa.connected_accounts},
        {"ring_ids",           sa.ring_ids}
    };
}

inline json fraud_ring_to_json(const FraudRing& fr) {
    return json{
        {"ring_id",          fr.ring_id},
        {"member_accounts",  fr.member_accounts},
        {"pattern_type",     fr.pattern_type},
        {"risk_score",       fr.risk_score}
    };
}

inline json graph_node_to_json(const GraphNode& n) {
    return json{
        {"id",                n.id},
        {"label",             n.label},
        {"account_type",      n.account_type},
        {"suspicion_score",   n.suspicion_score},
        {"total_inflow",      n.total_inflow},
        {"total_outflow",     n.total_outflow},
        {"transaction_count", n.transaction_count},
        {"is_suspicious",     n.is_suspicious},
        {"ring_ids",          n.ring_ids},
        // detected_patterns: spec-format strings ("cycle_length_3", "high_velocity", etc.)
        // patterns: raw strings ("cycle", "shell", etc.) kept for backward compat
        {"detected_patterns", n.detected_patterns.empty() ? n.patterns : n.detected_patterns},
        {"patterns",          n.patterns}
    };
}

inline json graph_edge_to_json(const GraphEdge& e) {
    return json{
        {"source",            e.source},
        {"target",            e.target},
        {"amount",            e.total_amount},
        {"transaction_count", e.transaction_count},
        {"is_suspicious",     e.is_suspicious},
        {"pattern_type",      e.pattern_type}
    };
}

inline json graph_data_to_json(const GraphData& gd) {
    json nodes_arr = json::array();
    for (const auto& n : gd.nodes) nodes_arr.push_back(graph_node_to_json(n));

    json edges_arr = json::array();
    for (const auto& e : gd.edges) edges_arr.push_back(graph_edge_to_json(e));

    return json{
        {"nodes", nodes_arr},
        {"edges", edges_arr}
    };
}

// ── Full analysis result (status polling endpoint) ───────────────────────

inline json analysis_result_to_json(const AnalysisResult& r) {
    json j;
    j["analysis_id"]       = r.analysis_id;
    j["status"]            = status_to_string(r.status);

    if (r.status == AnalysisStatus::COMPLETED) {
        // Nest completed data under "result" for frontend AnalysisStatusResponse
        json result_obj;
        result_obj["summary"] = summary_to_json(r.summary);

        json sa_arr = json::array();
        for (const auto& sa : r.suspicious_accounts)
            sa_arr.push_back(suspicious_account_to_json(sa));
        result_obj["suspicious_accounts"] = sa_arr;

        json fr_arr = json::array();
        for (const auto& fr : r.fraud_rings)
            fr_arr.push_back(fraud_ring_to_json(fr));
        result_obj["fraud_rings"] = fr_arr;

        j["result"] = result_obj;

    } else if (r.status == AnalysisStatus::FAILED) {
        j["error"] = r.error;

    } else {
        // PENDING / PROCESSING – minimal
        j["result"] = nullptr;
    }

    return j;
}

// ── Spec-compliant download JSON ─────────────────────────────────────────
// Only includes spec-mandated fields for line-by-line test matching.

inline json download_suspicious_account_to_json(const SuspiciousAccount& sa) {
    return json{
        {"account_id",        sa.account_id},
        {"suspicion_score",   sa.suspicion_score},
        {"detected_patterns", sa.detected_patterns},
        {"ring_id",           sa.ring_id}
    };
}

inline json download_summary_to_json(const Summary& s) {
    return json{
        {"total_accounts_analyzed",     s.total_accounts_analyzed},
        {"suspicious_accounts_flagged", s.suspicious_accounts_flagged},
        {"fraud_rings_detected",        s.fraud_rings_detected},
        {"processing_time_seconds",     std::round(s.processing_time_seconds * 1000.0) / 1000.0}
    };
}

inline json download_result_to_json(const AnalysisResult& r) {
    json j;

    json sa_arr = json::array();
    for (const auto& sa : r.suspicious_accounts)
        sa_arr.push_back(download_suspicious_account_to_json(sa));
    j["suspicious_accounts"] = sa_arr;

    json fr_arr = json::array();
    for (const auto& fr : r.fraud_rings)
        fr_arr.push_back(fraud_ring_to_json(fr));
    j["fraud_rings"] = fr_arr;

    j["summary"] = download_summary_to_json(r.summary);

    return j;
}

} // namespace mm
