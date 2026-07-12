/*
 * Shared-memory frame ring for the frame-copy embedded MPV helper.
 *
 * Same triple-buffer seqlock protocol as spikes/mpv-frame-copy (validated
 * there on M1 Pro up to 4K60), plus a `generation` field: every viewport
 * resize creates a fresh shm segment named `<base>-g<generation>` and the
 * reader re-attaches when the helper announces the new generation.
 *
 * Must compile as C11 (reader addon) and C++17 (helper) on POSIX; on
 * Windows both consumers build as C++ (MSVC's C mode lacks <stdatomic.h>).
 * POSIX builds use node-gyp's GNU dialects; frame_shm_now_ns() relies on
 * clock_gettime there, which strict -std=c11 (__STRICT_ANSI__) would hide.
 */
#pragma once

#include <stdint.h>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <stdio.h>
#include <string.h>
#else
#include <time.h>
#endif

#ifdef __cplusplus
#include <atomic>
typedef std::atomic<uint64_t> frame_shm_atomic_u64;
#else
#include <stdatomic.h>
typedef _Atomic uint64_t frame_shm_atomic_u64;
#endif

/* Monotonic clock for produce_time_ns/heartbeat_ns. Producer (helper) and
 * consumer (reader addon) MUST use this same clock so age math stays valid.
 * POSIX: CLOCK_MONOTONIC (macOS 10.12+, Linux). Windows: QPC, scaled to ns
 * without overflow by splitting whole seconds from the remainder. */
static inline uint64_t frame_shm_now_ns(void) {
#if defined(_WIN32)
    /* QPF is fixed after boot, so the benign init race writes one value. */
    static uint64_t frequency;
    LARGE_INTEGER counter;
    if (frequency == 0) {
        LARGE_INTEGER f;
        QueryPerformanceFrequency(&f);
        frequency = (uint64_t)f.QuadPart;
    }
    QueryPerformanceCounter(&counter);
    const uint64_t ticks = (uint64_t)counter.QuadPart;
    return (ticks / frequency) * 1000000000ull +
           (ticks % frequency) * 1000000000ull / frequency;
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
#endif
}

#if defined(_WIN32)
/* The stdio protocol carries POSIX-style names ("/impv-...-gN") on every
 * platform so the TypeScript layer stays platform-agnostic; on Windows the
 * helper (create) and reader (open) both derive the actual file-mapping
 * object name from it: session-local namespace, slashes stripped. */
static inline void frame_shm_windows_name(const char* posix_name, char* out,
                                          size_t out_size) {
    while (*posix_name == '/') posix_name++;
    snprintf(out, out_size, "Local\\%s", posix_name);
}
#endif

#define FRAME_SHM_MAGIC 0x564d5046u /* 'FPMV' */
#define FRAME_SHM_VERSION 1u
#define FRAME_SHM_RING_SLOTS 3u
#define FRAME_SHM_DATA_ALIGN 4096u

typedef struct {
    frame_shm_atomic_u64 seq; /* 0 while the slot is being (re)written */
    uint64_t produce_time_ns; /* frame_shm_now_ns() after copy completes */
} FrameShmSlot;

typedef struct {
    uint32_t magic; /* written last during init; readers gate on it */
    uint32_t version;
    uint32_t width;
    uint32_t height;
    uint32_t stride; /* bytes per row, tightly packed BGRA */
    uint32_t generation;
    uint64_t frame_bytes;
    uint64_t data_offset;
    frame_shm_atomic_u64 latest_seq; /* newest complete frame, 0 = none */
    frame_shm_atomic_u64 heartbeat_ns;
    FrameShmSlot slots[FRAME_SHM_RING_SLOTS];
} FrameShmHeader;
