#include <windows.h>

#include "embedded_mpv_wid_types.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <sstream>
#include <string>

namespace {

class NativeVideoHost {
public:
    static bool isAvailable()
    {
        return true;
    }

    static std::string lastError()
    {
        if (!lastErrorMessage_.empty()) {
            return lastErrorMessage_;
        }

        return formatLastError(
            "Failed to create embedded MPV child window."
        );
    }

    static std::string formatLastError(const char* fallbackMessage)
    {
        DWORD error = GetLastError();
        if (error == 0) {
            return fallbackMessage;
        }

        LPSTR messageBuffer = nullptr;
        const DWORD length = FormatMessageA(
            FORMAT_MESSAGE_ALLOCATE_BUFFER |
                FORMAT_MESSAGE_FROM_SYSTEM |
                FORMAT_MESSAGE_IGNORE_INSERTS,
            nullptr,
            error,
            MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
            reinterpret_cast<LPSTR>(&messageBuffer),
            0,
            nullptr
        );

        std::string message = fallbackMessage;
        if (length > 0 && messageBuffer) {
            message += " ";
            message += messageBuffer;
        }
        if (messageBuffer) {
            LocalFree(messageBuffer);
        }
        return message;
    }

    bool create(uintptr_t parentHandle, const Bounds& bounds)
    {
        lastErrorMessage_.clear();
        parentWindow_ = reinterpret_cast<HWND>(parentHandle);
        if (!parentWindow_ || !IsWindow(parentWindow_)) {
            lastErrorMessage_ =
                "Unable to resolve Electron native window handle.";
            return false;
        }

        if (!registerWindowClass()) {
            return false;
        }
        window_ = CreateWindowExW(
            WS_EX_TRANSPARENT,
            windowClassName(),
            L"IPTVnator Embedded MPV",
            WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
            0,
            0,
            1,
            1,
            parentWindow_,
            nullptr,
            GetModuleHandleW(nullptr),
            nullptr
        );
        if (!window_) {
            lastErrorMessage_ = formatLastError(
                "Failed to create embedded MPV child window."
            );
            return false;
        }

        SetWindowLongPtrW(
            window_,
            GWLP_USERDATA,
            reinterpret_cast<LONG_PTR>(this)
        );
        setBounds(bounds);
        return true;
    }

    void setBounds(const Bounds& bounds)
    {
        if (!window_) {
            return;
        }

        const int x = static_cast<int>(std::lround(bounds.x));
        const int y = static_cast<int>(std::lround(bounds.y));
        const int width = std::max(1, static_cast<int>(std::lround(bounds.width)));
        const int height = std::max(1, static_cast<int>(std::lround(bounds.height)));

        SetWindowPos(
            window_,
            HWND_TOP,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW
        );
    }

    std::string wid() const
    {
        std::ostringstream stream;
        stream << reinterpret_cast<uintptr_t>(window_);
        return stream.str();
    }

    void destroy()
    {
        if (window_) {
            DestroyWindow(window_);
            window_ = nullptr;
        }
        parentWindow_ = nullptr;
    }

private:
    static const wchar_t* windowClassName()
    {
        return L"IPTVnatorEmbeddedMpvHostWindow";
    }

    static bool registerWindowClass()
    {
        static bool registered = false;
        if (registered) {
            return true;
        }

        WNDCLASSEXW windowClass{};
        windowClass.cbSize = sizeof(windowClass);
        windowClass.lpfnWndProc = &NativeVideoHost::windowProc;
        windowClass.hInstance = GetModuleHandleW(nullptr);
        windowClass.lpszClassName = windowClassName();
        windowClass.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
        windowClass.hbrBackground =
            reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
        const ATOM classAtom = RegisterClassExW(&windowClass);
        if (classAtom == 0) {
            const DWORD error = GetLastError();
            if (error != ERROR_CLASS_ALREADY_EXISTS) {
                lastErrorMessage_ = formatLastError(
                    "Failed to register embedded MPV child window class."
                );
                return false;
            }
        }

        registered = true;
        return true;
    }

    static LRESULT CALLBACK windowProc(
        HWND window,
        UINT message,
        WPARAM wParam,
        LPARAM lParam)
    {
        if (message == WM_NCHITTEST) {
            return HTTRANSPARENT;
        }

        if (message == WM_ERASEBKGND) {
            return 1;
        }

        return DefWindowProcW(window, message, wParam, lParam);
    }

    HWND parentWindow_ = nullptr;
    HWND window_ = nullptr;
    static inline std::string lastErrorMessage_;
};

} // namespace

#include "embedded_mpv_wid_common.h"
