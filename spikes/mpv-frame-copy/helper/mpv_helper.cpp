/*
 * mpv frame-copy spike — helper process (macOS).
 *
 * Owns libmpv in a standalone process: decodes + renders offscreen into a GL
 * FBO (headless CGL context, no window), reads frames back through a 3-deep
 * async PBO ring, and publishes BGRA frames into a POSIX shared-memory ring
 * (see common/spike_shm.h). Audio plays directly from this process.
 *
 * Prints one stats line per second: render ms, PBO map+copy ms (avg/p95),
 * effective fps. These are the producer-side numbers for the go/no-go gates.
 */
#define GL_SILENCE_DEPRECATION
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>

#include <mpv/client.h>
#include <mpv/render_gl.h>

#include <dlfcn.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <clocale>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "spike_shm.h"

namespace {

struct Args {
    std::string media;
    std::string shmName = SPIKE_SHM_DEFAULT_NAME;
    std::string hwdec = "auto";
    int width = 1920;
    int height = 1080;
    bool audio = true;
    bool loop = false;
};

uint64_t nowNs() { return clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW); }

[[noreturn]] void usage() {
    std::fprintf(stderr,
                 "usage: mpv_helper <media> [--size WxH] [--shm /name] "
                 "[--hwdec <mode>] [--no-audio] [--loop]\n");
    std::exit(2);
}

Args parseArgs(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        auto next = [&]() -> std::string {
            if (i + 1 >= argc) usage();
            return argv[++i];
        };
        if (a == "--size") {
            const std::string v = next();
            if (std::sscanf(v.c_str(), "%dx%d", &args.width, &args.height) != 2)
                usage();
        } else if (a == "--shm") {
            args.shmName = next();
        } else if (a == "--hwdec") {
            args.hwdec = next();
        } else if (a == "--no-audio") {
            args.audio = false;
        } else if (a == "--loop") {
            args.loop = true;
        } else if (!a.empty() && a[0] == '-') {
            usage();
        } else if (args.media.empty()) {
            args.media = a;
        } else {
            usage();
        }
    }
    if (args.media.empty() || args.width < 16 || args.height < 16) usage();
    return args;
}

/* ---- shared memory ----------------------------------------------------- */

struct Shm {
    SpikeShmHeader* hdr = nullptr;
    uint8_t* base = nullptr;
    size_t size = 0;
    std::string name;

    uint8_t* slotData(uint64_t seq) const {
        return base + hdr->data_offset +
               (seq % SPIKE_RING_SLOTS) * hdr->frame_bytes;
    }
};

