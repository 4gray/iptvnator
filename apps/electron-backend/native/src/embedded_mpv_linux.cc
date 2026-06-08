#include <X11/Xlib.h>
#include <X11/extensions/shape.h>

#include "embedded_mpv_wid_types.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <sstream>
#include <string>

namespace {

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

        display_ = XOpenDisplay(nullptr);
        if (!display_) {
            lastError_ = "Unable to open the X11 display for embedded MPV.";
            return false;
        }

        parentWindow_ = static_cast<Window>(parentHandle);
        if (!parentWindow_) {
            lastError_ = "Unable to resolve Electron X11 window handle.";
            destroy();
            return false;
        }

        XSetWindowAttributes attributes{};
        attributes.background_pixel = BlackPixel(display_, DefaultScreen(display_));
        attributes.event_mask = ExposureMask | StructureNotifyMask;

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
        if (!window_) {
            lastError_ = "Failed to create embedded MPV X11 child window.";
            destroy();
            return false;
        }

        clearInputShape();
        XMapWindow(display_, window_);
        setBounds(bounds);
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
        std::ostringstream stream;
        stream << static_cast<unsigned long>(window_);
        return stream.str();
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
