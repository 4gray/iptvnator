/*
 * Shared-memory frame ring protocol for the mpv frame-copy spike.
 *
 * Producer: helper/mpv_helper.cpp (C++) — renders mpv offscreen, writes
 * BGRA frames into a 3-slot ring inside POSIX shared memory.
 * Consumer: viewer/addon/shm_reader.c (C, N-API) — copies the newest
 * complete frame out for WebGL upload in an Electron renderer.
 *
 * This header must compile both as C11 and C++17; the atomic fields rely on
 * _Atomic uint64_t and std::atomic<uint64_t> having identical size/layout
 * (both are 8-byte lock-free on the targets this spike cares about).
 *
 * Slot protocol (classic triple buffer with per-slot seqlock):
 *   writer: slot.seq = 0  ->  memcpy frame + fill meta  ->  slot.seq = seq
 *           -> header.latest_seq = seq        (all stores release)
 *   reader: seq = header.latest_seq (acquire); slot = slots[seq % SLOTS];
 *           verify slot.seq == seq, copy, re-check slot.seq for tearing.
 * The writer always writes slot (seq % SLOTS) with a monotonically growing
 * seq, so the newest complete slot is never the one being overwritten next.
 */
#pragma once

#include <stdint.h>

#ifdef __cplusplus
#include <atomic>
typedef std::atomic<uint64_t> spike_atomic_u64;
#else
#include <stdatomic.h>
typedef _Atomic uint64_t spike_atomic_u64;
#endif

#define SPIKE_SHM_DEFAULT_NAME "/mpv-frame-spike"
#define SPIKE_SHM_MAGIC 0x564d5053u /* 'SPMV' little-endian */
#define SPIKE_SHM_VERSION 1u
#define SPIKE_RING_SLOTS 3u
#define SPIKE_DATA_ALIGN 4096u
#define SPIKE_PTS_UNKNOWN UINT64_MAX

typedef struct {
    spike_atomic_u64 seq;     /* 0 while the slot is being (re)written */
    uint64_t pts_us;          /* mpv time-pos in µs, SPIKE_PTS_UNKNOWN if n/a */
    uint64_t produce_time_ns; /* CLOCK_MONOTONIC_RAW, set after copy is done */
} SpikeSlot;

typedef struct {
    uint32_t magic;   /* written last during init (with release fence) */
    uint32_t version;
    uint32_t width;
    uint32_t height;
    uint32_t stride;  /* bytes per row, tightly packed: width * 4 */
    uint32_t reserved;
    uint64_t frame_bytes; /* stride * height */
    uint64_t data_offset; /* from mapping base, SPIKE_DATA_ALIGN aligned */
    spike_atomic_u64 latest_seq;        /* newest complete frame, 0 = none */
    spike_atomic_u64 producer_fps_milli; /* producer render fps * 1000 */
    spike_atomic_u64 heartbeat_ns;       /* producer liveness */
    SpikeSlot slots[SPIKE_RING_SLOTS];
} SpikeShmHeader;
