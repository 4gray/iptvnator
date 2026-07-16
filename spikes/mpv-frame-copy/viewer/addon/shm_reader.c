/*
 * mpv frame-copy spike — shared-memory reader addon (plain C N-API).
 *
 * Maps the ring created by helper/mpv_helper.cpp and copies the newest
 * complete frame into a caller-provided ArrayBuffer. A memcpy is mandatory:
 * Electron's V8 memory cage forbids external ArrayBuffers over foreign
 * memory (napi_create_external_arraybuffer aborts), so zero-copy into JS is
 * not possible — this copy is one of the 2-3 copies the architecture doc
 * budgets for.
 *
 * Built directly with clang (-undefined dynamic_lookup); N-API is ABI-stable
 * so the same .node loads in Node and Electron.
 */
#define NAPI_VERSION 8
#include <node_api.h>

#include <fcntl.h>
#include <stdatomic.h>
#include <stdint.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "spike_shm.h"

static SpikeShmHeader* g_hdr = NULL;
static uint8_t* g_base = NULL;
static size_t g_size = 0;

static uint64_t now_ns(void) {
    return clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW);
}

static napi_value throw_error(napi_env env, const char* msg) {
    napi_throw_error(env, NULL, msg);
    return NULL;
}

static void set_named_double(napi_env env, napi_value obj, const char* key,
                             double value) {
    napi_value v;
    napi_create_double(env, value, &v);
    napi_set_named_property(env, obj, key, v);
}

/* open(name) -> { width, height, stride, frameBytes } */
static napi_value Open(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc < 1) return throw_error(env, "open(name) requires a shm name");

    char name[256];
    size_t len = 0;
    if (napi_get_value_string_utf8(env, argv[0], name, sizeof(name), &len) !=
        napi_ok)
        return throw_error(env, "shm name must be a string");

    if (g_base) {
        munmap(g_base, g_size);
        g_base = NULL;
        g_hdr = NULL;
    }

    const int fd = shm_open(name, O_RDONLY, 0);
    if (fd < 0) return throw_error(env, "shm_open failed (helper not running?)");
    struct stat st;
    if (fstat(fd, &st) != 0 || st.st_size < (off_t)sizeof(SpikeShmHeader)) {
        close(fd);
        return throw_error(env, "shm segment too small");
    }
    void* base = mmap(NULL, (size_t)st.st_size, PROT_READ, MAP_SHARED, fd, 0);
    close(fd);
    if (base == MAP_FAILED) return throw_error(env, "mmap failed");

    SpikeShmHeader* hdr = (SpikeShmHeader*)base;
    if (hdr->magic != SPIKE_SHM_MAGIC || hdr->version != SPIKE_SHM_VERSION) {
        munmap(base, (size_t)st.st_size);
        return throw_error(env, "shm ring not initialized yet");
    }

    g_base = (uint8_t*)base;
    g_size = (size_t)st.st_size;
    g_hdr = hdr;

    napi_value result;
    napi_create_object(env, &result);
    set_named_double(env, result, "width", hdr->width);
    set_named_double(env, result, "height", hdr->height);
    set_named_double(env, result, "stride", hdr->stride);
    set_named_double(env, result, "frameBytes", (double)hdr->frame_bytes);
    return result;
}

/* latestSeq() -> number (0 = no frame yet) */
static napi_value LatestSeq(napi_env env, napi_callback_info info) {
    napi_value out;
    const uint64_t seq =
        g_hdr ? atomic_load_explicit(&g_hdr->latest_seq, memory_order_acquire)
              : 0;
    napi_create_double(env, (double)seq, &out);
    return out;
}

