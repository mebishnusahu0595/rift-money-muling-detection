cmake_minimum_required(VERSION 3.18)
project(money_muling_detector VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── Build type ────────────────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# ── Optimization flags ───────────────────────────────────────────────────
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG")

# Check if march=native is supported
include(CheckCXXCompilerFlag)
check_cxx_compiler_flag("-march=native" COMPILER_SUPPORTS_MARCH_NATIVE)
if(COMPILER_SUPPORTS_MARCH_NATIVE)
    set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -march=native")
endif()

# LTO
include(CheckIPOSupported)
check_ipo_supported(RESULT IPO_SUPPORTED OUTPUT IPO_OUTPUT)
if(IPO_SUPPORTED)
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE TRUE)
endif()

# ── Dependencies via FetchContent ─────────────────────────────────────────
include(FetchContent)

# Crow HTTP framework (header-only)
FetchContent_Declare(
    Crow
    GIT_REPOSITORY https://github.com/CrowCpp/Crow.git
    GIT_TAG        v1.2.0
    GIT_SHALLOW    TRUE
)

# nlohmann/json (header-only)
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
    GIT_SHALLOW    TRUE
)

# Asio (required by Crow – standalone, no Boost)
FetchContent_Declare(
    asio
    GIT_REPOSITORY https://github.com/chriskohlhoff/asio.git
    GIT_TAG        asio-1-30-2
    GIT_SHALLOW    TRUE
)

message(STATUS "Fetching dependencies (Crow, nlohmann/json, Asio)...")
FetchContent_MakeAvailable(json)

# Asio needs special handling – it's not CMake-native
# Must be populated BEFORE Crow so Crow's FindAsio can locate it
FetchContent_GetProperties(asio)
if(NOT asio_POPULATED)
    FetchContent_Populate(asio)
endif()

# Tell Crow's FindAsio where the headers are
set(ASIO_INCLUDE_DIR "${asio_SOURCE_DIR}/asio/include" CACHE PATH "" FORCE)

add_library(asio INTERFACE)
target_include_directories(asio INTERFACE ${asio_SOURCE_DIR}/asio/include)
target_compile_definitions(asio INTERFACE ASIO_STANDALONE ASIO_NO_DEPRECATED)

# Crow config – disable Boost, examples, tests
set(CROW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(CROW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(CROW_FEATURES "" CACHE STRING "" FORCE)
FetchContent_MakeAvailable(Crow)

# ── Find system threading ─────────────────────────────────────────────────
find_package(Threads REQUIRED)

# ── Optional: Redis via hiredis ────────────────────────────────────────────
option(ENABLE_REDIS "Enable Redis persistence via hiredis" OFF)
if(ENABLE_REDIS)
    find_library(HIREDIS_LIB hiredis)
    find_path(HIREDIS_INCLUDE hiredis/hiredis.h)
    if(HIREDIS_LIB AND HIREDIS_INCLUDE)
        message(STATUS "Redis support enabled (hiredis found)")
    else()
        message(WARNING "hiredis not found – Redis support disabled")
        set(ENABLE_REDIS OFF)
    endif()
endif()

# ── Main executable ──────────────────────────────────────────────────────
add_executable(money_muling_detector src/main.cpp)

target_include_directories(money_muling_detector PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(money_muling_detector PRIVATE
    Crow::Crow
    nlohmann_json::nlohmann_json
    Threads::Threads
)

if(ENABLE_REDIS)
    target_compile_definitions(money_muling_detector PRIVATE ENABLE_REDIS)
    target_include_directories(money_muling_detector PRIVATE ${HIREDIS_INCLUDE})
    target_link_libraries(money_muling_detector PRIVATE ${HIREDIS_LIB})
endif()

# ── Install ──────────────────────────────────────────────────────────────
install(TARGETS money_muling_detector RUNTIME DESTINATION bin)

message(STATUS "")
message(STATUS "=== Money Muling Detector C++ Backend ===")
message(STATUS "  Build type:     ${CMAKE_BUILD_TYPE}")
message(STATUS "  C++ standard:   ${CMAKE_CXX_STANDARD}")
message(STATUS "  Redis support:  ${ENABLE_REDIS}")
message(STATUS "=========================================")
