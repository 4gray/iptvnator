/*
 * Shared-memory frame ring for the frame-copy embedded MPV helper.
 *
 * Same triple-buffer seqlock protocol as spikes/mpv-frame-copy (validated
 * there on M1 Pro up to 4K60), plus a `generation` field: every viewport
 * resize creates a fresh shm segment named `<base>-g<generation>` and the
 * reader re-attaches when the helper announces the new generation.
 *
 * Must compile as C11 (reader addon) and C++17 (helper). Both consumers
 * build with node-gyp's GNU dialects; frame_shm_now_ns() relies on POSIX
 * clock_gettime, which strict -std=c11 (__STRICT_ANSI__) would hide.
 */
#pragma once

#include <stdint.h>
#include <time.h>

#ifdef __cplusplus
#include <atomic>
typedef std::atomic<uint64_t> frame_shm_atomic_u64;
#else
#include <stdatomic.h>
typedef _Atomic uint64_t frame_shm_atomic_u64;
#endif

/* Monotonic clock for produce_time_ns/heartbeat_ns. Producer (helper) and
 * consumer (reader addon) MUST use this same clock so age math stays valid.
 * CLOCK_MONOTONIC is portable across macOS (10.12+) and Linux; the Windows
 * port will need a QueryPerformanceCounter shim here. */
static inline uint64_t frame_shm_now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

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
