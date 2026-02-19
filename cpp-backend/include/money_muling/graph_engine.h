#pragma once
// ============================================================================
// Graph Engine – directed multi-graph for transaction network analysis
//
// Adjacency-list representation with O(1) neighbour & edge lookups.
// Mirrors Python graph_builder.py: build_graph, collapse, profiles, viz data.
// ============================================================================

#include "models.h"

#include <algorithm>
#include <cmath>
#include <regex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace mm {

// ─── Multi-edge storage ────────────────────────────────────────────────────
struct MultiEdge {
    std::string from;
    std::string to;
    double      amount = 0.0;
    TimePoint   timestamp{};
};

// ─── Node attributes ──────────────────────────────────────────────────────
struct NodeAttr {
    double total_inflow       = 0.0;
    double total_outflow      = 0.0;
    int    transaction_count  = 0;
    TimePoint first_seen{};
    TimePoint last_seen{};
};

// ─── Aggregated edge (for the simple DiGraph) ─────────────────────────────
struct AggEdge {
    double total_amount      = 0.0;
    int    transaction_count = 0;
    TimePoint earliest{};
    TimePoint latest{};
};

// ─── Transaction Graph ────────────────────────────────────────────────────
class TransactionGraph {
public:
    TransactionGraph() = default;

    // Build from parsed transactions (mirrors graph_builder.build_graph)
    void build(const std::vector<Transaction>& txns) {
        clear();
        txns_ = &txns;

        for (const auto& t : txns) {
            // Ensure nodes exist
            ensure_node(t.sender);
            ensure_node(t.receiver);

            // Update node attributes
            auto& sn = nodes_[t.sender];
            sn.total_outflow      += t.amount;
            sn.transaction_count  += 1;
            update_time(sn, t.timestamp);

            auto& rn = nodes_[t.receiver];
            rn.total_inflow       += t.amount;
            rn.transaction_count  += 1;
            update_time(rn, t.timestamp);

            // Add multi-edge
            multi_edges_.push_back({t.sender, t.receiver, t.amount, t.timestamp});

            // Aggregate for simple digraph
            auto key = edge_key(t.sender, t.receiver);
            auto& agg = agg_edges_[key];
            agg.total_amount      += t.amount;
            agg.transaction_count += 1;
            if (agg.transaction_count == 1) {
                agg.earliest = t.timestamp;
                agg.latest   = t.timestamp;
            } else {
                if (t.timestamp < agg.earliest) agg.earliest = t.timestamp;
                if (t.timestamp > agg.latest)   agg.latest   = t.timestamp;
            }

            // Adjacency
            adj_[t.sender].insert(t.receiver);
            // Also track reverse adjacency for in-degree lookups
            rev_adj_[t.receiver].insert(t.sender);

            // Edge data list: (sender, receiver) → list of (amount, timestamp)
            edge_txns_[{t.sender, t.receiver}].push_back({t.amount, t.timestamp});
        }
    }

    // ── Node accessors ─────────────────────────────────────────────────
    const std::unordered_map<std::string, NodeAttr>& all_nodes() const { return nodes_; }
    bool has_node(const std::string& n) const { return nodes_.count(n); }
    const NodeAttr& node(const std::string& n) const { return nodes_.at(n); }
    size_t node_count() const { return nodes_.size(); }

    // ── Edge accessors ─────────────────────────────────────────────────
    const std::unordered_map<std::string, AggEdge>& all_agg_edges() const { return agg_edges_; }
    bool has_edge(const std::string& u, const std::string& v) const {
        return agg_edges_.count(edge_key(u, v));
    }
    const AggEdge& agg_edge(const std::string& u, const std::string& v) const {
        return agg_edges_.at(edge_key(u, v));
    }

    // ── Adjacency ──────────────────────────────────────────────────────
    const std::unordered_set<std::string>& successors(const std::string& n) const {
        static const std::unordered_set<std::string> empty;
        auto it = adj_.find(n);
        return it != adj_.end() ? it->second : empty;
    }
    const std::unordered_set<std::string>& predecessors(const std::string& n) const {
        static const std::unordered_set<std::string> empty;
        auto it = rev_adj_.find(n);
        return it != rev_adj_.end() ? it->second : empty;
    }

    int out_degree(const std::string& n) const {
        auto it = adj_.find(n);
        return it != adj_.end() ? (int)it->second.size() : 0;
    }
    int in_degree(const std::string& n) const {
        auto it = rev_adj_.find(n);
        return it != rev_adj_.end() ? (int)it->second.size() : 0;
    }

    // ── Edge transaction data ──────────────────────────────────────────
    using TxnPair = std::pair<double, TimePoint>;
    const std::vector<TxnPair>& edge_transactions(const std::string& u,
                                                    const std::string& v) const {
        static const std::vector<TxnPair> empty;
        auto it = edge_txns_.find({u, v});
        return it != edge_txns_.end() ? it->second : empty;
    }

    // ── All unique directed edges (u→v) ────────────────────────────────
    std::vector<std::pair<std::string, std::string>> directed_edges() const {
        std::vector<std::pair<std::string, std::string>> out;
        out.reserve(agg_edges_.size());
        for (const auto& [key, _] : agg_edges_) {
            auto sep = key.find("→");
            if (sep != std::string::npos) {
                // UTF-8 "→" is 3 bytes
                out.emplace_back(key.substr(0, sep), key.substr(sep + 3));
            }
        }
        return out;
    }

