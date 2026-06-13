#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <X11/Xlib.h>
#include <X11/extensions/shape.h>

#include "embedded_mpv_wid_types.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>

namespace {

std::mutex gX11ErrorMutex;
bool gX11ErrorTrapped = false;
XErrorEvent gLastX11Error{};

int trapX11Error(Display*, XErrorEvent* event)
{
    gX11ErrorTrapped = true;
    gLastX11Error = *event;
    return 0;
}

bool isTraceEnabled()
{
    return std::getenv("IPTVNATOR_TRACE_EMBEDDED_MPV") != nullptr;
}

void trace(const std::string& message)
{
    if (!isTraceEnabled()) {
        return;
    }

    std::cerr << "[Embedded MPV Linux] " << message << std::endl;
}

class ScopedX11ErrorTrap {
public:
    explicit ScopedX11ErrorTrap(Display* display)
        : lock_(gX11ErrorMutex)
        , display_(display)
        , previousHandler_(XSetErrorHandler(trapX11Error))
    {
        gX11ErrorTrapped = false;
        gLastX11Error = {};
    }

    ~ScopedX11ErrorTrap()
    {
        if (display_) {
            XSync(display_, False);
        }
        XSetErrorHandler(previousHandler_);
    }

    bool failed() const
    {
        return gX11ErrorTrapped;
    }

    int errorCode() const
    {
        return gLastX11Error.error_code;
    }

private:
    std::unique_lock<std::mutex> lock_;
    Display* display_ = nullptr;
    XErrorHandler previousHandler_ = nullptr;
};

class NativeVideoHost {
public:
    static bool isAvailable()
    {
        return std::getenv("DISPLAY") != nullptr;
    }

    static std::string lastError()
    {
        return lastError_;
    }

    bool create(uintptr_t parentHandle, const Bounds& bounds)
    {
        if (!isAvailable()) {
            lastError_ =
                "Embedded MPV on Linux requires X11 or Xwayland; DISPLAY is not set.";
            return false;
        }

        if (parentHandle <= 1) {
            lastError_ =
                "Electron did not provide a valid X11 parent window; native Wayland embedding is not supported yet.";
            return false;
        }

        trace("opening X11 display");
        display_ = XOpenDisplay(nullptr);
        if (!display_) {
            lastError_ = "Unable to open the X11 display for embedded MPV.";
            return false;
        }

        parentWindow_ = static_cast<Window>(parentHandle);
        trace("parent window " + std::to_string(static_cast<unsigned long>(parentWindow_)));
        if (!parentWindow_) {
            lastError_ = "Unable to resolve Electron X11 window handle.";
            destroy();
            return false;
        }

        XSetWindowAttributes attributes{};
        attributes.background_pixel = BlackPixel(display_, DefaultScreen(display_));
        attributes.event_mask = ExposureMask | StructureNotifyMask;

        bool createWindowFailed = false;
        {
            ScopedX11ErrorTrap x11Errors(display_);
            trace("creating child window");
            window_ = XCreateWindow(
                display_,
                parentWindow_,
                0,
                0,
                1,
                1,
                0,
                CopyFromParent,
                InputOutput,
                CopyFromParent,
                CWBackPixel | CWEventMask,
                &attributes
            );
            XSync(display_, False);
            if (!window_ || x11Errors.failed()) {
                std::ostringstream message;
                message
                    << "Failed to create embedded MPV X11 child window.";
                if (x11Errors.failed()) {
                    message << " X11 error code: " << x11Errors.errorCode()
                            << ".";
                }
                message
                    << " Electron did not provide a valid X11 parent window; "
                       "native Wayland embedding is not supported yet.";
                lastError_ = message.str();
                window_ = 0;
                createWindowFailed = true;
            }
        }
        if (createWindowFailed) {
            destroy();
            return false;
        }
        if (!window_) {
            lastError_ = "Failed to create embedded MPV X11 child window.";
            destroy();
            return false;
        }

        trace("clearing input shape");
        clearInputShape();
        trace("mapping child window");
        XMapWindow(display_, window_);
        trace("setting child bounds");
        setBounds(bounds);
        trace("flushing X11 display");
        XFlush(display_);
        return true;
    }

    void setBounds(const Bounds& bounds)
    {
        if (!display_ || !window_) {
            return;
        }

        const int x = static_cast<int>(std::lround(bounds.x));
        const int y = static_cast<int>(std::lround(bounds.y));
        const unsigned int width = static_cast<unsigned int>(
            std::max(1, static_cast<int>(std::lround(bounds.width)))
        );
        const unsigned int height = static_cast<unsigned int>(
            std::max(1, static_cast<int>(std::lround(bounds.height)))
        );

        XMoveResizeWindow(display_, window_, x, y, width, height);
        XRaiseWindow(display_, window_);
        XFlush(display_);
        drainEvents();
    }

    std::string wid() const
    {
        return std::to_string(static_cast<unsigned long>(window_));
    }

    void destroy()
    {
        if (display_ && window_) {
            XDestroyWindow(display_, window_);
            window_ = 0;
        }
        if (display_) {
            XCloseDisplay(display_);
            display_ = nullptr;
        }
        parentWindow_ = 0;
    }

private:
    void drainEvents()
    {
        if (!display_) {
            return;
        }

        while (XPending(display_) > 0) {
            XEvent event{};
            XNextEvent(display_, &event);
        }
    }

    void clearInputShape()
    {
        if (!display_ || !window_) {
            return;
        }

        int eventBase = 0;
        int errorBase = 0;
        if (!XShapeQueryExtension(display_, &eventBase, &errorBase)) {
            return;
        }

        XShapeCombineRectangles(
            display_,
            window_,
            ShapeInput,
            0,
            0,
            nullptr,
            0,
            ShapeSet,
            Unsorted
        );
    }

    Display* display_ = nullptr;
    Window parentWindow_ = 0;
    Window window_ = 0;
    static inline std::string lastError_ =
        "Failed to create embedded MPV X11 child window.";
};

} // namespace

#include "embedded_mpv_wid_common.h"
