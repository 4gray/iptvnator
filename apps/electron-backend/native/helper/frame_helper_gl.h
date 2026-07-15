/*
 * Headless GL context for the frame-copy helper, one implementation per
 * platform behind the same tiny GlContext surface.
 *
 * macOS: accelerated CGL 3.2 core context; GL entry points for mpv come
 * from the OpenGL framework via dlsym.
 *
 * Linux: EGL display candidates are fully probed in order — Mesa's
 * surfaceless platform (no display server needed), the session's default
 * display, then a GBM render node. The first hardware renderer wins; an
 * earlier software renderer is recreated only if no hardware tier works.
 * Each tier uses a desktop-GL 3.2 core context bound surfaceless (1x1 pbuffer
 * fallback for drivers without EGL_KHR_surfaceless_context). The helper's
 * own GL calls resolve at link time through libOpenGL (glvnd); mpv resolves
 * core symbols from that linked library and falls back to eglGetProcAddress
 * for extensions.
 *
 * Threading contract: create() runs on the main thread and must leave the
 * context unbound; the render thread calls makeCurrent() once and owns the
 * context until destroy().
 */
#pragma once

#include <string>

#if defined(__APPLE__)

#define GL_SILENCE_DEPRECATION
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>

#include <dlfcn.h>

#elif defined(__linux__)

/* Keep eglplatform.h away from Xlib types: the helper never uses native
 * window/display handles, so X11 headers are an unnecessary build dep. */
#define EGL_NO_X11 1
#define MESA_EGL_NO_X11_HEADERS 1
#define GL_GLEXT_PROTOTYPES 1
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GL/gl.h>
#include <GL/glext.h>

#include <fcntl.h>
#include <gbm.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <dlfcn.h>

#ifndef EGL_PLATFORM_SURFACELESS_MESA
#define EGL_PLATFORM_SURFACELESS_MESA 0x31DD
#endif
#ifndef EGL_PLATFORM_GBM_KHR
#define EGL_PLATFORM_GBM_KHR 0x31D7
#endif

#endif

