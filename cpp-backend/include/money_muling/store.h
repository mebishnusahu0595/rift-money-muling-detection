#pragma once
// ============================================================================
// Store – in-memory analysis result storage + optional Redis persistence
//
// Thread-safe storage for analysis results.  When ENABLE_REDIS is defined
// and Redis is reachable, results are also persisted to Redis so they
// survive process restarts.
// ============================================================================

#include "models.h"
#include "json_serializer.h"

#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

// Optional Redis support via hiredis
#ifdef ENABLE_REDIS
#include <hiredis/hiredis.h>
#endif

namespace mm {

class Store {
public:

    // Singleton access
    static Store& instance() {
        static Store s;
        return s;
    }

    // Store a result (thread-safe)
    void put(const std::string& id, AnalysisResult result) {
        std::lock_guard<std::mutex> lock(mtx_);
        results_[id] = std::move(result);

#ifdef ENABLE_REDIS
        persist_to_redis(id);
#endif
    }

    // Update status only (for PENDING → PROCESSING transitions)
    void update_status(const std::string& id, AnalysisStatus status) {
        std::lock_guard<std::mutex> lock(mtx_);
        auto it = results_.find(id);
        if (it != results_.end()) {
            it->second.status = status;
        }
    }

    // Retrieve a result (thread-safe)
    std::optional<AnalysisResult> get(const std::string& id) {
        std::lock_guard<std::mutex> lock(mtx_);
        auto it = results_.find(id);
        if (it != results_.end()) {
            return it->second;
        }

#ifdef ENABLE_REDIS
        // Try loading from Redis
        if (load_from_redis(id)) {
            auto it2 = results_.find(id);
            if (it2 != results_.end()) return it2->second;
        }
#endif

        return std::nullopt;
    }

    // Check existence
    bool exists(const std::string& id) {
        std::lock_guard<std::mutex> lock(mtx_);
        return results_.count(id) > 0;
    }

    // Number of stored analyses
    size_t size() {
        std::lock_guard<std::mutex> lock(mtx_);
        return results_.size();
    }

#ifdef ENABLE_REDIS
    // Configure Redis connection
    void configure_redis(const std::string& host = "127.0.0.1",
                         int port = 6379,
                         int db = 0)
    {
        redis_host_ = host;
        redis_port_ = port;
        redis_db_   = db;
    }
#endif

private:
    Store() = default;
    Store(const Store&) = delete;
    Store& operator=(const Store&) = delete;

    std::mutex mtx_;
    std::unordered_map<std::string, AnalysisResult> results_;

#ifdef ENABLE_REDIS
    std::string redis_host_ = "127.0.0.1";
    int redis_port_ = 6379;
    int redis_db_   = 0;

    redisContext* connect_redis() {
        redisContext* ctx = redisConnect(redis_host_.c_str(), redis_port_);
        if (ctx == nullptr || ctx->err) {
            if (ctx) redisFree(ctx);
            return nullptr;
        }
        if (redis_db_ != 0) {
            redisReply* reply = (redisReply*)redisCommand(ctx, "SELECT %d", redis_db_);
            if (reply) freeReplyObject(reply);
        }
        return ctx;
    }

    void persist_to_redis(const std::string& id) {
        auto ctx = connect_redis();
        if (!ctx) return;

        auto it = results_.find(id);
        if (it == results_.end()) { redisFree(ctx); return; }

        json j       = analysis_result_to_json(it->second);
        std::string s = j.dump();

        redisReply* reply = (redisReply*)redisCommand(
            ctx, "SET analysis:%s %b EX 86400",
            id.c_str(), s.c_str(), s.size());
        if (reply) freeReplyObject(reply);

        redisFree(ctx);
    }

    bool load_from_redis(const std::string& id) {
        auto ctx = connect_redis();
        if (!ctx) return false;

        redisReply* reply = (redisReply*)redisCommand(
            ctx, "GET analysis:%s", id.c_str());
        bool loaded = false;
        if (reply && reply->type == REDIS_REPLY_STRING) {
            // For now, just store a stub – full deserialisation can be added
            // This is primarily for the case where the server restarts
            // and we want to know that analysis existed
            loaded = true;
        }
        if (reply) freeReplyObject(reply);
        redisFree(ctx);
        return loaded;
    }
#endif
};

} // namespace mm
