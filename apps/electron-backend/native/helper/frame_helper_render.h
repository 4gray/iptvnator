/*
 * Offscreen render + readback pipeline for the frame-copy helper.
 *
 * Headless GL context (per-platform, see frame_helper_gl.h), mpv render API
 * into an FBO sized to the viewport, async PBO readback ring, BGRA frames
 * published into the FrameShm ring. Validated in spikes/mpv-frame-copy
 * (4K60 sustained on M1 Pro).
 *
 * Threading: everything here runs on the render thread except
 * requestResize()/stop(), which only touch atomics/mutex-guarded state.
 */
#pragma once

#include <mpv/client.h>
#include <mpv/render_gl.h>

#if !defined(_WIN32)
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#endif

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <functional>
#include <mutex>
#include <string>

#include "frame_helper_gl.h"
#include "frame_helper_io.h"
#include "frame_shm.h"

namespace frame_helper {

inline uint64_t nowNs() { return frame_shm_now_ns(); }

struct ShmRing {
    FrameShmHeader* header = nullptr;
    uint8_t* base = nullptr;
    size_t size = 0;
    std::string name;
#if defined(_WIN32)
    /* Named sections are refcounted: this handle keeps the mapping alive
     * for the helper's lifetime; readers holding views keep the memory
     * valid after the helper exits, matching unlinked-POSIX-shm semantics. */
    HANDLE mapping = nullptr;
#endif

