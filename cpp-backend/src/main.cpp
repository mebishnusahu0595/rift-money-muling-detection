// ============================================================================
// main.cpp – Crow HTTP server for Money Muling Detector
//
// Routes (same API contract as Python/FastAPI):
//   POST   /api/v1/analyze          – upload CSV, start analysis
//   GET    /api/v1/analysis/{id}    – poll status / get results
//   GET    /api/v1/analysis/{id}/download – download JSON report
//   GET    /api/v1/analysis/{id}/graph    – get graph visualisation data
//   GET    /health                  – health check
// ============================================================================

#include "crow.h"
#include <nlohmann/json.hpp>

#include "money_muling/models.h"
#include "money_muling/analysis_engine.h"
#include "money_muling/json_serializer.h"
#include "money_muling/store.h"

#include <chrono>
#include <cstdlib>
#include <functional>
#include <future>
#include <iostream>
#include <random>
#include <sstream>
#include <string>
#include <thread>

using json = nlohmann::json;

// ── UUID Generation ──────────────────────────────────────────────────────

static std::string generate_uuid() {
    static std::mt19937 rng(
        static_cast<unsigned>(
            std::chrono::steady_clock::now().time_since_epoch().count()));
    static std::uniform_int_distribution<int> dist(0, 15);
    static const char* hex = "0123456789abcdef";

    std::string uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    for (auto& c : uuid) {
        if (c == 'x') {
            c = hex[dist(rng)];
        } else if (c == 'y') {
            c = hex[(dist(rng) & 0x3) | 0x8];
        }
    }
    return uuid;
}

// ── CORS Middleware ──────────────────────────────────────────────────────

struct CORSMiddleware {
    struct context {};

    void before_handle(crow::request& /*req*/, crow::response& /*res*/,
                       context& /*ctx*/) {}

    void after_handle(crow::request& /*req*/, crow::response& res,
                      context& /*ctx*/) {
        res.add_header("Access-Control-Allow-Origin", "*");
        res.add_header("Access-Control-Allow-Methods",
                       "GET, POST, PUT, DELETE, OPTIONS");
        res.add_header("Access-Control-Allow-Headers",
                       "Content-Type, Authorization");
        res.add_header("Access-Control-Max-Age", "86400");
    }
};

// ── Multipart body helper ────────────────────────────────────────────────

static std::string extract_file_content(const std::string& body,
                                         const std::string& content_type) {
    // Find boundary from content-type
    auto bpos = content_type.find("boundary=");
    if (bpos == std::string::npos) return "";
    std::string boundary = "--" + content_type.substr(bpos + 9);

    // Remove quotes if present
    if (!boundary.empty() && boundary.back() == '"')
        boundary.pop_back();
    if (boundary.size() > 2 && boundary[2] == '"')
        boundary = boundary.substr(0, 2) + boundary.substr(3);

    // Find first part
    auto part_start = body.find(boundary);
    if (part_start == std::string::npos) return "";
    part_start += boundary.size();

    // Find end of headers (double newline)
    auto header_end = body.find("\r\n\r\n", part_start);
    if (header_end == std::string::npos) {
        header_end = body.find("\n\n", part_start);
        if (header_end == std::string::npos) return "";
        header_end += 2;
    } else {
        header_end += 4;
    }

    // Find end of part (next boundary)
    auto part_end = body.find(boundary, header_end);
    if (part_end == std::string::npos) {
        part_end = body.size();
    }

    // Trim trailing \r\n before boundary
    while (part_end > header_end &&
           (body[part_end - 1] == '\n' || body[part_end - 1] == '\r')) {
        --part_end;
    }

    return body.substr(header_end, part_end - header_end);
}

// ── Main ─────────────────────────────────────────────────────────────────