namespace frame_helper {

/* Matches mpv_opengl_init_params.get_proc_address. */
using GlGetProcAddressFn = void* (*)(void* ctx, const char* name);

#if defined(__APPLE__)

inline void* glDlsymGetProcAddress(void* ctx, const char* name) {
    return dlsym(ctx, name);
}

class GlContext {
public:
    bool create(std::string& errorOut) {
        glDylib_ = dlopen(
            "/System/Library/Frameworks/OpenGL.framework/Versions/Current/"
            "OpenGL",
            RTLD_LAZY | RTLD_LOCAL);
        if (!glDylib_) {
            errorOut = "failed to open the OpenGL framework";
            return false;
        }

        CGLPixelFormatAttribute attrs[] = {
            kCGLPFAOpenGLProfile,
            (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
            kCGLPFAAccelerated,
            kCGLPFAColorSize, (CGLPixelFormatAttribute)24,
            kCGLPFAAlphaSize, (CGLPixelFormatAttribute)8,
            (CGLPixelFormatAttribute)0,
        };
        CGLPixelFormatObj pixelFormat = nullptr;
        GLint matched = 0;
        if (CGLChoosePixelFormat(attrs, &pixelFormat, &matched) !=
                kCGLNoError ||
            !pixelFormat) {
            errorOut = "no accelerated CGL pixel format";
            return false;
        }
        const CGLError contextError =
            CGLCreateContext(pixelFormat, nullptr, &cgl_);
        CGLDestroyPixelFormat(pixelFormat);
        if (contextError != kCGLNoError || !cgl_) {
            errorOut = "failed to create a headless CGL context";
            return false;
        }
        return true;
    }

    bool makeCurrent(std::string& errorOut) {
        if (CGLSetCurrentContext(cgl_) != kCGLNoError) {
            errorOut = "failed to bind the CGL render context";
            return false;
        }
        return true;
    }

    void destroy() {
        CGLSetCurrentContext(nullptr);
        if (cgl_) CGLDestroyContext(cgl_);
        cgl_ = nullptr;
        /* glDylib_ stays mapped: mpv may still resolve symbols during its
         * own teardown, and the process exits right after anyway. */
    }

    GlGetProcAddressFn procLoader() const { return glDlsymGetProcAddress; }
    void* procLoaderCtx() const { return glDylib_; }

private:
    CGLContextObj cgl_ = nullptr;
    void* glDylib_ = nullptr;
};

#elif defined(__linux__)

inline void* eglWrapGetProcAddress(void* /*ctx*/, const char* name) {
    if (void* linkedSymbol = dlsym(RTLD_DEFAULT, name)) return linkedSymbol;
    return reinterpret_cast<void*>(eglGetProcAddress(name));
}

class GlContext {
public:
    bool create(std::string& errorOut) {
        const DisplayTier tiers[] = {
            DisplayTier::SurfacelessMesa,
            DisplayTier::Default,
            DisplayTier::Gbm,
        };

        bool hasSoftwareFallback = false;
        DisplayTier softwareFallback = DisplayTier::SurfacelessMesa;
        std::string failures;

        for (DisplayTier tier : tiers) {
            Candidate candidate;
            std::string candidateError;
            if (!tryCandidate(tier, candidate, candidateError)) {
                if (candidateOwnsResources(candidate)) {
                    errorOut = candidateError +
                               "; failed to safely tear down rejected EGL "
                               "candidate";
                    return false;
                }
                appendFailure(failures, candidateError);
                continue;
            }

            if (!candidate.softwareRenderer) {
                adoptCandidate(candidate);
                std::fprintf(stderr, "egl display: %s\n", tierName(tier));
                return true;
            }

            std::fprintf(stderr,
                         "egl candidate %s uses software renderer %s; "
                         "trying the next tier\n",
                         tierName(tier), candidate.renderer.c_str());
            if (!hasSoftwareFallback) {
                softwareFallback = tier;
                hasSoftwareFallback = true;
            }
            destroyCandidate(candidate);
            if (candidateOwnsResources(candidate)) {
                errorOut = std::string(tierName(tier)) +
                           ": failed to safely release software EGL "
                           "candidate";
                return false;
            }
        }

        /* Recreate rather than retain the software context while probing the
         * remaining tiers: EGL implementations may alias platform displays,
         * and terminating one alias can invalidate the retained context. */
        if (hasSoftwareFallback) {
            Candidate candidate;
            std::string candidateError;
            if (tryCandidate(softwareFallback, candidate, candidateError)) {
                adoptCandidate(candidate);
                std::fprintf(stderr,
                             "egl display: %s (software fallback: %s)\n",
                             tierName(softwareFallback), renderer_.c_str());
                return true;
            }
            if (candidateOwnsResources(candidate)) {
                errorOut = candidateError +
                           "; failed to safely tear down software fallback";
                return false;
            }
            appendFailure(failures, candidateError);
        }

        errorOut = "no usable EGL display (surfaceless/default/GBM)";
        if (!failures.empty()) errorOut += ": " + failures;
        return false;
    }

    bool makeCurrent(std::string& errorOut) {
        /* eglBindAPI is thread-local. create() runs on the main thread, so the
         * render thread must select desktop GL for both bind and teardown. */
        if (eglBindAPI(EGL_OPENGL_API) != EGL_TRUE) {
            errorOut = "failed to bind the desktop OpenGL EGL API";
            return false;
        }
        if (eglMakeCurrent(display_, surface_, surface_, context_) != EGL_TRUE) {
            errorOut = "failed to bind the EGL render context";
            eglReleaseThread();
            return false;
        }
        return true;
    }

    void destroy() {
        if (display_ != EGL_NO_DISPLAY) {
            bool released = true;
            if (eglBindAPI(EGL_OPENGL_API) != EGL_TRUE) {
                std::fprintf(stderr,
                             "egl teardown: failed to bind desktop OpenGL\n");
                released = false;
            } else if (eglMakeCurrent(display_, EGL_NO_SURFACE, EGL_NO_SURFACE,
                                      EGL_NO_CONTEXT) != EGL_TRUE) {
                std::fprintf(stderr,
                             "egl teardown: failed to release current "
                             "context\n");
                released = false;
            }
            if (eglReleaseThread() != EGL_TRUE) {
                std::fprintf(stderr,
                             "egl teardown: eglReleaseThread failed\n");
                released = false;
            }
            /* Never tear down the display/GBM device under a context that EGL
             * may still consider current. The process is already exiting, so
             * leaking on this exceptional path is safer than use-after-free. */
            if (!released) return;

            if (surface_ != EGL_NO_SURFACE)
                eglDestroySurface(display_, surface_);
            if (context_ != EGL_NO_CONTEXT)
                eglDestroyContext(display_, context_);
            eglTerminate(display_);
        }
        surface_ = EGL_NO_SURFACE;
        context_ = EGL_NO_CONTEXT;
        display_ = EGL_NO_DISPLAY;
        if (gbmDevice_) {
            gbm_device_destroy(gbmDevice_);
            gbmDevice_ = nullptr;
        }
        if (gbmFd_ >= 0) {
            close(gbmFd_);
            gbmFd_ = -1;
        }
    }

