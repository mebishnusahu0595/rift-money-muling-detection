#pragma once
// ============================================================================
// Money Muling Detector – Data Models (C++ 20)
// Mirrors the Python Pydantic models exactly for API compatibility.
// ============================================================================

#include <chrono>
#include <cmath>
#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>

namespace mm {

// ─── Time helpers ───────────────────────────────────────────────────────────
using TimePoint = std::chrono::system_clock::time_point;

// ─── Enums ──────────────────────────────────────────────────────────────────
enum class AnalysisStatus { PENDING, PROCESSING, COMPLETED, FAILED };

inline const char* status_to_string(AnalysisStatus s) {
    switch (s) {
        case AnalysisStatus::PENDING:    return "pending";
        case AnalysisStatus::PROCESSING: return "processing";
        case AnalysisStatus::COMPLETED:  return "complete";
        case AnalysisStatus::FAILED:     return "error";
    }
    return "unknown";
}

enum class PatternType { CYCLE, FAN_IN, FAN_OUT, SHELL };

inline const char* pattern_to_string(PatternType p) {
    switch (p) {
        case PatternType::CYCLE:   return "cycle";
        case PatternType::FAN_IN:  return "fan_in";
        case PatternType::FAN_OUT: return "fan_out";
        case PatternType::SHELL:   return "shell";
    }
    return "unknown";
}

// ─── Transaction (single CSV row) ──────────────────────────────────────────
struct Transaction {
    std::string transaction_id;
    std::string sender;
    std::string receiver;
    double      amount    = 0.0;
    TimePoint   timestamp{};
};

// ─── Account Profile ────────────────────────────────────────────────────────
struct AccountProfile {
    std::string account_id;
    bool is_payroll              = false;
    bool is_merchant             = false;
    bool is_salary               = false;
    bool is_established_business = false;
    std::string account_type     = "unknown"; // individual / business / unknown
    double total_inflow          = 0.0;
    double total_outflow         = 0.0;
    int    transaction_count     = 0;
    TimePoint first_seen{};
    TimePoint last_seen{};
};

// ─── Cycle Detection Result ────────────────────────────────────────────────
struct CycleResult {
    std::string              ring_id;
    std::vector<std::string> nodes;
    int                      length       = 0;
    double                   total_amount = 0.0;
    double                   time_span_hours = 0.0;
    int                      edge_count   = 0;
    std::string              pattern_type = "cycle";
};

// ─── Smurfing Detection Result ─────────────────────────────────────────────
struct SmurfingResult {
    std::string account_id;
    std::string pattern_type;          // "fan_in" or "fan_out"
    int         unique_counterparties = 0;
    double      total_amount          = 0.0;
    double      velocity_per_hour     = 0.0;
    std::string window_start;          // ISO-8601
    std::string window_end;            // ISO-8601
    std::string ring_id;               // assigned during scoring
};

// ─── Shell Detection Result ────────────────────────────────────────────────
struct ShellResult {
    std::string              ring_id;
    std::string              pattern_type = "shell";
    std::vector<std::string> chain;
    std::vector<std::string> intermediate_accounts;
    double                   total_amount = 0.0;
    int                      shell_depth  = 0;
    double                   risk_score   = 0.0;
};

// ─── Suspicious Account ────────────────────────────────────────────────────
struct SuspiciousAccount {
    std::string              account_id;
    double                   suspicion_score = 0.0;
    std::vector<std::string> detected_patterns;
    std::string              ring_id;
    std::string              account_type;
    double                   total_inflow  = 0.0;
    double                   total_outflow = 0.0;
    int                      transaction_count = 0;
    std::vector<std::string> connected_accounts;
    std::vector<std::string> ring_ids;
};

// ─── Fraud Ring ────────────────────────────────────────────────────────────
struct FraudRing {
    std::string              ring_id;
    std::vector<std::string> member_accounts;
    std::string              pattern_type;
    double                   risk_score = 0.0;
};

// ─── Summary ───────────────────────────────────────────────────────────────
struct Summary {
    int total_transactions          = 0;
    int total_accounts_analyzed     = 0;
    int suspicious_accounts_flagged = 0;
    int fraud_rings_detected        = 0;
    int total_cycles                = 0;
    int total_smurfing_patterns     = 0;
    int total_shell_patterns        = 0;
    double total_amount_at_risk     = 0.0;
    double processing_time_seconds  = 0.0;
};

// ─── Graph Visualization Data ──────────────────────────────────────────────
struct GraphNode {
    std::string              id;
    std::string              label;
    std::string              account_type;
    double                   suspicion_score  = 0.0;
    double                   total_inflow     = 0.0;
    double                   total_outflow    = 0.0;
    int                      transaction_count = 0;
    bool                     is_suspicious    = false;
    std::vector<std::string> ring_ids;
    std::vector<std::string> patterns;           // raw pattern types ("cycle", "shell", etc.)
    std::vector<std::string> detected_patterns;  // spec-format patterns ("cycle_length_3", etc.)
};

struct GraphEdge {
    std::string source;
    std::string target;
    double      total_amount      = 0.0;
    int         transaction_count = 0;
    bool        is_suspicious     = false;
    std::string pattern_type;
};

struct GraphData {
    std::vector<GraphNode> nodes;
    std::vector<GraphEdge> edges;
};

// ─── Full Analysis Result ──────────────────────────────────────────────────
struct AnalysisResult {
    std::string                    analysis_id;
    AnalysisStatus                 status = AnalysisStatus::PENDING;
    Summary                        summary;
    std::vector<SuspiciousAccount> suspicious_accounts;
    std::vector<FraudRing>         fraud_rings;
    std::vector<CycleResult>       cycles;
    std::vector<SmurfingResult>    smurfing;
    std::vector<ShellResult>       shells;
    GraphData                      graph_data;
    double                         processing_time_ms = 0.0;
    double                         progress = 0.0;
    std::string                    error;
};

// ─── Edge data for graph building ──────────────────────────────────────────
struct EdgeData {
    double total_amount      = 0.0;
    int    transaction_count = 0;
    TimePoint earliest{};
    TimePoint latest{};
};

} // namespace mm
