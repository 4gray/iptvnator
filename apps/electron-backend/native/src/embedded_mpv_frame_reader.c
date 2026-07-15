/*
 * embedded_mpv_frame_reader — N-API reader for the frame-copy shm ring.
 *
 * Loaded by the Electron preload script; copies the newest complete BGRA
 * frame from the helper's shared-memory ring (native/helper/frame_shm.h)
 * into a caller-provided ArrayBuffer. A memcpy is mandatory: Electron's V8
 * memory cage forbids external ArrayBuffers over foreign memory.
 *
 * Plain C N-API (no node-addon-api) so it stays ABI-stable and trivial.
 * macOS-only for now — other platforms export an empty object; the
 * TypeScript side gates on platform before requiring it.
 */
#define NAPI_VERSION 8
#include <node_api.h>

#ifdef __APPLE__

#include <fcntl.h>
#include <stdatomic.h>
#include <stdint.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "../helper/frame_shm.h"

static FrameShmHeader* g_header = NULL;
static uint8_t* g_base = NULL;
static size_t g_size = 0;

static uint64_t now_ns(void) {
    return clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW);
}

static void unmap_current(void) {
    if (g_base) {
        munmap(g_base, g_size);
    }
    g_base = NULL;
    g_header = NULL;
    g_size = 0;
}

static napi_value throw_error(napi_env env, const char* message) {
    napi_throw_error(env, NULL, message);
    return NULL;
}

static void set_named_double(napi_env env, napi_value target, const char* key,
                             double value) {
    napi_value wrapped;
    napi_create_double(env, value, &wrapped);
    napi_set_named_property(env, target, key, wrapped);
}

/* open(name) -> { width, height, stride, frameBytes, generation } */
static napi_value Open(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (argc < 1) return throw_error(env, "open(name) requires the shm name");

    char name[256];
    size_t written = 0;
    if (napi_get_value_string_utf8(env, argv[0], name, sizeof(name),
                                   &written) != napi_ok) {
        return throw_error(env, "shm name must be a string");
    }

    const int fd = shm_open(name, O_RDONLY, 0);
    if (fd < 0) return throw_error(env, "shm_open failed (helper gone?)");
    struct stat segment;
    if (fstat(fd, &segment) != 0 ||
        segment.st_size < (off_t)sizeof(FrameShmHeader)) {
        close(fd);
        return throw_error(env, "shm segment too small");
    }
    void* mapped =
        mmap(NULL, (size_t)segment.st_size, PROT_READ, MAP_SHARED, fd, 0);
    close(fd);
    if (mapped == MAP_FAILED) return throw_error(env, "mmap failed");

    FrameShmHeader* header = (FrameShmHeader*)mapped;
    if (header->magic != FRAME_SHM_MAGIC ||
        header->version != FRAME_SHM_VERSION) {
        munmap(mapped, (size_t)segment.st_size);
        return throw_error(env, "frame ring not initialized yet");
    }

    unmap_current();
    g_base = (uint8_t*)mapped;
    g_size = (size_t)segment.st_size;
    g_header = header;

    napi_value result;
    napi_create_object(env, &result);
    set_named_double(env, result, "width", header->width);
    set_named_double(env, result, "height", header->height);
    set_named_double(env, result, "stride", header->stride);
    set_named_double(env, result, "frameBytes", (double)header->frame_bytes);
    set_named_double(env, result, "generation", header->generation);
    return result;
}

/* latestSeq() -> number (0 = no frame yet / not attached) */
static napi_value LatestSeq(napi_env env, napi_callback_info info) {
    napi_value result;
    const uint64_t seq =
        g_header
            ? atomic_load_explicit(&g_header->latest_seq, memory_order_acquire)
            : 0;
    napi_create_double(env, (double)seq, &result);
    return result;
}

/* copyLatest(arrayBuffer) -> { seq, ageMs, torn } | null */
static napi_value CopyLatest(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
    if (!g_header) return throw_error(env, "call open() first");
    if (argc < 1) return throw_error(env, "copyLatest(buffer) needs a buffer");

    void* destination = NULL;
    size_t destination_size = 0;
    if (napi_get_arraybuffer_info(env, argv[0], &destination,
                                  &destination_size) != napi_ok) {
        return throw_error(env, "argument must be an ArrayBuffer");
    }
    if (destination_size < g_header->frame_bytes) {
        return throw_error(env, "buffer smaller than one frame");
    }

    napi_value null_value;
    napi_get_null(env, &null_value);

    const uint64_t seq =
        atomic_load_explicit(&g_header->latest_seq, memory_order_acquire);
    if (seq == 0) return null_value;

    FrameShmSlot* slot = &g_header->slots[seq % FRAME_SHM_RING_SLOTS];
    if (atomic_load_explicit(&slot->seq, memory_order_acquire) != seq) {
        return null_value; /* writer is racing this slot; next tick wins */
    }

    const uint8_t* source = g_base + g_header->data_offset +
                            (seq % FRAME_SHM_RING_SLOTS) *
                                g_header->frame_bytes;
    memcpy(destination, source, (size_t)g_header->frame_bytes);
    const uint64_t copied_at = now_ns();
    const int torn =
        atomic_load_explicit(&slot->seq, memory_order_acquire) != seq;

    napi_value result;
    napi_create_object(env, &result);
    set_named_double(env, result, "seq", (double)seq);
    set_named_double(env, result, "ageMs",
                     (double)(copied_at - slot->produce_time_ns) / 1e6);
    napi_value torn_value;
    napi_get_boolean(env, torn, &torn_value);
    napi_set_named_property(env, result, "torn", torn_value);
    return result;
}

/* producerAliveMs() -> ms since the helper's last heartbeat (-1 unknown) */
static napi_value ProducerAliveMs(napi_env env, napi_callback_info info) {
    napi_value result;
    double ms = -1;
    if (g_header) {
        const uint64_t heartbeat =
            atomic_load_explicit(&g_header->heartbeat_ns, memory_order_relaxed);
        if (heartbeat) ms = (double)(now_ns() - heartbeat) / 1e6;
    }
    napi_create_double(env, ms, &result);
    return result;
}

/* close() -> undefined */
static napi_value Close(napi_env env, napi_callback_info info) {
    unmap_current();
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

static napi_value Init(napi_env env, napi_value exports) {
    const struct {
        const char* name;
        napi_callback fn;
    } exported[] = {
        {"open", Open},
        {"latestSeq", LatestSeq},
        {"copyLatest", CopyLatest},
        {"producerAliveMs", ProducerAliveMs},
        {"close", Close},
    };
    for (size_t i = 0; i < sizeof(exported) / sizeof(exported[0]); i++) {
        napi_value fn;
        napi_create_function(env, exported[i].name, NAPI_AUTO_LENGTH,
                             exported[i].fn, NULL, &fn);
        napi_set_named_property(env, exports, exported[i].name, fn);
    }
    return exports;
}

#else /* !__APPLE__ */

static napi_value Init(napi_env env, napi_value exports) {
    /* Frame-copy is macOS-only for now; loading this module elsewhere
     * yields an empty exports object and the TS side treats it as
     * unsupported. */
    (void)env;
    return exports;
}

#endif

NAPI_MODULE(embedded_mpv_frame_reader, Init)