    GlGetProcAddressFn procLoader() const { return eglWrapGetProcAddress; }
    void* procLoaderCtx() const { return nullptr; }

private:
    enum class DisplayTier { SurfacelessMesa, Default, Gbm };

    struct Candidate {
        EGLDisplay display = EGL_NO_DISPLAY;
        EGLContext context = EGL_NO_CONTEXT;
        EGLSurface surface = EGL_NO_SURFACE;
        struct gbm_device* gbmDevice = nullptr;
        int gbmFd = -1;
        bool initialized = false;
        bool current = false;
        bool threadReleased = false;
        bool softwareRenderer = false;
        std::string renderer;
    };

    static const char* tierName(DisplayTier tier) {
        switch (tier) {
            case DisplayTier::SurfacelessMesa:
                return "surfaceless-mesa";
            case DisplayTier::Default:
                return "default";
            case DisplayTier::Gbm:
                return "gbm render node";
        }
        return "unknown";
    }

    static void appendFailure(std::string& failures,
                              const std::string& failure) {
        if (failure.empty()) return;
        if (!failures.empty()) failures += "; ";
        failures += failure;
    }

    static bool candidateOwnsResources(const Candidate& candidate) {
        return candidate.display != EGL_NO_DISPLAY ||
               candidate.context != EGL_NO_CONTEXT ||
               candidate.surface != EGL_NO_SURFACE || candidate.gbmDevice ||
               candidate.gbmFd >= 0 || candidate.current;
    }

    static bool isSoftwareRenderer(const std::string& renderer) {
        std::string normalized = renderer;
        std::transform(normalized.begin(), normalized.end(), normalized.begin(),
                       [](unsigned char value) {
                           return static_cast<char>(std::tolower(value));
                       });
        for (const char* marker : {"llvmpipe", "softpipe", "swrast",
                                   "software rasterizer", "lavapipe"}) {
            if (normalized.find(marker) != std::string::npos) return true;
        }
        return false;
    }

    static bool openGbmDevice(Candidate& candidate) {
        for (int node = 128; node <= 131; node++) {
            char devicePath[32];
            std::snprintf(devicePath, sizeof(devicePath),
                          "/dev/dri/renderD%d", node);
            const int fd = open(devicePath, O_RDWR | O_CLOEXEC);
            if (fd < 0) continue;
            struct gbm_device* device = gbm_create_device(fd);
            if (!device) {
                close(fd);
                continue;
            }
            candidate.gbmFd = fd;
            candidate.gbmDevice = device;
            return true;
        }
        return false;
    }

    static bool chooseConfig(EGLDisplay display, EGLint surfaceType,
                             EGLConfig* out) {
        const EGLint attrs[] = {
            EGL_SURFACE_TYPE, surfaceType,
            EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT,
            EGL_RED_SIZE, 8,
            EGL_GREEN_SIZE, 8,
            EGL_BLUE_SIZE, 8,
            EGL_ALPHA_SIZE, 8,
            EGL_NONE,
        };
        EGLint matched = 0;
        return eglChooseConfig(display, attrs, out, 1, &matched) == EGL_TRUE &&
               matched > 0;
    }