    bool create(const std::string& shmName, int width, int height,
                uint32_t generation) {
        destroy();
        const uint64_t frameBytes = (uint64_t)width * 4u * (uint64_t)height;
        const uint64_t dataOffset =
            (sizeof(FrameShmHeader) + FRAME_SHM_DATA_ALIGN - 1) &
            ~(uint64_t)(FRAME_SHM_DATA_ALIGN - 1);
        const size_t total =
            (size_t)(dataOffset + FRAME_SHM_RING_SLOTS * frameBytes);
#if defined(_WIN32)
        char mappingName[256];
        frame_shm_windows_name(shmName.c_str(), mappingName,
                               sizeof(mappingName));
        HANDLE created = CreateFileMappingA(
            INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
            (DWORD)(total >> 32), (DWORD)(total & 0xffffffffu), mappingName);
        if (!created) return false;
        if (GetLastError() == ERROR_ALREADY_EXISTS) {
            /* Never adopt an existing section: its layout is unknown. The
             * per-session UUID + generation suffix make collisions mean a
             * bug, not a retry. */
            CloseHandle(created);
            return false;
        }
        void* mapped = MapViewOfFile(created, FILE_MAP_ALL_ACCESS, 0, 0, 0);
        if (!mapped) {
            CloseHandle(created);
            return false;
        }
        mapping = created;
#else
        shm_unlink(shmName.c_str());
        const int fd = shm_open(shmName.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
        if (fd < 0) return false;
        if (ftruncate(fd, (off_t)total) != 0) {
            close(fd);
            shm_unlink(shmName.c_str());
            return false;
        }
        void* mapped =
            mmap(nullptr, total, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        close(fd);
        if (mapped == MAP_FAILED) {
            shm_unlink(shmName.c_str());
            return false;
        }
#endif
        std::memset(mapped, 0, sizeof(FrameShmHeader));
        auto* hdr = static_cast<FrameShmHeader*>(mapped);
        hdr->version = FRAME_SHM_VERSION;
        hdr->width = (uint32_t)width;
        hdr->height = (uint32_t)height;
        hdr->stride = (uint32_t)width * 4u;
        hdr->generation = generation;
        hdr->frame_bytes = frameBytes;
        hdr->data_offset = dataOffset;
        std::atomic_thread_fence(std::memory_order_release);
        hdr->magic = FRAME_SHM_MAGIC;

        header = hdr;
        base = static_cast<uint8_t*>(mapped);
        size = total;
        name = shmName;
        return true;
    }

    uint8_t* slotData(uint64_t seq) const {
        return base + header->data_offset +
               (seq % FRAME_SHM_RING_SLOTS) * header->frame_bytes;
    }

    void destroy() {
#if defined(_WIN32)
        if (base) UnmapViewOfFile(base);
        if (mapping) CloseHandle(mapping);
        mapping = nullptr;
#else
        if (base) {
            munmap(base, size);
            shm_unlink(name.c_str());
        }
#endif
        header = nullptr;
        base = nullptr;
        size = 0;
        name.clear();
    }
};

class RenderPipeline {
public:
    /* Called from the render thread after a resize created a new shm
     * generation, so the main protocol layer can announce it. */
    std::function<void(const std::string& name, int width, int height,
                       uint32_t generation)>
        onGenerationChanged;

    bool start(mpv_handle* mpv, const std::string& shmBaseName, int width,
               int height, std::string& errorOut);
    void requestResize(int width, int height);
    void stop();
    void notifyUpdate(); /* mpv render update callback -> wake render loop */
    void runLoop();      /* render thread body */

    mpv_render_context* renderContext() { return renderContext_; }
    /* 0 = initializing, 1 = ready, -1 = failed */
    int initState() const { return initState_.load(); }

private:
    bool setupGl(std::string& errorOut);
    bool rebuildTargets(int width, int height);
    void publishPending();
    void renderFrame();

    mpv_handle* mpv_ = nullptr;
    GlContext gl_;
    mpv_render_context* renderContext_ = nullptr;

    std::string shmBaseName_;
    ShmRing ring_;
    uint32_t generation_ = 0;

    int width_ = 0;
    int height_ = 0;
    GLuint texture_ = 0;
    GLuint fbo_ = 0;
    GLuint pbos_[FRAME_SHM_RING_SLOTS] = {0};
    int cursor_ = 0;
    int pendingPbo_ = -1;
    uint64_t nextSeq_ = 1;

    std::mutex mutex_;
    std::condition_variable cv_;
    bool updatePending_ = false;
    bool stopRequested_ = false;
    int pendingWidth_ = 0;
    int pendingHeight_ = 0;
    std::atomic<int> initState_{0};
};

inline bool RenderPipeline::start(mpv_handle* mpv,
                                  const std::string& shmBaseName, int width,
                                  int height, std::string& errorOut) {
    mpv_ = mpv;
    shmBaseName_ = shmBaseName;
    width_ = width;
    height_ = height;
    return gl_.create(errorOut);
}

inline bool RenderPipeline::setupGl(std::string& errorOut) {
    if (!gl_.makeCurrent(errorOut)) return false;

    /* Keep the accepted renderer diagnosable. Linux already rejected earlier
     * software tiers when a later hardware-backed EGL candidate was usable. */
    const GLubyte* renderer = glGetString(GL_RENDERER);
    if (renderer) {
        std::fprintf(stderr, "gl renderer: %s\n",
                     reinterpret_cast<const char*>(renderer));
    }

    if (!rebuildTargets(width_, height_)) {
        errorOut = "framebuffer setup failed";
        return false;
    }

    mpv_opengl_init_params glInit = {gl_.procLoader(), gl_.procLoaderCtx()};
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE,
         const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    const int result = mpv_render_context_create(&renderContext_, mpv_, params);
    if (result < 0) {
        errorOut = mpv_error_string(result);
        return false;
    }
    return true;
}

inline bool RenderPipeline::rebuildTargets(int width, int height) {
    if (texture_) glDeleteTextures(1, &texture_);
    if (fbo_) glDeleteFramebuffers(1, &fbo_);
    if (pbos_[0]) glDeleteBuffers(FRAME_SHM_RING_SLOTS, pbos_);
    pendingPbo_ = -1;
    cursor_ = 0;

    width_ = width;
    height_ = height;
    const GLsizeiptr frameBytes = (GLsizeiptr)width * 4 * height;

    glGenTextures(1, &texture_);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA,
                 GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glGenFramebuffers(1, &fbo_);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                           texture_, 0);
    glGenBuffers(FRAME_SHM_RING_SLOTS, pbos_);
    for (GLuint pbo : pbos_) {
        glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo);
        glBufferData(GL_PIXEL_PACK_BUFFER, frameBytes, nullptr, GL_STREAM_READ);
    }
    glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);

    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        return false;
    }

    generation_ += 1;
    const std::string shmName =
        shmBaseName_ + "-g" + std::to_string(generation_);
    if (!ring_.create(shmName, width, height, generation_)) {
        return false;
    }
    if (onGenerationChanged) {
        onGenerationChanged(shmName, width, height, generation_);
    }
    return true;
}

inline void RenderPipeline::notifyUpdate() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        updatePending_ = true;
    }
    cv_.notify_all();
}

inline void RenderPipeline::requestResize(int width, int height) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        pendingWidth_ = width;
        pendingHeight_ = height;
        updatePending_ = true;
    }
    cv_.notify_all();
}