    // ── Build account profiles (mirrors graph_builder.build_account_profiles) ──
    std::unordered_map<std::string, AccountProfile> build_profiles() const {
        std::unordered_map<std::string, AccountProfile> profiles;
        profiles.reserve(nodes_.size());
        // Pre-build business cache once — avoids repeated regex per node
        build_business_cache();

        for (const auto& [id, attr] : nodes_) {
            AccountProfile p;
            p.account_id        = id;
            p.total_inflow      = attr.total_inflow;
            p.total_outflow     = attr.total_outflow;
            p.transaction_count = attr.transaction_count;
            p.first_seen        = attr.first_seen;
            p.last_seen         = attr.last_seen;
            p.account_type      = is_business_cached(id) ? "business" : "individual";
            profiles[id]        = std::move(p);
        }
        return profiles;
    }

    // ── Build graph visualization data ─────────────────────────────────
    GraphData build_graph_data(
        const std::unordered_map<std::string, double>& scores,
        const std::unordered_map<std::string, std::vector<std::string>>& ring_map,
        const std::unordered_map<std::string, std::vector<std::string>>& pattern_map
    ) const {
        GraphData gd;
        gd.nodes.reserve(nodes_.size());
        gd.edges.reserve(agg_edges_.size());
        // Ensure business cache is warm
        build_business_cache();

        // Nodes
        for (const auto& [id, attr] : nodes_) {
            GraphNode gn;
            gn.id                = id;
            gn.label             = id;
            gn.account_type      = is_business_cached(id) ? "business" : "individual";
            gn.total_inflow      = attr.total_inflow;
            gn.total_outflow     = attr.total_outflow;
            gn.transaction_count = attr.transaction_count;

            auto sit = scores.find(id);
            gn.suspicion_score = sit != scores.end() ? sit->second : 0.0;
            gn.is_suspicious   = gn.suspicion_score >= 25.0;

            auto rit = ring_map.find(id);
            if (rit != ring_map.end()) gn.ring_ids = rit->second;

            // patterns = raw type strings; detected_patterns = spec-format
            // (spec-format strings are injected by analysis_engine.h post-build)
            auto pit = pattern_map.find(id);
            if (pit != pattern_map.end()) gn.patterns = pit->second;

            gd.nodes.push_back(std::move(gn));
        }

        // Edges
        for (const auto& [key, agg] : agg_edges_) {
            auto sep = key.find("→");
            if (sep == std::string::npos) continue;

            GraphEdge ge;
            ge.source            = key.substr(0, sep);
            ge.target            = key.substr(sep + 3);
            ge.total_amount      = agg.total_amount;
            ge.transaction_count = agg.transaction_count;

            // Mark suspicious if either endpoint is suspicious
            auto s1 = scores.find(ge.source);
            auto s2 = scores.find(ge.target);
            double sc1 = s1 != scores.end() ? s1->second : 0.0;
            double sc2 = s2 != scores.end() ? s2->second : 0.0;
            ge.is_suspicious = (sc1 >= 25.0 || sc2 >= 25.0);

            // Determine pattern type from pattern_map
            auto pp = pattern_map.find(ge.source);
            if (pp != pattern_map.end() && !pp->second.empty())
                ge.pattern_type = pp->second.front();

            gd.edges.push_back(std::move(ge));
        }

        return gd;
    }

    void clear() {
        nodes_.clear();
        multi_edges_.clear();
        agg_edges_.clear();
        adj_.clear();
        rev_adj_.clear();
        edge_txns_.clear();
        business_cache_.clear();
        txns_ = nullptr;
    }

private:
    // Hash for pair<string,string>
    struct PairHash {
        size_t operator()(const std::pair<std::string, std::string>& p) const {
            auto h1 = std::hash<std::string>{}(p.first);
            auto h2 = std::hash<std::string>{}(p.second);
            return h1 ^ (h2 << 32 | h2 >> 32);
        }
    };

    std::unordered_map<std::string, NodeAttr>                  nodes_;
    std::vector<MultiEdge>                                      multi_edges_;
    std::unordered_map<std::string, AggEdge>                   agg_edges_;  // key = "u→v"
    std::unordered_map<std::string, std::unordered_set<std::string>> adj_;
    std::unordered_map<std::string, std::unordered_set<std::string>> rev_adj_;
    std::unordered_map<std::pair<std::string,std::string>,
                       std::vector<TxnPair>, PairHash>         edge_txns_;
    const std::vector<Transaction>* txns_ = nullptr;
    mutable std::unordered_map<std::string, bool> business_cache_;  // id → is_business

    static std::string edge_key(const std::string& u, const std::string& v) {
        return u + "→" + v;
    }

    void ensure_node(const std::string& id) {
        if (!nodes_.count(id)) {
            nodes_[id] = NodeAttr{};
        }
    }

    void update_time(NodeAttr& n, TimePoint tp) {
        if (n.transaction_count <= 1) {
            n.first_seen = tp;
            n.last_seen  = tp;
        } else {
            if (tp < n.first_seen) n.first_seen = tp;
            if (tp > n.last_seen)  n.last_seen  = tp;
        }
    }

    // Pre-populate business_cache_ for all nodes — called once per build
    void build_business_cache() const {
        if (business_cache_.size() == nodes_.size()) return;  // already warm
        static const std::regex pat(
            "(corp|inc|llc|ltd|co\\b|merchant|store|shop|pay|bank|services)",
            std::regex::icase | std::regex::optimize);
        for (const auto& [id, _] : nodes_) {
            if (!business_cache_.count(id))
                business_cache_[id] = std::regex_search(id, pat);
        }
    }

    bool is_business_cached(const std::string& id) const {
        auto it = business_cache_.find(id);
        return it != business_cache_.end() && it->second;
    }

    static bool looks_like_business(const std::string& id) {
        static const std::regex pat(
            "(corp|inc|llc|ltd|co\\b|merchant|store|shop|pay|bank|services)",
            std::regex::icase | std::regex::optimize);
        return std::regex_search(id, pat);
    }
};

} // namespace mm
