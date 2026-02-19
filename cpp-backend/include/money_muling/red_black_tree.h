#pragma once
// ============================================================================
// Red-Black Tree – Custom implementation for time-series transaction queries
//
// Stores transactions indexed by timestamp for O(log n) range queries.
// Supports:  insert, range_query(start, end), all(), size()
// ============================================================================

#include "models.h"
#include <functional>
#include <memory>
#include <vector>

namespace mm {

class RedBlackTree {
public:
    RedBlackTree()  = default;
    ~RedBlackTree() { clear(); }

    // No copy (move only)
    RedBlackTree(const RedBlackTree&) = delete;
    RedBlackTree& operator=(const RedBlackTree&) = delete;
    RedBlackTree(RedBlackTree&& o) noexcept : root_(o.root_), size_(o.size_) {
        o.root_ = nullptr; o.size_ = 0;
    }
    RedBlackTree& operator=(RedBlackTree&& o) noexcept {
        if (this != &o) { clear(); root_ = o.root_; size_ = o.size_; o.root_ = nullptr; o.size_ = 0; }
        return *this;
    }

    // ── Insert a transaction (key = timestamp) ─────────────────────────
    void insert(const Transaction& txn) {
        auto* z = new Node{txn, Color::RED};
        bst_insert(z);
        fix_insert(z);
        ++size_;
    }

    // ── Range query: all transactions with start <= ts <= end ──────────
    std::vector<const Transaction*> range_query(TimePoint start, TimePoint end) const {
        std::vector<const Transaction*> out;
        out.reserve(64);
        range_collect(root_, start, end, out);
        return out;
    }

    // ── Collect all transactions (in-order) ────────────────────────────
    std::vector<const Transaction*> all() const {
        std::vector<const Transaction*> out;
        out.reserve(size_);
        inorder(root_, out);
        return out;
    }

    // ── Get all transactions for a specific sender ─────────────────────
    std::vector<const Transaction*> by_sender(const std::string& s) const {
        std::vector<const Transaction*> out;
        collect_if(root_, out, [&](const Transaction& t){ return t.sender == s; });
        return out;
    }

    // ── Get all transactions for a specific receiver ───────────────────
    std::vector<const Transaction*> by_receiver(const std::string& r) const {
        std::vector<const Transaction*> out;
        collect_if(root_, out, [&](const Transaction& t){ return t.receiver == r; });
        return out;
    }

    size_t size() const { return size_; }
    bool empty()  const { return size_ == 0; }

    void clear() { destroy(root_); root_ = nullptr; size_ = 0; }

private:
    enum class Color : uint8_t { RED, BLACK };

    struct Node {
        Transaction txn;
        Color       color  = Color::RED;
        Node*       left   = nullptr;
        Node*       right  = nullptr;
        Node*       parent = nullptr;
    };

    Node*  root_ = nullptr;
    size_t size_ = 0;

    // ── BST insert ─────────────────────────────────────────────────────
    void bst_insert(Node* z) {
        Node* y = nullptr;
        Node* x = root_;
        while (x) {
            y = x;
            x = (z->txn.timestamp < x->txn.timestamp) ? x->left : x->right;
        }
        z->parent = y;
        if (!y)
            root_ = z;
        else if (z->txn.timestamp < y->txn.timestamp)
            y->left = z;
        else
            y->right = z;
    }

    // ── Fix RB properties after insert ─────────────────────────────────
    void fix_insert(Node* z) {
        while (z != root_ && z->parent->color == Color::RED) {
            Node* gp = z->parent->parent;
            if (!gp) break;

            if (z->parent == gp->left) {
                Node* uncle = gp->right;
                if (uncle && uncle->color == Color::RED) {
                    z->parent->color = Color::BLACK;
                    uncle->color     = Color::BLACK;
                    gp->color        = Color::RED;
                    z = gp;
                } else {
                    if (z == z->parent->right) {
                        z = z->parent;
                        rotate_left(z);
                    }
                    z->parent->color = Color::BLACK;
                    gp->color        = Color::RED;
                    rotate_right(gp);
                }
            } else {
                Node* uncle = gp->left;
                if (uncle && uncle->color == Color::RED) {
                    z->parent->color = Color::BLACK;
                    uncle->color     = Color::BLACK;
                    gp->color        = Color::RED;
                    z = gp;
                } else {
                    if (z == z->parent->left) {
                        z = z->parent;
                        rotate_right(z);
                    }
                    z->parent->color = Color::BLACK;
                    gp->color        = Color::RED;
                    rotate_left(gp);
                }
            }
        }
        root_->color = Color::BLACK;
    }

    // ── Rotations ──────────────────────────────────────────────────────
    void rotate_left(Node* x) {
        Node* y = x->right;
        x->right = y->left;
        if (y->left) y->left->parent = x;
        y->parent = x->parent;
        if (!x->parent)
            root_ = y;
        else if (x == x->parent->left)
            x->parent->left = y;
        else
            x->parent->right = y;
        y->left   = x;
        x->parent = y;
    }

    void rotate_right(Node* x) {
        Node* y = x->left;
        x->left = y->right;
        if (y->right) y->right->parent = x;
        y->parent = x->parent;
        if (!x->parent)
            root_ = y;
        else if (x == x->parent->right)
            x->parent->right = y;
        else
            x->parent->left = y;
        y->right  = x;
        x->parent = y;
    }

    // ── Range collection (in-order, pruned) ────────────────────────────
    void range_collect(Node* n, TimePoint lo, TimePoint hi,
                       std::vector<const Transaction*>& out) const {
        if (!n) return;
        if (n->txn.timestamp >= lo)
            range_collect(n->left, lo, hi, out);
        if (n->txn.timestamp >= lo && n->txn.timestamp <= hi)
            out.push_back(&n->txn);
        if (n->txn.timestamp <= hi)
            range_collect(n->right, lo, hi, out);
    }

    // ── In-order traversal ─────────────────────────────────────────────
    void inorder(Node* n, std::vector<const Transaction*>& out) const {
        if (!n) return;
        inorder(n->left, out);
        out.push_back(&n->txn);
        inorder(n->right, out);
    }

    // ── Conditional collection ─────────────────────────────────────────
    void collect_if(Node* n, std::vector<const Transaction*>& out,
                    const std::function<bool(const Transaction&)>& pred) const {
        if (!n) return;
        collect_if(n->left, out, pred);
        if (pred(n->txn)) out.push_back(&n->txn);
        collect_if(n->right, out, pred);
    }

    // ── Destructor helper ──────────────────────────────────────────────
    void destroy(Node* n) {
        if (!n) return;
        destroy(n->left);
        destroy(n->right);
        delete n;
    }
};

} // namespace mm
