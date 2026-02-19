#pragma once
// ============================================================================
// CSV Parser – fast, streaming CSV reader with column remapping
// ============================================================================

#include "models.h"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>
#include <unordered_map>
#include <cctype>

namespace mm {

// ─── Time parsing helpers ───────────────────────────────────────────────────

inline TimePoint parse_timestamp(const std::string& s) {
    // Try multiple formats
    std::tm tm{};
    // ISO 8601: 2024-01-15T10:30:00
    if (auto* p = strptime(s.c_str(), "%Y-%m-%dT%H:%M:%S", &tm); p != nullptr) {
        return std::chrono::system_clock::from_time_t(timegm(&tm));
    }
    // ISO 8601 with space: 2024-01-15 10:30:00
    if (auto* p = strptime(s.c_str(), "%Y-%m-%d %H:%M:%S", &tm); p != nullptr) {
        return std::chrono::system_clock::from_time_t(timegm(&tm));
    }
    // Date only: 2024-01-15
    if (auto* p = strptime(s.c_str(), "%Y-%m-%d", &tm); p != nullptr) {
        return std::chrono::system_clock::from_time_t(timegm(&tm));
    }
    // MM/DD/YYYY HH:MM:SS
    if (auto* p = strptime(s.c_str(), "%m/%d/%Y %H:%M:%S", &tm); p != nullptr) {
        return std::chrono::system_clock::from_time_t(timegm(&tm));
    }
    // MM/DD/YYYY
    if (auto* p = strptime(s.c_str(), "%m/%d/%Y", &tm); p != nullptr) {
        return std::chrono::system_clock::from_time_t(timegm(&tm));
    }
    // Fallback: epoch
    return std::chrono::system_clock::time_point{};
}

inline std::string timepoint_to_iso(TimePoint tp) {
    auto t = std::chrono::system_clock::to_time_t(tp);
    std::tm tm;
    gmtime_r(&t, &tm);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tm);
    return std::string(buf);
}

// ─── CSV splitting ──────────────────────────────────────────────────────────

inline std::vector<std::string> split_csv_line(const std::string& line) {
    std::vector<std::string> fields;
    std::string field;
    bool in_quotes = false;

    for (size_t i = 0; i < line.size(); ++i) {
        char c = line[i];
        if (c == '"') {
            if (in_quotes && i + 1 < line.size() && line[i + 1] == '"') {
                field += '"';
                ++i;
            } else {
                in_quotes = !in_quotes;
            }
        } else if (c == ',' && !in_quotes) {
            fields.push_back(field);
            field.clear();
        } else {
            field += c;
        }
    }
    fields.push_back(field);
    return fields;
}

inline std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return {};
    auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

inline std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return s;
}

// ─── CSV Validation & Parsing ───────────────────────────────────────────────

struct CsvParseResult {
    std::vector<Transaction> transactions;
    std::string error;
    bool ok = true;
};

/**
 * Parse CSV content into Transaction objects.
 * Supports column remapping (sender_id→sender, receiver_id→receiver).
 * Validates required columns exist.
 */
inline CsvParseResult parse_csv(const std::string& content) {
    CsvParseResult result;

    if (content.empty()) {
        result.ok = false;
        result.error = "Empty CSV content";
        return result;
    }

    std::istringstream stream(content);
    std::string line;

    // Parse header
    if (!std::getline(stream, line)) {
        result.ok = false;
        result.error = "No header row found";
        return result;
    }

    auto headers = split_csv_line(line);
    for (auto& h : headers) {
        h = to_lower(trim(h));
    }

    // Column mapping
    static const std::unordered_map<std::string, std::string> remap = {
        {"sender_id", "sender"}, {"receiver_id", "receiver"},
        {"from", "sender"},      {"to", "receiver"},
        {"source", "sender"},    {"target", "receiver"},
        {"src", "sender"},       {"dst", "receiver"},
        {"date", "timestamp"},   {"datetime", "timestamp"},
        {"time", "timestamp"},   {"txn_amount", "amount"},
        {"value", "amount"},
    };

    std::unordered_map<std::string, int> col_idx;
    for (int i = 0; i < (int)headers.size(); ++i) {
        std::string h = headers[i];
        if (remap.count(h)) h = remap.at(h);
        col_idx[h] = i;
    }

    // Validate required columns
    for (const auto& req : {"sender", "receiver", "amount", "timestamp"}) {
        if (col_idx.find(req) == col_idx.end()) {
            result.ok = false;
            result.error = std::string("Missing required column: ") + req;
            return result;
        }
    }

    int sender_i    = col_idx["sender"];
    int receiver_i  = col_idx["receiver"];
    int amount_i    = col_idx["amount"];
    int timestamp_i = col_idx["timestamp"];
    int txn_id_i    = col_idx.count("transaction_id") ? col_idx["transaction_id"] : -1;
    int max_col     = std::max({sender_i, receiver_i, amount_i, timestamp_i});

    // Parse data rows
    int line_num = 1;
    while (std::getline(stream, line)) {
        ++line_num;
        line = trim(line);
        if (line.empty()) continue;

        auto fields = split_csv_line(line);
        if ((int)fields.size() <= max_col) continue; // skip malformed rows

        Transaction txn;
        txn.sender   = trim(fields[sender_i]);
        txn.receiver = trim(fields[receiver_i]);
        if (txn_id_i >= 0 && txn_id_i < (int)fields.size()) {
            txn.transaction_id = trim(fields[txn_id_i]);
        }

        // Parse amount
        std::string amt_str = trim(fields[amount_i]);
        // Remove currency symbols and commas
        std::string clean_amt;
        for (char c : amt_str) {
            if (std::isdigit(c) || c == '.' || c == '-') clean_amt += c;
        }
        try {
            txn.amount = clean_amt.empty() ? 0.0 : std::stod(clean_amt);
        } catch (...) {
            txn.amount = 0.0;
        }

        // Parse timestamp
        txn.timestamp = parse_timestamp(trim(fields[timestamp_i]));

        if (!txn.sender.empty() && !txn.receiver.empty()) {
            result.transactions.push_back(std::move(txn));
        }
    }

    if (result.transactions.empty()) {
        result.ok = false;
        result.error = "No valid transactions found in CSV";
    }

    return result;
}

} // namespace mm
