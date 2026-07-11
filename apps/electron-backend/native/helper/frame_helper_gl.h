/*
 * Headless GL context for the frame-copy helper, one implementation per
 * platform behind the same tiny GlContext surface.
 *
 * macOS: accelerated CGL 3.2 core context; GL entry points for mpv come
 * from the OpenGL framework via dlsym.
 *
 * Linux: EGL display picked in order — Mesa's surfaceless platform (no
 * display server needed), the session's default display, then a GBM render
 * node — with a desktop-GL 3.2 core context bound surfaceless (1x1 pbuffer
 * fallback for drivers without EGL_KHR_surfaceless_context). The helper's
 * own GL calls resolve at link time through libOpenGL (glvnd); mpv resolves
 * its entry points via eglGetProcAddress.
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

#include <cstdio>

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

    void makeCurrent() { CGLSetCurrentContext(cgl_); }

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
    return reinterpret_cast<void*>(eglGetProcAddress(name));
}

class GlContext {
public:
    bool create(std::string& errorOut) {
        if (!acquireDisplay()) {
            errorOut = "no usable EGL display (surfaceless/default/GBM)";
            return false;
        }
        if (eglBindAPI(EGL_OPENGL_API) != EGL_TRUE) {
            errorOut = "EGL implementation lacks desktop OpenGL support";
            return false;
        }
        EGLConfig config = nullptr;
        if (!chooseConfig(EGL_PBUFFER_BIT, &config) &&
            !chooseConfig(0, &config)) {
            errorOut = "no usable EGLConfig for desktop OpenGL";
            return false;
        }
        const EGLint contextAttrs[] = {
            EGL_CONTEXT_MAJOR_VERSION, 3,
            EGL_CONTEXT_MINOR_VERSION, 2,
            EGL_CONTEXT_OPENGL_PROFILE_MASK,
            EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT,
            EGL_NONE,
        };
        context_ =
            eglCreateContext(display_, config, EGL_NO_CONTEXT, contextAttrs);
        if (context_ == EGL_NO_CONTEXT) {
            errorOut = "failed to create a 3.2 core EGL context";
            return false;
        }
        /* Probe surfaceless binding here (main thread) so the render thread
         * can just makeCurrent(); fall back to a 1x1 pbuffer. Unbind before
         * returning — see the threading contract above. */
        if (eglMakeCurrent(display_, EGL_NO_SURFACE, EGL_NO_SURFACE,
                           context_) != EGL_TRUE) {
            const EGLint pbufferAttrs[] = {EGL_WIDTH, 1, EGL_HEIGHT, 1,
                                           EGL_NONE};
            surface_ = eglCreatePbufferSurface(display_, config, pbufferAttrs);
            if (surface_ == EGL_NO_SURFACE ||
                eglMakeCurrent(display_, surface_, surface_, context_) !=
                    EGL_TRUE) {
                errorOut =
                    "eglMakeCurrent failed (no surfaceless context or "
                    "pbuffer)";
                return false;
            }
        }
        eglMakeCurrent(display_, EGL_NO_SURFACE, EGL_NO_SURFACE,
                       EGL_NO_CONTEXT);
        return true;
    }

    void makeCurrent() {
        eglMakeCurrent(display_, surface_, surface_, context_);
    }

    void destroy() {
        if (display_ != EGL_NO_DISPLAY) {
            eglMakeCurrent(display_, EGL_NO_SURFACE, EGL_NO_SURFACE,
                           EGL_NO_CONTEXT);
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
    bool acquireDisplay() {
        display_ = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA,
                                         nullptr, nullptr);
        if (initDisplay(display_)) return true;

        display_ = eglGetDisplay(EGL_DEFAULT_DISPLAY);
        if (initDisplay(display_)) return true;

        display_ = EGL_NO_DISPLAY;
        if (openGbmDevice()) {
            display_ = eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, gbmDevice_,
                                             nullptr);
            if (initDisplay(display_)) return true;
        }
        display_ = EGL_NO_DISPLAY;
        return false;
    }

    static bool initDisplay(EGLDisplay display) {
        if (display == EGL_NO_DISPLAY) return false;
        EGLint major = 0;
        EGLint minor = 0;
        return eglInitialize(display, &major, &minor) == EGL_TRUE;
    }

    bool openGbmDevice() {
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
            gbmFd_ = fd;
            gbmDevice_ = device;
            return true;
        }
        return false;
    }

    bool chooseConfig(EGLint surfaceType, EGLConfig* out) {
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
        return eglChooseConfig(display_, attrs, out, 1, &matched) ==
                   EGL_TRUE &&
               matched > 0;
    }

    EGLDisplay display_ = EGL_NO_DISPLAY;
    EGLContext context_ = EGL_NO_CONTEXT;
    EGLSurface surface_ = EGL_NO_SURFACE;
    struct gbm_device* gbmDevice_ = nullptr;
    int gbmFd_ = -1;
};

#else
#error "frame_helper_gl.h has no GL context implementation for this platform"
#endif

} // namespace frame_helper