int main() {
    crow::App<CORSMiddleware> app;

    constexpr size_t MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

    // ── OPTIONS (preflight) ──────────────────────────────────────────
    CROW_CATCHALL_ROUTE(app)
    ([](const crow::request& req) {
        if (req.method == crow::HTTPMethod::OPTIONS) {
            crow::response res(204);
            res.add_header("Access-Control-Allow-Origin", "*");
            res.add_header("Access-Control-Allow-Methods",
                           "GET, POST, PUT, DELETE, OPTIONS");
            res.add_header("Access-Control-Allow-Headers",
                           "Content-Type, Authorization");
            res.add_header("Access-Control-Max-Age", "86400");
            return res;
        }
        return crow::response(404);
    });

    // ── GET /health ──────────────────────────────────────────────────
    CROW_ROUTE(app, "/health")
    ([]() {
        json j = {{"status", "healthy"},
                  {"service", "money-muling-detector-cpp"}};
        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = j.dump();
        return res;
    });

    // ── POST /api/v1/analyze ─────────────────────────────────────────
    CROW_ROUTE(app, "/api/v1/analyze").methods(crow::HTTPMethod::POST)
    ([&](const crow::request& req) {
        // Extract file content from multipart body
        std::string ct = req.get_header_value("Content-Type");
        std::string csv_content;

        if (ct.find("multipart/form-data") != std::string::npos) {
            csv_content = extract_file_content(req.body, ct);
        } else {
            // Plain text body
            csv_content = req.body;
        }

        if (csv_content.empty()) {
            json err = {{"detail", "No file content received"}};
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = err.dump();
            return res;
        }

        if (csv_content.size() > MAX_FILE_SIZE) {
            json err = {{"detail", "File too large. Maximum size is 10MB."}};
            crow::response res(413);
            res.set_header("Content-Type", "application/json");
            res.body = err.dump();
            return res;
        }

        // Generate analysis ID
        std::string analysis_id = generate_uuid();

        // Store as PENDING
        mm::AnalysisResult pending;
        pending.analysis_id = analysis_id;
        pending.status      = mm::AnalysisStatus::PENDING;
        mm::Store::instance().put(analysis_id, std::move(pending));

        // Fire-and-forget async analysis
        std::thread([analysis_id, csv_content]() {
            mm::Store::instance().update_status(analysis_id,
                                                mm::AnalysisStatus::PROCESSING);
            auto result = mm::AnalysisEngine::run(analysis_id, csv_content);
            mm::Store::instance().put(analysis_id, std::move(result));
        }).detach();

        // Return analysis_id immediately
        json resp = {{"analysis_id", analysis_id},
                     {"status",      "pending"}};
        crow::response res(202);
        res.set_header("Content-Type", "application/json");
        res.body = resp.dump();
        return res;
    });

    // ── GET /api/v1/analysis/<id> ────────────────────────────────────
    CROW_ROUTE(app, "/api/v1/analysis/<string>")
    ([](const std::string& analysis_id) {
        auto result = mm::Store::instance().get(analysis_id);
        if (!result.has_value()) {
            json err = {{"detail", "Analysis not found"}};
            crow::response res(404);
            res.set_header("Content-Type", "application/json");
            res.body = err.dump();
            return res;
        }

        json j = mm::analysis_result_to_json(result.value());
        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = j.dump();
        return res;
    });

    // ── GET /api/v1/analysis/<id>/download ───────────────────────────
    CROW_ROUTE(app, "/api/v1/analysis/<string>/download")
    ([](const std::string& analysis_id) {
        auto result = mm::Store::instance().get(analysis_id);
        if (!result.has_value()) {
            json err = {{"detail", "Analysis not found"}};
            crow::response res(404);
            res.set_header("Content-Type", "application/json");
            res.body = err.dump();
            return res;
        }

        if (result->status != mm::AnalysisStatus::COMPLETED) {
            json err = {{"detail", "Analysis not yet completed"}};
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = err.dump();
            return res;
        }

        json j = mm::download_result_to_json(result.value());
        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.set_header("Content-Disposition",
                       "attachment; filename=\"analysis_" + analysis_id + ".json\"");
        res.body = j.dump(2); // pretty-printed
        return res;
    });

    // ── GET /api/v1/analysis/<id>/graph ──────────────────────────────
    CROW_ROUTE(app, "/api/v1/analysis/<string>/graph")
    ([](const std::string& analysis_id) {
        auto result = mm::Store::instance().get(analysis_id);
        if (!result.has_value()) {
            json err = {{"detail", "Analysis not found"}};
            crow::response res(404);
            res.set_header("Content-Type", "application/json");
            res.body = err.dump();
            return res;
        }

        if (result->status != mm::AnalysisStatus::COMPLETED) {
            json err = {{"detail", "Analysis not yet completed"}};
            crow::response res(400);
            res.set_header("Content-Type", "application/json");
            res.body = err.dump();
            return res;
        }

        json j = mm::graph_data_to_json(result->graph_data);
        crow::response res(200);
        res.set_header("Content-Type", "application/json");
        res.body = j.dump();
        return res;
    });

    // ── Start server ─────────────────────────────────────────────────
    int port = 8000;
    if (const char* env_port = std::getenv("PORT")) {
        port = std::atoi(env_port);
    }

    std::cout << "Money Muling Detector C++ Backend\n"
              << "Starting on port " << port << "...\n";

    app.port(port)
       .multithreaded()
       .run();

    return 0;
}