    bool tryCandidate(DisplayTier tier, Candidate& candidate,
                      std::string& errorOut) {
        const auto fail = [&](const std::string& detail) {
            errorOut = std::string(tierName(tier)) + ": " + detail;
            destroyCandidate(candidate);
            return false;
        };

        switch (tier) {
            case DisplayTier::SurfacelessMesa:
                candidate.display = eglGetPlatformDisplay(
                    EGL_PLATFORM_SURFACELESS_MESA, nullptr, nullptr);
                break;
            case DisplayTier::Default:
                candidate.display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
                break;
            case DisplayTier::Gbm:
                if (!openGbmDevice(candidate)) {
                    return fail("no accessible DRM render node");
                }
                candidate.display = eglGetPlatformDisplay(
                    EGL_PLATFORM_GBM_KHR, candidate.gbmDevice, nullptr);
                break;
        }

        if (candidate.display == EGL_NO_DISPLAY) {
            return fail("eglGetDisplay returned EGL_NO_DISPLAY");
        }
        EGLint major = 0;
        EGLint minor = 0;
        if (eglInitialize(candidate.display, &major, &minor) != EGL_TRUE) {
            return fail("eglInitialize failed");
        }
        candidate.initialized = true;
        if (eglBindAPI(EGL_OPENGL_API) != EGL_TRUE) {
            return fail("desktop OpenGL API unavailable");
        }

        EGLConfig config = nullptr;
        if (!chooseConfig(candidate.display, EGL_PBUFFER_BIT, &config) &&
            !chooseConfig(candidate.display, 0, &config)) {
            return fail("no desktop-OpenGL EGLConfig");
        }
        const EGLint contextAttrs[] = {
            EGL_CONTEXT_MAJOR_VERSION,
            3,
            EGL_CONTEXT_MINOR_VERSION,
            2,
            EGL_CONTEXT_OPENGL_PROFILE_MASK,
            EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
            EGL_NONE,
        };
        candidate.context = eglCreateContext(candidate.display, config,
                                             EGL_NO_CONTEXT, contextAttrs);
        if (candidate.context == EGL_NO_CONTEXT) {
            return fail("failed to create a 3.2 core context");
        }

        if (eglMakeCurrent(candidate.display, EGL_NO_SURFACE, EGL_NO_SURFACE,
                           candidate.context) != EGL_TRUE) {
            const EGLint pbufferAttrs[] = {
                EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE,
            };
            candidate.surface = eglCreatePbufferSurface(
                candidate.display, config, pbufferAttrs);
            if (candidate.surface == EGL_NO_SURFACE ||
                eglMakeCurrent(candidate.display, candidate.surface,
                               candidate.surface, candidate.context) !=
                    EGL_TRUE) {
                return fail(
                    "eglMakeCurrent failed (surfaceless and pbuffer)");
            }
        }
        candidate.current = true;

        const GLubyte* renderer = glGetString(GL_RENDERER);
        if (!renderer) return fail("GL_RENDERER unavailable");
        candidate.renderer = reinterpret_cast<const char*>(renderer);
        candidate.softwareRenderer = isSoftwareRenderer(candidate.renderer);

        if (eglMakeCurrent(candidate.display, EGL_NO_SURFACE, EGL_NO_SURFACE,
                           EGL_NO_CONTEXT) != EGL_TRUE) {
            return fail("failed to unbind the probe context");
        }
        candidate.current = false;
        if (eglReleaseThread() != EGL_TRUE) {
            return fail("eglReleaseThread failed after probing");
        }
        candidate.threadReleased = true;
        return true;
    }

    static bool releaseCandidateThread(Candidate& candidate) {
        if (candidate.threadReleased) return true;
        if (candidate.current) {
            if (eglBindAPI(EGL_OPENGL_API) != EGL_TRUE ||
                eglMakeCurrent(candidate.display, EGL_NO_SURFACE,
                               EGL_NO_SURFACE, EGL_NO_CONTEXT) != EGL_TRUE) {
                return false;
            }
            candidate.current = false;
        }
        if (eglReleaseThread() != EGL_TRUE) return false;
        candidate.threadReleased = true;
        return true;
    }

    static void destroyCandidate(Candidate& candidate) {
        if (!releaseCandidateThread(candidate)) {
            std::fprintf(stderr,
                         "egl candidate teardown skipped: context release "
                         "failed\n");
            return;
        }
        if (candidate.display != EGL_NO_DISPLAY) {
            if (candidate.surface != EGL_NO_SURFACE)
                eglDestroySurface(candidate.display, candidate.surface);
            if (candidate.context != EGL_NO_CONTEXT)
                eglDestroyContext(candidate.display, candidate.context);
            if (candidate.initialized) eglTerminate(candidate.display);
        }
        if (candidate.gbmDevice) gbm_device_destroy(candidate.gbmDevice);
        if (candidate.gbmFd >= 0) close(candidate.gbmFd);
        candidate = Candidate{};
    }

    void adoptCandidate(Candidate& candidate) {
        display_ = candidate.display;
        context_ = candidate.context;
        surface_ = candidate.surface;
        gbmDevice_ = candidate.gbmDevice;
        gbmFd_ = candidate.gbmFd;
        renderer_ = candidate.renderer;
        candidate = Candidate{};
    }

    EGLDisplay display_ = EGL_NO_DISPLAY;
    EGLContext context_ = EGL_NO_CONTEXT;
    EGLSurface surface_ = EGL_NO_SURFACE;
    struct gbm_device* gbmDevice_ = nullptr;
    int gbmFd_ = -1;
    std::string renderer_;
};

#else
#error "frame_helper_gl.h has no GL context implementation for this platform"
#endif

} // namespace frame_helper
