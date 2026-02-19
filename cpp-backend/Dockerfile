# ============================================================================
# Multi-stage Docker build for Money Muling Detector C++ Backend
# ============================================================================

# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source
COPY CMakeLists.txt .
COPY include/ include/
COPY src/ src/

# Build (disable march=native — Docker build CPU ≠ runtime CPU)
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DENABLE_REDIS=OFF \
    -DCMAKE_CXX_FLAGS_RELEASE="-O3 -DNDEBUG" \
    && cmake --build build --parallel $(nproc)

# ── Stage 2: Runtime ─────────────────────────────────────────────────────
FROM ubuntu:22.04 AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libssl3 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash appuser

WORKDIR /app

# Copy binary
COPY --from=builder /app/build/money_muling_detector .

# Own by appuser
RUN chown -R appuser:appuser /app

USER appuser

ENV PORT=8000

# Railway overrides PORT at runtime; EXPOSE is documentation only
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["./money_muling_detector"]