/* copyLatest(arrayBuffer) -> { seq, ptsSec, ageMs, copyMs, torn } | null */
static napi_value CopyLatest(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (!g_hdr) return throw_error(env, "call open() first");
    if (argc < 1) return throw_error(env, "copyLatest(buffer) needs a buffer");

    void* dst = NULL;
    size_t dstLen = 0;
    if (napi_get_arraybuffer_info(env, argv[0], &dst, &dstLen) != napi_ok)
        return throw_error(env, "argument must be an ArrayBuffer");
    if (dstLen < g_hdr->frame_bytes)
        return throw_error(env, "buffer smaller than one frame");

    napi_value null_value;
    napi_get_null(env, &null_value);

    const uint64_t seq =
        atomic_load_explicit(&g_hdr->latest_seq, memory_order_acquire);
    if (seq == 0) return null_value;

    SpikeSlot* slot = &g_hdr->slots[seq % SPIKE_RING_SLOTS];
    if (atomic_load_explicit(&slot->seq, memory_order_acquire) != seq)
        return null_value; /* writer racing this slot; try next tick */

    const uint8_t* src =
        g_base + g_hdr->data_offset + (seq % SPIKE_RING_SLOTS) * g_hdr->frame_bytes;
    const uint64_t t0 = now_ns();
    memcpy(dst, src, (size_t)g_hdr->frame_bytes);
    const uint64_t t1 = now_ns();

    const int torn =
        atomic_load_explicit(&slot->seq, memory_order_acquire) != seq;
    const uint64_t pts_us = slot->pts_us;
    const double age_ms = (double)(t1 - slot->produce_time_ns) / 1e6;

    napi_value result;
    napi_create_object(env, &result);
    set_named_double(env, result, "seq", (double)seq);
    set_named_double(env, result, "ptsSec",
                     pts_us == SPIKE_PTS_UNKNOWN ? -1.0 : (double)pts_us / 1e6);
    set_named_double(env, result, "ageMs", age_ms);
    set_named_double(env, result, "copyMs", (double)(t1 - t0) / 1e6);
    /* producer timestamp on the shared monotonic clock, for pacing stats */
    set_named_double(env, result, "produceMs",
                     (double)slot->produce_time_ns / 1e6);
    napi_value torn_value;
    napi_get_boolean(env, torn, &torn_value);
    napi_set_named_property(env, result, "torn", torn_value);
    return result;
}

/* producerFps() -> number */
static napi_value ProducerFps(napi_env env, napi_callback_info info) {
    napi_value out;
    const double fps =
        g_hdr ? (double)atomic_load_explicit(&g_hdr->producer_fps_milli,
                                             memory_order_relaxed) /
                    1000.0
              : 0;
    napi_create_double(env, fps, &out);
    return out;
}

/* producerAliveMs() -> ms since last producer heartbeat (-1 if unknown) */
static napi_value ProducerAliveMs(napi_env env, napi_callback_info info) {
    napi_value out;
    double ms = -1;
    if (g_hdr) {
        const uint64_t hb =
            atomic_load_explicit(&g_hdr->heartbeat_ns, memory_order_relaxed);
        if (hb) ms = (double)(now_ns() - hb) / 1e6;
    }
    napi_create_double(env, ms, &out);
    return out;
}

/* nowMs() -> CLOCK_MONOTONIC_RAW in ms (same clock as helper timestamps) */
static napi_value NowMs(napi_env env, napi_callback_info info) {
    napi_value out;
    napi_create_double(env, (double)now_ns() / 1e6, &out);
    return out;
}

static napi_value Init(napi_env env, napi_value exports) {
    const struct {
        const char* name;
        napi_callback fn;
    } fns[] = {
        {"open", Open},           {"latestSeq", LatestSeq},
        {"copyLatest", CopyLatest}, {"producerFps", ProducerFps},
        {"producerAliveMs", ProducerAliveMs}, {"nowMs", NowMs},
    };
    for (size_t i = 0; i < sizeof(fns) / sizeof(fns[0]); i++) {
        napi_value fn;
        napi_create_function(env, fns[i].name, NAPI_AUTO_LENGTH, fns[i].fn,
                             NULL, &fn);
        napi_set_named_property(env, exports, fns[i].name, fn);
    }
    return exports;
}

NAPI_MODULE(shm_reader, Init)