bool shmCreate(Shm& shm, const std::string& name, int width, int height) {
    shm_unlink(name.c_str()); /* remove a stale ring from a previous run */
    const int fd = shm_open(name.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
    if (fd < 0) {
        std::perror("shm_open");
        return false;
    }
    const uint64_t frameBytes = (uint64_t)width * 4u * (uint64_t)height;
    const uint64_t dataOffset =
        (sizeof(SpikeShmHeader) + SPIKE_DATA_ALIGN - 1) & ~(uint64_t)(SPIKE_DATA_ALIGN - 1);
    const size_t total = (size_t)(dataOffset + SPIKE_RING_SLOTS * frameBytes);
    if (ftruncate(fd, (off_t)total) != 0) {
        std::perror("ftruncate");
        close(fd);
        return false;
    }
    void* base = mmap(nullptr, total, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (base == MAP_FAILED) {
        std::perror("mmap");
        return false;
    }
    std::memset(base, 0, sizeof(SpikeShmHeader));
    auto* hdr = static_cast<SpikeShmHeader*>(base);
    hdr->version = SPIKE_SHM_VERSION;
    hdr->width = (uint32_t)width;
    hdr->height = (uint32_t)height;
    hdr->stride = (uint32_t)width * 4u;
    hdr->frame_bytes = frameBytes;
    hdr->data_offset = dataOffset;
    std::atomic_thread_fence(std::memory_order_release);
    hdr->magic = SPIKE_SHM_MAGIC; /* readers treat magic as the ready flag */

    shm.hdr = hdr;
    shm.base = static_cast<uint8_t*>(base);
    shm.size = total;
    shm.name = name;
    return true;
}

/* ---- stats -------------------------------------------------------------- */

struct PhaseStats {
    std::vector<double> samples;
    void add(double ms) { samples.push_back(ms); }
    double avg() const {
        if (samples.empty()) return 0;
        double s = 0;
        for (double v : samples) s += v;
        return s / (double)samples.size();
    }
    double p95() {
        if (samples.empty()) return 0;
        std::sort(samples.begin(), samples.end());
        return samples[(size_t)((double)(samples.size() - 1) * 0.95)];
    }
    void reset() { samples.clear(); }
};

/* ---- render loop -------------------------------------------------------- */

void* g_glDylib = nullptr;

void* getProcAddress(void*, const char* name) {
    return dlsym(g_glDylib, name);
}

struct RenderShared {
    mpv_handle* mpv = nullptr;
    Shm* shm = nullptr;
    int width = 0;
    int height = 0;
    CGLContextObj cgl = nullptr;

    std::mutex mutex;
    std::condition_variable cv;
    bool updatePending = false;
    bool stop = false;
    bool ready = false;
    bool failed = false;
};

void onMpvRenderUpdate(void* ctx) {
    auto* shared = static_cast<RenderShared*>(ctx);
    {
        std::lock_guard<std::mutex> lock(shared->mutex);
        shared->updatePending = true;
    }
    shared->cv.notify_all();
}

void renderThreadMain(RenderShared* shared) {
    CGLSetCurrentContext(shared->cgl);

    const int w = shared->width;
    const int h = shared->height;
    const GLsizeiptr frameBytes = (GLsizeiptr)w * 4 * h;

    GLuint texture = 0, fbo = 0;
    glGenTextures(1, &texture);
    glBindTexture(GL_TEXTURE_2D, texture);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                           texture, 0);

    GLuint pbos[SPIKE_RING_SLOTS] = {0};
    glGenBuffers(SPIKE_RING_SLOTS, pbos);
    for (GLuint pbo : pbos) {
        glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo);
        glBufferData(GL_PIXEL_PACK_BUFFER, frameBytes, nullptr, GL_STREAM_READ);
    }
    glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);

    const bool fboOk =
        glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;

    mpv_opengl_init_params glInit = {getProcAddress, nullptr};
    mpv_render_param createParams[] = {
        {MPV_RENDER_PARAM_API_TYPE,
         const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    mpv_render_context* rc = nullptr;
    const int createResult =
        fboOk ? mpv_render_context_create(&rc, shared->mpv, createParams) : -1;

    {
        std::lock_guard<std::mutex> lock(shared->mutex);
        shared->ready = true;
        shared->failed = createResult < 0;
    }
    shared->cv.notify_all();
    if (createResult < 0) {
        std::fprintf(stderr, "[helper] render context init failed (%s)\n",
                     fboOk ? mpv_error_string(createResult) : "FBO incomplete");
        return;
    }
    std::fprintf(stderr, "[helper] GL renderer: %s\n",
                 (const char*)glGetString(GL_RENDERER));
    mpv_render_context_set_update_callback(rc, onMpvRenderUpdate, shared);

    SpikeShmHeader* hdr = shared->shm->hdr;
    uint64_t nextSeq = 1;
    int pendingPbo = -1;      /* PBO with an in-flight readback from last frame */
    uint64_t pendingPtsUs = SPIKE_PTS_UNKNOWN;
    int cursor = 0;

    PhaseStats renderStats, copyStats;
    uint64_t framesThisSecond = 0;
    uint64_t statsWindowStart = nowNs();

    auto publishPending = [&]() {
        if (pendingPbo < 0) return;
        const uint64_t t0 = nowNs();
        glBindBuffer(GL_PIXEL_PACK_BUFFER, pbos[pendingPbo]);
        const void* mapped =
            glMapBufferRange(GL_PIXEL_PACK_BUFFER, 0, frameBytes, GL_MAP_READ_BIT);
        if (mapped) {
            const uint64_t seq = nextSeq++;
            SpikeSlot& slot = hdr->slots[seq % SPIKE_RING_SLOTS];
            slot.seq.store(0, std::memory_order_release);
            std::memcpy(shared->shm->slotData(seq), mapped,
                        (size_t)frameBytes);
            slot.pts_us = pendingPtsUs;
            slot.produce_time_ns = nowNs();
            slot.seq.store(seq, std::memory_order_release);
            hdr->latest_seq.store(seq, std::memory_order_release);
            glUnmapBuffer(GL_PIXEL_PACK_BUFFER);
            copyStats.add((double)(nowNs() - t0) / 1e6);
            framesThisSecond++;
        }
        glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
        pendingPbo = -1;
    };

    while (true) {
        {
            std::unique_lock<std::mutex> lock(shared->mutex);
            shared->cv.wait_for(lock, std::chrono::milliseconds(100), [&] {
                return shared->updatePending || shared->stop;
            });
            if (shared->stop) break;
            shared->updatePending = false;
        }

        const uint64_t flags = mpv_render_context_update(rc);
        if (flags & MPV_RENDER_UPDATE_FRAME) {
            const uint64_t t0 = nowNs();
            mpv_opengl_fbo mpvFbo = {(int)fbo, w, h, 0};
            int flipY = 1; /* top-down rows so the consumer can upload as-is */
            mpv_render_param renderParams[] = {
                {MPV_RENDER_PARAM_OPENGL_FBO, &mpvFbo},
                {MPV_RENDER_PARAM_FLIP_Y, &flipY},
                {MPV_RENDER_PARAM_INVALID, nullptr},
            };
            mpv_render_context_render(rc, renderParams);
            renderStats.add((double)(nowNs() - t0) / 1e6);

            /* Kick off the async readback for this frame ... */
            double pts = 0;
            pendingPtsUs =
                mpv_get_property(shared->mpv, "time-pos", MPV_FORMAT_DOUBLE,
                                 &pts) >= 0
                    ? (uint64_t)(pts * 1e6)
                    : SPIKE_PTS_UNKNOWN;
            glBindFramebuffer(GL_READ_FRAMEBUFFER, fbo);
            glReadBuffer(GL_COLOR_ATTACHMENT0);
            glPixelStorei(GL_PACK_ALIGNMENT, 1);
            glPixelStorei(GL_PACK_ROW_LENGTH, 0);
            /* Publish the previous frame first so this readback stays async. */
            publishPending();
            glBindBuffer(GL_PIXEL_PACK_BUFFER, pbos[cursor]);
            glReadPixels(0, 0, w, h, GL_BGRA, GL_UNSIGNED_INT_8_8_8_8_REV,
                         nullptr);
            glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
            pendingPbo = cursor;
            cursor = (cursor + 1) % SPIKE_RING_SLOTS;
            mpv_render_context_report_swap(rc);
        } else {
            /* No new video frame; still flush a leftover readback so pause
             * doesn't strand the last frame inside a PBO. */
            publishPending();
        }

        const uint64_t now = nowNs();
        hdr->heartbeat_ns.store(now, std::memory_order_relaxed);
        if (now - statsWindowStart >= 1000000000ull) {
            const double seconds = (double)(now - statsWindowStart) / 1e9;
            const double fps = (double)framesThisSecond / seconds;
            hdr->producer_fps_milli.store((uint64_t)(fps * 1000.0),
                                          std::memory_order_relaxed);
            std::fprintf(stderr,
                         "[helper] fps=%5.1f | render ms avg=%5.2f p95=%5.2f | "
                         "map+copy ms avg=%5.2f p95=%5.2f\n",
                         fps, renderStats.avg(), renderStats.p95(),
                         copyStats.avg(), copyStats.p95());
            renderStats.reset();
            copyStats.reset();
            framesThisSecond = 0;
            statsWindowStart = now;
        }
    }

    mpv_render_context_set_update_callback(rc, nullptr, nullptr);
    mpv_render_context_free(rc);
    glDeleteBuffers(SPIKE_RING_SLOTS, pbos);
    glDeleteFramebuffers(1, &fbo);
    glDeleteTextures(1, &texture);
    CGLSetCurrentContext(nullptr);
}

/* ---- main / mpv event loop ---------------------------------------------- */

std::atomic<bool> g_quit{false};
void onSignal(int) { g_quit.store(true); }

} // namespace