inline void RenderPipeline::stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopRequested_ = true;
    }
    cv_.notify_all();
}

inline void RenderPipeline::publishPending() {
    if (pendingPbo_ < 0 || !ring_.header) return;
    glBindBuffer(GL_PIXEL_PACK_BUFFER, pbos_[pendingPbo_]);
    const void* mapped = glMapBufferRange(GL_PIXEL_PACK_BUFFER, 0,
                                          (GLsizeiptr)ring_.header->frame_bytes,
                                          GL_MAP_READ_BIT);
    if (mapped) {
        const uint64_t seq = nextSeq_++;
        FrameShmSlot& slot =
            ring_.header->slots[seq % FRAME_SHM_RING_SLOTS];
        slot.seq.store(0, std::memory_order_release);
        std::memcpy(ring_.slotData(seq), mapped,
                    (size_t)ring_.header->frame_bytes);
        slot.produce_time_ns = nowNs();
        slot.seq.store(seq, std::memory_order_release);
        ring_.header->latest_seq.store(seq, std::memory_order_release);
        glUnmapBuffer(GL_PIXEL_PACK_BUFFER);
    }
    glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
    pendingPbo_ = -1;
}

inline void RenderPipeline::renderFrame() {
    mpv_opengl_fbo fbo = {(int)fbo_, width_, height_, 0};
    int flipY = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
        {MPV_RENDER_PARAM_FLIP_Y, &flipY},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    mpv_render_context_render(renderContext_, params);

    glBindFramebuffer(GL_READ_FRAMEBUFFER, fbo_);
    glReadBuffer(GL_COLOR_ATTACHMENT0);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glPixelStorei(GL_PACK_ROW_LENGTH, 0);
    publishPending();
    glBindBuffer(GL_PIXEL_PACK_BUFFER, pbos_[cursor_]);
    glReadPixels(0, 0, width_, height_, GL_BGRA, GL_UNSIGNED_INT_8_8_8_8_REV,
                 nullptr);
    glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
    pendingPbo_ = cursor_;
    cursor_ = (cursor_ + 1) % FRAME_SHM_RING_SLOTS;
    mpv_render_context_report_swap(renderContext_);
}

inline void RenderPipeline::runLoop() {
    std::string glError;
    if (!setupGl(glError)) {
        emitLine(JsonWriter()
                     .str("event", "fatal")
                     .str("error", "render init failed: " + glError)
                     .finish());
        initState_.store(-1);
        gl_.destroy();
        ring_.destroy();
        return;
    }
    initState_.store(1);

    while (true) {
        int resizeWidth = 0;
        int resizeHeight = 0;
        bool targetsRebuilt = false;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            cv_.wait_for(lock, std::chrono::milliseconds(100), [&] {
                return updatePending_ || stopRequested_;
            });
            if (stopRequested_) break;
            updatePending_ = false;
            resizeWidth = pendingWidth_;
            resizeHeight = pendingHeight_;
            pendingWidth_ = 0;
            pendingHeight_ = 0;
        }

        if (resizeWidth > 0 && resizeHeight > 0 &&
            (resizeWidth != width_ || resizeHeight != height_)) {
            if (!rebuildTargets(resizeWidth, resizeHeight)) {
                emitLine(JsonWriter()
                             .str("event", "fatal")
                             .str("error", "resize target rebuild failed")
                             .finish());
                break;
            }
            targetsRebuilt = true;
        }

        const uint64_t flags = mpv_render_context_update(renderContext_);
        /* A resize installs an empty shm ring. Redraw the current frame even
         * while paused; the async PBO is published on the next loop. */
        if (targetsRebuilt || (flags & MPV_RENDER_UPDATE_FRAME)) {
            renderFrame();
        } else {
            /* Flush a stranded readback so pause keeps the last frame. */
            publishPending();
        }
        if (ring_.header) {
            ring_.header->heartbeat_ns.store(nowNs(),
                                             std::memory_order_relaxed);
        }
    }

    mpv_render_context_set_update_callback(renderContext_, nullptr, nullptr);
    mpv_render_context_free(renderContext_);
    renderContext_ = nullptr;
    if (texture_) glDeleteTextures(1, &texture_);
    if (fbo_) glDeleteFramebuffers(1, &fbo_);
    if (pbos_[0]) glDeleteBuffers(FRAME_SHM_RING_SLOTS, pbos_);
    gl_.destroy();
    ring_.destroy();
}

} // namespace frame_helper