int main(int argc, char** argv) {
    std::setlocale(LC_NUMERIC, "C");
    const Args args = parseArgs(argc, argv);

    g_glDylib = dlopen(
        "/System/Library/Frameworks/OpenGL.framework/Versions/Current/OpenGL",
        RTLD_LAZY | RTLD_LOCAL);
    if (!g_glDylib) {
        std::fprintf(stderr, "[helper] failed to dlopen OpenGL framework\n");
        return 1;
    }

    Shm shm;
    if (!shmCreate(shm, args.shmName, args.width, args.height)) return 1;

    CGLPixelFormatAttribute pfAttrs[] = {
        kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
        kCGLPFAAccelerated,
        kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
        kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
        (CGLPixelFormatAttribute)0,
    };
    CGLPixelFormatObj pixelFormat = nullptr;
    GLint pixelFormatCount = 0;
    CGLContextObj cgl = nullptr;
    if (CGLChoosePixelFormat(pfAttrs, &pixelFormat, &pixelFormatCount) !=
            kCGLNoError ||
        !pixelFormat ||
        CGLCreateContext(pixelFormat, nullptr, &cgl) != kCGLNoError) {
        std::fprintf(stderr, "[helper] failed to create headless CGL context\n");
        return 1;
    }
    CGLDestroyPixelFormat(pixelFormat);

    mpv_handle* mpv = mpv_create();
    if (!mpv) {
        std::fprintf(stderr, "[helper] mpv_create failed\n");
        return 1;
    }
    mpv_set_option_string(mpv, "vo", "libmpv");
    mpv_set_option_string(mpv, "hwdec", args.hwdec.c_str());
    mpv_set_option_string(mpv, "keep-open", "yes");
    if (!args.audio) mpv_set_option_string(mpv, "aid", "no");
    if (args.loop) mpv_set_option_string(mpv, "loop-file", "inf");
    if (mpv_initialize(mpv) < 0) {
        std::fprintf(stderr, "[helper] mpv_initialize failed\n");
        return 1;
    }
    mpv_request_log_messages(mpv, "warn");

    std::fprintf(stderr,
                 "[helper] media=%s size=%dx%d shm=%s hwdec=%s audio=%s\n",
                 args.media.c_str(), args.width, args.height,
                 args.shmName.c_str(), args.hwdec.c_str(),
                 args.audio ? "on" : "off");

    RenderShared shared;
    shared.mpv = mpv;
    shared.shm = &shm;
    shared.width = args.width;
    shared.height = args.height;
    shared.cgl = cgl;

    std::thread renderThread(renderThreadMain, &shared);
    {
        std::unique_lock<std::mutex> lock(shared.mutex);
        shared.cv.wait(lock, [&] { return shared.ready; });
        if (shared.failed) {
            lock.unlock();
            renderThread.join();
            mpv_terminate_destroy(mpv);
            return 1;
        }
    }

    signal(SIGINT, onSignal);
    signal(SIGTERM, onSignal);

    const char* loadCmd[] = {"loadfile", args.media.c_str(), nullptr};
    mpv_command(mpv, loadCmd);

    while (!g_quit.load()) {
        mpv_event* event = mpv_wait_event(mpv, 0.25);
        if (event->event_id == MPV_EVENT_NONE) continue;
        if (event->event_id == MPV_EVENT_SHUTDOWN) break;
        if (event->event_id == MPV_EVENT_LOG_MESSAGE) {
            auto* msg = static_cast<mpv_event_log_message*>(event->data);
            std::fprintf(stderr, "[mpv/%s] %s", msg->prefix, msg->text);
        } else if (event->event_id == MPV_EVENT_END_FILE) {
            auto* end = static_cast<mpv_event_end_file*>(event->data);
            std::fprintf(stderr, "[helper] end-file reason=%d error=%s\n",
                         end->reason,
                         end->error < 0 ? mpv_error_string(end->error) : "none");
        }
    }

    {
        std::lock_guard<std::mutex> lock(shared.mutex);
        shared.stop = true;
    }
    shared.cv.notify_all();
    renderThread.join();
    mpv_terminate_destroy(mpv);
    CGLDestroyContext(cgl);
    munmap(shm.base, shm.size);
    shm_unlink(shm.name.c_str());
    std::fprintf(stderr, "[helper] clean exit\n");
    return 0;
}
