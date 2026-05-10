#include <napi.h>

#define GL_SILENCE_DEPRECATION

#import <AppKit/AppKit.h>
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>
#import <QuartzCore/QuartzCore.h>

#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <dlfcn.h>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

@interface EmbeddedMpvContainerView : NSView
@end

@implementation EmbeddedMpvContainerView
- (BOOL)isFlipped
{
    return YES;
}

- (NSView*)hitTest:(NSPoint)point
{
    return nil;
}
@end

@interface EmbeddedMpvOpenGLView : NSOpenGLView
@end

@implementation EmbeddedMpvOpenGLView
- (BOOL)isFlipped
{
    return YES;
}

- (NSView*)hitTest:(NSPoint)point
{
    return nil;
}
@end

namespace {

enum class SessionStatus {
    Idle,
    Loading,
    Playing,
    Paused,
    Error,
    Closed,
};

enum class RenderBackend {
    OpenGL,
    Software,
};

struct AudioTrack {
    int64_t id = 0;
    std::string title;
    std::string language;
    bool selected = false;
    bool defaultTrack = false;
    bool forced = false;
};

struct SessionSnapshot {
    SessionStatus status = SessionStatus::Idle;
    double positionSeconds = 0.0;
    double durationSeconds = -1.0;
    double volumePercent = 100.0;
    std::string streamUrl;
    std::string error;
    std::vector<AudioTrack> audioTracks;
    int64_t selectedAudioTrackId = -1;
    std::vector<AudioTrack> subtitleTracks;
    int64_t selectedSubtitleTrackId = -1;
    double playbackSpeed = 1.0;
    std::string aspectOverride = "no";
    bool recordingActive = false;
    std::string recordingTargetPath;
    std::string recordingStartedAt;
    std::string recordingError;
};

struct Session {
    std::string id;
    mpv_handle* handle = nullptr;
    mpv_render_context* renderContext = nullptr;
    NSView* __strong parentView = nil;
    NSView* __strong hostView = nil;
    NSView* __strong containerView = nil;
    NSOpenGLPixelFormat* __strong openGLPixelFormat = nil;
    NSOpenGLContext* __strong openGLContext = nil;
    CVDisplayLinkRef displayLink = nullptr;
    dispatch_queue_t renderQueue = nullptr;
    std::thread eventThread;
    std::atomic<bool> running{false};
    std::atomic<bool> renderScheduled{false};
    std::atomic<bool> renderNeeded{false};
    std::atomic<uint64_t> renderedFrameCount{0};
    std::atomic<uint64_t> skippedFrameCount{0};
    std::atomic<uint64_t> totalRenderNanoseconds{0};
    std::mutex mutex;
    SessionSnapshot snapshot;
    uint64_t pendingRecordingStartRequestId = 0;
    uint64_t pendingRecordingStopRequestId = 0;
    std::string pendingRecordingTargetPath;
    std::string pendingRecordingStartedAt;
    std::string pendingRecordingStopStartedAt;
    std::weak_ptr<Session>* renderCallbackContext = nullptr;
    RenderBackend renderBackend = RenderBackend::OpenGL;
    int renderWidthPixels = 0;
    int renderHeightPixels = 0;
    double renderContentsScale = 1.0;
    bool paused = false;
    bool loadedPath = false;
};

std::atomic<uint64_t> gNextSessionId{1};
std::atomic<uint64_t> gNextAsyncRequestId{1};
std::mutex gSessionsMutex;
std::unordered_map<std::string, std::shared_ptr<Session>> gSessions;

std::string toStatusString(SessionStatus status)
{
    switch (status) {
        case SessionStatus::Idle:
            return "idle";
        case SessionStatus::Loading:
            return "loading";
        case SessionStatus::Playing:
            return "playing";
        case SessionStatus::Paused:
            return "paused";
        case SessionStatus::Error:
            return "error";
        case SessionStatus::Closed:
            return "closed";
    }

    return "idle";
}

void runOnMainSync(dispatch_block_t block)
{
    if ([NSThread isMainThread]) {
        block();
        return;
    }

    dispatch_sync(dispatch_get_main_queue(), block);
}

std::shared_ptr<Session> findSession(const std::string& sessionId)
{
    std::lock_guard<std::mutex> sessionsLock(gSessionsMutex);
    const auto iterator = gSessions.find(sessionId);
    if (iterator == gSessions.end()) {
        return nullptr;
    }
    return iterator->second;
}

std::shared_ptr<Session> getSessionOrThrow(
    Napi::Env env,
    const std::string& sessionId)
{
    auto session = findSession(sessionId);
    if (!session) {
        throw Napi::Error::New(env, "Embedded MPV session not found.");
    }
    return session;
}

void scheduleRender(const std::shared_ptr<Session>& session);
void requestRender(const std::shared_ptr<Session>& session);
void updateSessionError(const std::shared_ptr<Session>& session, const std::string& error);

bool isEmbeddedMpvTraceEnabled()
{
    const char* value = std::getenv("IPTVNATOR_TRACE_EMBEDDED_MPV");
    return value && value[0] != '\0' && std::string(value) != "0";
}

std::string normalizeEnvValue(const char* value)
{
    if (!value) {
        return "";
    }

    std::string result(value);
    std::transform(
        result.begin(),
        result.end(),
        result.begin(),
        [](unsigned char character) {
            return static_cast<char>(std::tolower(character));
        }
    );
    return result;
}

RenderBackend requestedRenderBackend()
{
    const std::string renderer =
        normalizeEnvValue(std::getenv("IPTVNATOR_EMBEDDED_MPV_RENDERER"));
    return renderer == "sw"
        ? RenderBackend::Software
        : RenderBackend::OpenGL;
}

const char* renderBackendName(RenderBackend backend)
{
    return backend == RenderBackend::OpenGL ? "gl" : "sw";
}

void traceEmbeddedMpv(const std::shared_ptr<Session>& session, const std::string& message)
{
    if (!isEmbeddedMpvTraceEnabled()) {
        return;
    }

    fprintf(
        stderr,
        "[embedded-mpv][%s][trace] %s\n",
        session ? session->id.c_str() : "unknown",
        message.c_str()
    );
}

void recordRenderedFrame(
    const std::shared_ptr<Session>& session,
    std::chrono::steady_clock::duration renderDuration
)
{
    if (!session) {
        return;
    }

    const uint64_t durationNanoseconds =
        static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::nanoseconds>(
                renderDuration
            ).count()
        );
    const uint64_t frameCount =
        session->renderedFrameCount.fetch_add(1) + 1;
    const uint64_t totalNanoseconds =
        session->totalRenderNanoseconds.fetch_add(durationNanoseconds) +
        durationNanoseconds;

    if (!isEmbeddedMpvTraceEnabled() || frameCount % 120 != 0) {
        return;
    }

    const double averageMilliseconds =
        static_cast<double>(totalNanoseconds) /
        static_cast<double>(frameCount) /
        1000000.0;
    fprintf(
        stderr,
        "[embedded-mpv][%s][trace] renderer=%s frames=%llu avgRenderMs=%.2f skipped=%llu\n",
        session->id.c_str(),
        renderBackendName(session->renderBackend),
        static_cast<unsigned long long>(frameCount),
        averageMilliseconds,
        static_cast<unsigned long long>(session->skippedFrameCount.load())
    );
}

void* getOpenGLProcAddress(void*, const char* name)
{
    if (!name) {
        return nullptr;
    }

    void* symbol = dlsym(RTLD_DEFAULT, name);
    if (symbol) {
        return symbol;
    }

    CFBundleRef bundle =
        CFBundleGetBundleWithIdentifier(CFSTR("com.apple.opengl"));
    if (!bundle) {
        return nullptr;
    }

    CFStringRef symbolName = CFStringCreateWithCString(
        kCFAllocatorDefault,
        name,
        kCFStringEncodingASCII
    );
    if (!symbolName) {
        return nullptr;
    }

    symbol = CFBundleGetFunctionPointerForName(bundle, symbolName);
    CFRelease(symbolName);
    return symbol;
}

void updateRenderSurfaceMetrics(const std::shared_ptr<Session>& session)
{
    runOnMainSync(^{
      if (!session->containerView) {
          return;
      }

      const NSSize backingSize =
          [session->containerView convertSizeToBacking:session->containerView.bounds.size];
      const NSInteger widthPixels = std::max<NSInteger>(
          0,
          static_cast<NSInteger>(std::lround(backingSize.width))
      );
      const NSInteger heightPixels = std::max<NSInteger>(
          0,
          static_cast<NSInteger>(std::lround(backingSize.height))
      );
      const double contentsScale =
          session->containerView.window
              ? session->containerView.window.backingScaleFactor
              : NSScreen.mainScreen.backingScaleFactor;

      {
          std::lock_guard<std::mutex> lock(session->mutex);
          session->renderWidthPixels = static_cast<int>(widthPixels);
          session->renderHeightPixels = static_cast<int>(heightPixels);
          session->renderContentsScale = contentsScale > 0
              ? contentsScale
              : 1.0;
      }

      if (session->containerView.layer) {
          session->containerView.layer.contentsScale = contentsScale;
      }
    });
}

void setSessionFrame(const std::shared_ptr<Session>& session, double x, double y, double width, double height)
{
    runOnMainSync(^{
      if (!session->parentView || !session->hostView || !session->containerView) {
          return;
      }

      NSRect parentBounds = [session->parentView bounds];
      const CGFloat frameWidth = static_cast<CGFloat>(std::max(width, 0.0));
      const CGFloat frameHeight = static_cast<CGFloat>(std::max(height, 0.0));
      const CGFloat originX = static_cast<CGFloat>(x);
      const CGFloat originY = [session->parentView isFlipped]
          ? static_cast<CGFloat>(y)
          : NSMaxY(parentBounds) - static_cast<CGFloat>(y) - frameHeight;
      NSRect frameRect = NSMakeRect(originX, originY, frameWidth, frameHeight);

      if (session->hostView != session->parentView) {
          frameRect = [session->hostView convertRect:frameRect
                                            fromView:session->parentView];
      }

      [session->containerView setFrame:frameRect];
      if (session->openGLContext) {
          [session->openGLContext update];
      } else {
          [session->containerView setNeedsDisplay:YES];
      }
    });

    updateRenderSurfaceMetrics(session);
    requestRender(session);
}

void destroySession(const std::shared_ptr<Session>& session)
{
    if (!session) {
        return;
    }

    session->running.store(false);
    session->renderNeeded.store(false);

    if (session->displayLink) {
        CVDisplayLinkStop(session->displayLink);
    }

    if (session->handle) {
        bool recordingActive = false;
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            recordingActive = session->snapshot.recordingActive;
        }
        if (recordingActive) {
            const char* disabledValue = "";
            mpv_set_property(
                session->handle,
                "stream-record",
                MPV_FORMAT_STRING,
                const_cast<char**>(&disabledValue)
            );
            std::lock_guard<std::mutex> lock(session->mutex);
            session->snapshot.recordingActive = false;
            session->snapshot.recordingStartedAt.clear();
        }
        mpv_wakeup(session->handle);
    }

    if (session->eventThread.joinable()) {
        session->eventThread.join();
    }

    if (session->renderContext) {
        auto freeRenderContext = ^{
          if (!session->renderContext) {
              return;
          }

          if (session->renderBackend == RenderBackend::OpenGL &&
              session->openGLContext) {
              CGLContextObj cglContext =
                  [session->openGLContext CGLContextObj];
              if (cglContext) {
                  CGLLockContext(cglContext);
                  [session->openGLContext makeCurrentContext];
              }
              mpv_render_context_set_update_callback(
                  session->renderContext,
                  nullptr,
                  nullptr
              );
              mpv_render_context_free(session->renderContext);
              session->renderContext = nullptr;
              [NSOpenGLContext clearCurrentContext];
              if (cglContext) {
                  CGLUnlockContext(cglContext);
              }
              return;
          }

          mpv_render_context_set_update_callback(
              session->renderContext,
              nullptr,
              nullptr
          );
          mpv_render_context_free(session->renderContext);
          session->renderContext = nullptr;
        };

        if (session->renderQueue) {
            dispatch_sync(session->renderQueue, freeRenderContext);
        } else {
            freeRenderContext();
        }
    }

    if (session->renderCallbackContext) {
        delete session->renderCallbackContext;
        session->renderCallbackContext = nullptr;
    }

    if (session->displayLink) {
        CVDisplayLinkRelease(session->displayLink);
        session->displayLink = nullptr;
    }

    if (session->handle) {
        mpv_terminate_destroy(session->handle);
        session->handle = nullptr;
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.status = SessionStatus::Closed;
    }

    runOnMainSync(^{
      if (session->containerView) {
          [session->containerView removeFromSuperview];
          session->containerView = nil;
      }
      session->openGLContext = nil;
      session->openGLPixelFormat = nil;
      session->parentView = nil;
      session->hostView = nil;
    });
}

void renderSoftwareFrame(const std::shared_ptr<Session>& session)
{
    if (!session || !session->renderContext) {
        return;
    }

    const auto startedAt = std::chrono::steady_clock::now();
    int widthPixels = 0;
    int heightPixels = 0;
    double contentsScale = 1.0;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        widthPixels = session->renderWidthPixels;
        heightPixels = session->renderHeightPixels;
        contentsScale = session->renderContentsScale;
    }

    if (widthPixels <= 0 || heightPixels <= 0) {
        return;
    }

    const size_t stride = ((static_cast<size_t>(widthPixels) * 4) + 63) & ~static_cast<size_t>(63);
    std::vector<uint8_t> frameBytes(stride * static_cast<size_t>(heightPixels));
    int size[] = { widthPixels, heightPixels };
    size_t strideValue = stride;
    char format[] = "bgr0";
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_SW_SIZE, size },
        { MPV_RENDER_PARAM_SW_FORMAT, format },
        { MPV_RENDER_PARAM_SW_STRIDE, &strideValue },
        { MPV_RENDER_PARAM_SW_POINTER, frameBytes.data() },
        { MPV_RENDER_PARAM_INVALID, nullptr },
    };

    const int result = mpv_render_context_render(session->renderContext, params);
    if (result < 0) {
        updateSessionError(
            session,
            std::string("Failed to render frame: ") + mpv_error_string(result)
        );
        return;
    }

    CFDataRef frameData = CFDataCreate(
        kCFAllocatorDefault,
        frameBytes.data(),
        static_cast<CFIndex>(frameBytes.size())
    );
    if (!frameData) {
        return;
    }

    CGDataProviderRef provider = CGDataProviderCreateWithCFData(frameData);
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGBitmapInfo bitmapInfo =
        static_cast<CGBitmapInfo>(kCGBitmapByteOrder32Little |
                                  kCGImageAlphaNoneSkipFirst);
    CGImageRef image = CGImageCreate(
        static_cast<size_t>(widthPixels),
        static_cast<size_t>(heightPixels),
        8,
        32,
        strideValue,
        colorSpace,
        bitmapInfo,
        provider,
        nullptr,
        false,
        kCGRenderingIntentDefault
    );

    CGColorSpaceRelease(colorSpace);
    CGDataProviderRelease(provider);
    CFRelease(frameData);

    if (!image) {
        return;
    }

    id frameImage = CFBridgingRelease(image);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!session->containerView || !session->containerView.layer) {
          return;
      }

      session->containerView.layer.contents = frameImage;
      session->containerView.layer.contentsScale = contentsScale;
      session->containerView.layer.contentsGravity = kCAGravityResize;
    });

    recordRenderedFrame(session, std::chrono::steady_clock::now() - startedAt);
}

void renderOpenGLFrame(const std::shared_ptr<Session>& session)
{
    if (!session || !session->renderContext || !session->openGLContext) {
        return;
    }

    int widthPixels = 0;
    int heightPixels = 0;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        widthPixels = session->renderWidthPixels;
        heightPixels = session->renderHeightPixels;
    }

    if (widthPixels <= 0 || heightPixels <= 0) {
        session->skippedFrameCount.fetch_add(1);
        return;
    }

    const auto startedAt = std::chrono::steady_clock::now();
    CGLContextObj cglContext = [session->openGLContext CGLContextObj];
    if (!cglContext) {
        session->skippedFrameCount.fetch_add(1);
        return;
    }

    CGLLockContext(cglContext);
    [session->openGLContext makeCurrentContext];

    const uint64_t updateFlags =
        mpv_render_context_update(session->renderContext);
    if ((updateFlags & MPV_RENDER_UPDATE_FRAME) == 0) {
        CGLUnlockContext(cglContext);
        session->skippedFrameCount.fetch_add(1);
        return;
    }

    glViewport(0, 0, widthPixels, heightPixels);
    glClearColor(0.0F, 0.0F, 0.0F, 1.0F);
    glClear(GL_COLOR_BUFFER_BIT);

    mpv_opengl_fbo fbo = {
        0,
        widthPixels,
        heightPixels,
        GL_RGBA8,
    };
    int flipY = 1;
    int blockForTargetTime = 0;
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
        { MPV_RENDER_PARAM_FLIP_Y, &flipY },
        { MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &blockForTargetTime },
        { MPV_RENDER_PARAM_INVALID, nullptr },
    };

    const int result = mpv_render_context_render(
        session->renderContext,
        params
    );
    if (result < 0) {
        CGLUnlockContext(cglContext);
        updateSessionError(
            session,
            std::string("Failed to render OpenGL frame: ") +
                mpv_error_string(result)
        );
        return;
    }

    [session->openGLContext flushBuffer];
    mpv_render_context_report_swap(session->renderContext);
    CGLUnlockContext(cglContext);

    recordRenderedFrame(session, std::chrono::steady_clock::now() - startedAt);
}

void renderSessionFrame(const std::shared_ptr<Session>& session)
{
    if (!session) {
        return;
    }

    if (session->renderBackend == RenderBackend::OpenGL) {
        renderOpenGLFrame(session);
        return;
    }

    renderSoftwareFrame(session);
}

void scheduleRender(const std::shared_ptr<Session>& session)
{
    if (!session || !session->renderQueue || !session->renderContext) {
        return;
    }

    if (session->renderScheduled.exchange(true)) {
        return;
    }

    auto sessionCopy = session;
    dispatch_async(session->renderQueue, ^{
      renderSessionFrame(sessionCopy);
      sessionCopy->renderScheduled.store(false);
    });
}

void requestRender(const std::shared_ptr<Session>& session)
{
    if (!session) {
        return;
    }

    if (session->renderBackend == RenderBackend::OpenGL) {
        session->renderNeeded.store(true);
        return;
    }

    scheduleRender(session);
}

CVReturn displayLinkCallback(
    CVDisplayLinkRef,
    const CVTimeStamp*,
    const CVTimeStamp*,
    CVOptionFlags,
    CVOptionFlags*,
    void* context
)
{
    const auto* weakSession =
        static_cast<std::weak_ptr<Session>*>(context);
    if (!weakSession) {
        return kCVReturnSuccess;
    }

    if (const auto session = weakSession->lock()) {
        if (session->running.load() &&
            session->renderBackend == RenderBackend::OpenGL &&
            session->renderNeeded.exchange(false)) {
            scheduleRender(session);
        }
    }

    return kCVReturnSuccess;
}

void onRenderContextUpdate(void* context)
{
    const auto* weakSession =
        static_cast<std::weak_ptr<Session>*>(context);
    if (!weakSession) {
        return;
    }

    if (const auto session = weakSession->lock()) {
        requestRender(session);
    }
}

std::string joinHeaderFields(const Napi::Object& headers)
{
    const Napi::Array propertyNames = headers.GetPropertyNames();
    std::vector<std::string> fields;
    fields.reserve(propertyNames.Length());

    for (uint32_t index = 0; index < propertyNames.Length(); index += 1) {
        const Napi::Value propertyName = propertyNames.Get(index);
        if (!propertyName.IsString()) {
            continue;
        }

        const std::string key = propertyName.As<Napi::String>().Utf8Value();
        const Napi::Value propertyValue = headers.Get(propertyName);
        if (!propertyValue.IsString() && !propertyValue.IsNumber()) {
            continue;
        }

        std::string value = propertyValue.ToString().Utf8Value();
        if (key.empty() || value.empty()) {
            continue;
        }

        fields.push_back(key + ": " + value);
    }

    std::ostringstream stream;
    for (size_t index = 0; index < fields.size(); index += 1) {
        if (index > 0) {
            stream << ",";
        }
        stream << fields[index];
    }

    return stream.str();
}

std::string readOptionalString(const Napi::Object& object, const char* key)
{
    if (!object.Has(key)) {
        return "";
    }

    const Napi::Value value = object.Get(key);
    if (value.IsUndefined() || value.IsNull()) {
        return "";
    }

    return value.ToString().Utf8Value();
}

double readOptionalNumber(const Napi::Object& object, const char* key, double fallbackValue)
{
    if (!object.Has(key)) {
        return fallbackValue;
    }

    const Napi::Value value = object.Get(key);
    if (!value.IsNumber()) {
        return fallbackValue;
    }

    return value.As<Napi::Number>().DoubleValue();
}

bool parseIntegerString(const std::string& value, int64_t& result)
{
    if (value.empty()) {
        return false;
    }

    char* end = nullptr;
    const long long parsed = std::strtoll(value.c_str(), &end, 10);
    if (!end || *end != '\0') {
        return false;
    }

    result = static_cast<int64_t>(parsed);
    return true;
}

const mpv_node* getNodeMapValue(const mpv_node& node, const char* key)
{
    if (node.format != MPV_FORMAT_NODE_MAP ||
        !node.u.list ||
        !node.u.list->keys ||
        !node.u.list->values) {
        return nullptr;
    }

    for (int index = 0; index < node.u.list->num; index += 1) {
        const char* candidateKey = node.u.list->keys[index];
        if (candidateKey && std::strcmp(candidateKey, key) == 0) {
            return &node.u.list->values[index];
        }
    }

    return nullptr;
}

std::string readNodeString(const mpv_node& node)
{
    switch (node.format) {
        case MPV_FORMAT_STRING:
            return node.u.string ? node.u.string : "";
        case MPV_FORMAT_INT64:
            return std::to_string(node.u.int64);
        case MPV_FORMAT_DOUBLE: {
            std::ostringstream stream;
            stream << node.u.double_;
            return stream.str();
        }
        default:
            return "";
    }
}

bool readNodeFlag(const mpv_node& node)
{
    if (node.format == MPV_FORMAT_FLAG) {
        return node.u.flag != 0;
    }

    if (node.format == MPV_FORMAT_STRING && node.u.string) {
        const std::string value = normalizeEnvValue(node.u.string);
        return value == "yes" || value == "true" || value == "1";
    }

    return false;
}

bool readNodeInteger(const mpv_node& node, int64_t& result)
{
    if (node.format == MPV_FORMAT_INT64) {
        result = node.u.int64;
        return true;
    }

    if (node.format == MPV_FORMAT_DOUBLE) {
        result = static_cast<int64_t>(node.u.double_);
        return true;
    }

    if (node.format == MPV_FORMAT_STRING && node.u.string) {
        return parseIntegerString(node.u.string, result);
    }

    return false;
}

void updateSelectedAudioTrack(SessionSnapshot& snapshot, int64_t selectedTrackId)
{
    snapshot.selectedAudioTrackId = selectedTrackId >= 0 ? selectedTrackId : -1;
    for (auto& track : snapshot.audioTracks) {
        track.selected = track.id == snapshot.selectedAudioTrackId;
    }
}

void updateSelectedSubtitleTrack(SessionSnapshot& snapshot, int64_t selectedTrackId)
{
    snapshot.selectedSubtitleTrackId =
        selectedTrackId >= 0 ? selectedTrackId : -1;
    for (auto& track : snapshot.subtitleTracks) {
        track.selected = track.id == snapshot.selectedSubtitleTrackId;
    }
}

void updateTracksFromNode(
    SessionSnapshot& snapshot,
    const mpv_node& node,
    const std::string& typeFilter,
    std::vector<AudioTrack>& outTracks,
    int64_t& outSelectedId)
{
    outTracks.clear();
    outSelectedId = -1;

    if (node.format != MPV_FORMAT_NODE_ARRAY ||
        !node.u.list ||
        !node.u.list->values) {
        return;
    }

    for (int index = 0; index < node.u.list->num; index += 1) {
        const mpv_node& trackNode = node.u.list->values[index];
        if (trackNode.format != MPV_FORMAT_NODE_MAP) {
            continue;
        }

        const mpv_node* typeNode = getNodeMapValue(trackNode, "type");
        if (!typeNode || readNodeString(*typeNode) != typeFilter) {
            continue;
        }

        const mpv_node* idNode = getNodeMapValue(trackNode, "id");
        int64_t id = -1;
        if (!idNode || !readNodeInteger(*idNode, id) || id < 0) {
            continue;
        }

        AudioTrack track;
        track.id = id;
        if (const mpv_node* titleNode = getNodeMapValue(trackNode, "title")) {
            track.title = readNodeString(*titleNode);
        }
        if (const mpv_node* languageNode = getNodeMapValue(trackNode, "lang")) {
            track.language = readNodeString(*languageNode);
        }
        if (const mpv_node* selectedNode = getNodeMapValue(trackNode, "selected")) {
            track.selected = readNodeFlag(*selectedNode);
        }
        if (const mpv_node* defaultNode = getNodeMapValue(trackNode, "default")) {
            track.defaultTrack = readNodeFlag(*defaultNode);
        }
        if (const mpv_node* forcedNode = getNodeMapValue(trackNode, "forced")) {
            track.forced = readNodeFlag(*forcedNode);
        }

        if (track.selected) {
            outSelectedId = track.id;
        }
        outTracks.push_back(track);
    }
}

void updateAudioTracksFromNode(SessionSnapshot& snapshot, const mpv_node& node)
{
    updateTracksFromNode(
        snapshot,
        node,
        "audio",
        snapshot.audioTracks,
        snapshot.selectedAudioTrackId
    );
}

void updateSubtitleTracksFromNode(SessionSnapshot& snapshot, const mpv_node& node)
{
    updateTracksFromNode(
        snapshot,
        node,
        "sub",
        snapshot.subtitleTracks,
        snapshot.selectedSubtitleTrackId
    );
}

void updateSessionError(const std::shared_ptr<Session>& session, const std::string& error)
{
    std::lock_guard<std::mutex> lock(session->mutex);
    session->snapshot.status = SessionStatus::Error;
    session->snapshot.error = error;
}

uint64_t nextAsyncRequestId()
{
    return gNextAsyncRequestId.fetch_add(1);
}

std::string currentUtcTimestamp()
{
    std::time_t now = std::time(nullptr);
    std::tm timeInfo{};
#if defined(_WIN32)
    gmtime_s(&timeInfo, &now);
#else
    gmtime_r(&now, &timeInfo);
#endif
    char buffer[32]{};
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeInfo);
    return buffer;
}

bool reconcileRecordingPropertyReply(
    const std::shared_ptr<Session>& session,
    uint64_t requestId,
    int error
)
{
    if (requestId == 0) {
        return false;
    }

    if (requestId == session->pendingRecordingStartRequestId) {
        session->pendingRecordingStartRequestId = 0;
        const std::string targetPath = session->pendingRecordingTargetPath;
        const std::string startedAt = session->pendingRecordingStartedAt;
        session->pendingRecordingTargetPath.clear();
        session->pendingRecordingStartedAt.clear();

        if (error < 0) {
            session->snapshot.recordingActive = false;
            session->snapshot.recordingTargetPath = targetPath;
            session->snapshot.recordingStartedAt.clear();
            session->snapshot.recordingError = mpv_error_string(error);
            return true;
        }

        session->snapshot.recordingActive = true;
        session->snapshot.recordingTargetPath = targetPath;
        session->snapshot.recordingStartedAt = startedAt;
        session->snapshot.recordingError.clear();
        return true;
    }

    if (requestId == session->pendingRecordingStopRequestId) {
        session->pendingRecordingStopRequestId = 0;
        const std::string startedAt = session->pendingRecordingStopStartedAt;
        session->pendingRecordingStopStartedAt.clear();

        if (error < 0) {
            session->snapshot.recordingActive = true;
            session->snapshot.recordingStartedAt = startedAt;
            session->snapshot.recordingError = mpv_error_string(error);
            return true;
        }

        session->snapshot.recordingActive = false;
        session->snapshot.recordingStartedAt.clear();
        session->snapshot.recordingError.clear();
        return true;
    }

    return false;
}

double clampVolumePercent(double volume)
{
    return std::clamp(volume, 0.0, 1.0) * 100.0;
}

void runEventLoop(const std::shared_ptr<Session>& session)
{
    while (session->running.load()) {
        mpv_event* event = mpv_wait_event(session->handle, 0.1);
        if (!event || event->event_id == MPV_EVENT_NONE) {
            continue;
        }

        std::lock_guard<std::mutex> lock(session->mutex);

        switch (event->event_id) {
            case MPV_EVENT_START_FILE:
                session->snapshot.status = SessionStatus::Loading;
                session->snapshot.error.clear();
                session->snapshot.audioTracks.clear();
                session->snapshot.selectedAudioTrackId = -1;
                session->snapshot.subtitleTracks.clear();
                session->snapshot.selectedSubtitleTrackId = -1;
                session->loadedPath = false;
                break;
            case MPV_EVENT_FILE_LOADED:
                session->loadedPath = true;
                session->snapshot.status = session->paused
                    ? SessionStatus::Paused
                    : SessionStatus::Playing;
                break;
            case MPV_EVENT_END_FILE: {
                const auto* endFile =
                    static_cast<mpv_event_end_file*>(event->data);
                if (endFile && endFile->reason == MPV_END_FILE_REASON_ERROR) {
                    session->snapshot.status = SessionStatus::Error;
                    session->snapshot.error =
                        endFile->error < 0
                            ? mpv_error_string(endFile->error)
                            : "Playback failed.";
                } else if (session->running.load()) {
                    session->snapshot.status = SessionStatus::Idle;
                }
                break;
            }
            case MPV_EVENT_PROPERTY_CHANGE: {
                const auto* property =
                    static_cast<mpv_event_property*>(event->data);
                if (!property || !property->name) {
                    break;
                }

                const std::string propertyName = property->name;

                if (propertyName == "time-pos" &&
                    property->format == MPV_FORMAT_DOUBLE &&
                    property->data) {
                    session->snapshot.positionSeconds =
                        *static_cast<double*>(property->data);
                    break;
                }

                if (propertyName == "duration" &&
                    property->format == MPV_FORMAT_DOUBLE &&
                    property->data) {
                    session->snapshot.durationSeconds =
                        *static_cast<double*>(property->data);
                    break;
                }

                if (propertyName == "pause" &&
                    property->format == MPV_FORMAT_FLAG &&
                    property->data) {
                    session->paused = *static_cast<int*>(property->data) != 0;
                    if (session->snapshot.status != SessionStatus::Loading &&
                        session->snapshot.status != SessionStatus::Error &&
                        session->loadedPath) {
                        session->snapshot.status = session->paused
                            ? SessionStatus::Paused
                            : SessionStatus::Playing;
                    }
                    break;
                }

                if (propertyName == "volume" &&
                    property->format == MPV_FORMAT_DOUBLE &&
                    property->data) {
                    session->snapshot.volumePercent =
                        *static_cast<double*>(property->data);
                    break;
                }

                if (propertyName == "path" &&
                    property->format == MPV_FORMAT_STRING &&
                    property->data) {
                    const auto* pathValue =
                        static_cast<char*>(property->data);
                    session->snapshot.streamUrl = pathValue ? pathValue : "";
                    break;
                }

                if (propertyName == "track-list" &&
                    property->format == MPV_FORMAT_NODE &&
                    property->data) {
                    const auto& trackListNode =
                        *static_cast<mpv_node*>(property->data);
                    updateAudioTracksFromNode(
                        session->snapshot,
                        trackListNode
                    );
                    updateSubtitleTracksFromNode(
                        session->snapshot,
                        trackListNode
                    );
                    break;
                }

                if (propertyName == "aid" &&
                    property->format == MPV_FORMAT_STRING &&
                    property->data) {
                    const auto* aidValue = static_cast<char*>(property->data);
                    int64_t selectedTrackId = -1;
                    if (aidValue && parseIntegerString(aidValue, selectedTrackId)) {
                        updateSelectedAudioTrack(
                            session->snapshot,
                            selectedTrackId
                        );
                    }
                    break;
                }

                if (propertyName == "sid" &&
                    property->format == MPV_FORMAT_STRING &&
                    property->data) {
                    const auto* sidValue = static_cast<char*>(property->data);
                    int64_t selectedTrackId = -1;
                    if (sidValue && parseIntegerString(sidValue, selectedTrackId)) {
                        updateSelectedSubtitleTrack(
                            session->snapshot,
                            selectedTrackId
                        );
                    } else {
                        updateSelectedSubtitleTrack(session->snapshot, -1);
                    }
                    break;
                }

                if (propertyName == "speed" &&
                    property->format == MPV_FORMAT_DOUBLE &&
                    property->data) {
                    session->snapshot.playbackSpeed =
                        *static_cast<double*>(property->data);
                    break;
                }

                if (propertyName == "video-aspect-override" &&
                    property->format == MPV_FORMAT_STRING &&
                    property->data) {
                    const auto* aspectValue =
                        static_cast<char*>(property->data);
                    session->snapshot.aspectOverride =
                        aspectValue ? aspectValue : "no";
                    break;
                }

                break;
            }
            case MPV_EVENT_LOG_MESSAGE: {
                const auto* logMessage =
                    static_cast<mpv_event_log_message*>(event->data);
                if (!logMessage || !logMessage->level || !logMessage->text) {
                    break;
                }

                const std::string level = logMessage->level;
                const char* prefix =
                    logMessage->prefix ? logMessage->prefix : "mpv";
                if (level == "warn" || level == "error" || level == "fatal") {
                    fprintf(
                        stderr,
                        "[embedded-mpv][%s][%s] %s: %s",
                        session->id.c_str(),
                        level.c_str(),
                        prefix,
                        logMessage->text
                    );
                }
                if (level == "error" || level == "fatal") {
                    session->snapshot.error = logMessage->text;
                }
                if (level == "fatal") {
                    session->snapshot.status = SessionStatus::Error;
                }
                break;
            }
            case MPV_EVENT_COMMAND_REPLY:
            case MPV_EVENT_SET_PROPERTY_REPLY:
                if (reconcileRecordingPropertyReply(
                        session,
                        event->reply_userdata,
                        event->error
                    )) {
                    break;
                }
                if (event->error < 0) {
                    session->snapshot.status = SessionStatus::Error;
                    session->snapshot.error = mpv_error_string(event->error);
                }
                break;
            case MPV_EVENT_SHUTDOWN:
                session->running.store(false);
                session->snapshot.status = SessionStatus::Closed;
                break;
            default:
                break;
        }
    }
}

bool createSoftwareView(const std::shared_ptr<Session>& session)
{
    __block bool created = false;
    runOnMainSync(^{
      session->containerView =
          [[EmbeddedMpvContainerView alloc] initWithFrame:NSMakeRect(0, 0, 0, 0)];
      session->containerView.wantsLayer = YES;
      session->containerView.layer = [CALayer layer];
      session->containerView.layer.backgroundColor =
          NSColor.blackColor.CGColor;
      session->containerView.layer.contentsGravity = kCAGravityResize;
      [session->hostView addSubview:session->containerView
                  positioned:NSWindowAbove
                  relativeTo:nil];
      created = true;
    });
    return created;
}

bool createOpenGLView(const std::shared_ptr<Session>& session)
{
    __block bool created = false;
    runOnMainSync(^{
      NSOpenGLPixelFormatAttribute attributes[] = {
          NSOpenGLPFAOpenGLProfile,
          NSOpenGLProfileVersion3_2Core,
          NSOpenGLPFAAccelerated,
          NSOpenGLPFADoubleBuffer,
          NSOpenGLPFAColorSize,
          24,
          NSOpenGLPFAAlphaSize,
          8,
          0,
      };

      session->openGLPixelFormat =
          [[NSOpenGLPixelFormat alloc] initWithAttributes:attributes];
      if (!session->openGLPixelFormat) {
          return;
      }

      auto* openGLView =
          [[EmbeddedMpvOpenGLView alloc] initWithFrame:NSMakeRect(0, 0, 0, 0)
                                           pixelFormat:session->openGLPixelFormat];
      if (!openGLView) {
          session->openGLPixelFormat = nil;
          return;
      }

      [openGLView setWantsBestResolutionOpenGLSurface:YES];
      session->openGLContext = [openGLView openGLContext];
      if (!session->openGLContext) {
          session->openGLPixelFormat = nil;
          return;
      }

      GLint swapInterval = 1;
      [session->openGLContext setValues:&swapInterval
                           forParameter:NSOpenGLContextParameterSwapInterval];
      [session->openGLContext setView:openGLView];
      session->containerView = openGLView;
      [session->hostView addSubview:session->containerView
                  positioned:NSWindowAbove
                  relativeTo:nil];
      created = true;
    });
    return created;
}

void removeRenderView(const std::shared_ptr<Session>& session)
{
    runOnMainSync(^{
      if (session->containerView) {
          [session->containerView removeFromSuperview];
          session->containerView = nil;
      }
      session->openGLContext = nil;
      session->openGLPixelFormat = nil;
    });
}

int createSoftwareRenderContext(const std::shared_ptr<Session>& session)
{
    mpv_render_param renderParams[] = {
        { MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_SW },
        { MPV_RENDER_PARAM_INVALID, nullptr },
    };
    return mpv_render_context_create(
        &session->renderContext,
        session->handle,
        renderParams
    );
}

int createOpenGLRenderContext(const std::shared_ptr<Session>& session)
{
    if (!session->openGLContext || !session->renderQueue) {
        return MPV_ERROR_UNSUPPORTED;
    }

    __block int renderResult = MPV_ERROR_UNSUPPORTED;
    dispatch_sync(session->renderQueue, ^{
      CGLContextObj cglContext = [session->openGLContext CGLContextObj];
      if (!cglContext) {
          renderResult = MPV_ERROR_UNSUPPORTED;
          return;
      }

      CGLLockContext(cglContext);
      [session->openGLContext makeCurrentContext];

      mpv_opengl_init_params openGLInitParams = {
          getOpenGLProcAddress,
          nullptr,
      };
      mpv_render_param renderParams[] = {
          { MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_OPENGL },
          { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &openGLInitParams },
          { MPV_RENDER_PARAM_INVALID, nullptr },
      };
      renderResult = mpv_render_context_create(
          &session->renderContext,
          session->handle,
          renderParams
      );

      [NSOpenGLContext clearCurrentContext];
      CGLUnlockContext(cglContext);
    });
    return renderResult;
}

bool startDisplayLink(const std::shared_ptr<Session>& session)
{
    if (!session->openGLContext ||
        !session->openGLPixelFormat ||
        !session->renderCallbackContext) {
        return false;
    }

    CVDisplayLinkRef displayLink = nullptr;
    CVReturn result = CVDisplayLinkCreateWithActiveCGDisplays(&displayLink);
    if (result != kCVReturnSuccess || !displayLink) {
        return false;
    }

    result = CVDisplayLinkSetCurrentCGDisplayFromOpenGLContext(
        displayLink,
        [session->openGLContext CGLContextObj],
        [session->openGLPixelFormat CGLPixelFormatObj]
    );
    if (result != kCVReturnSuccess) {
        CVDisplayLinkRelease(displayLink);
        return false;
    }

    CVDisplayLinkSetOutputCallback(
        displayLink,
        displayLinkCallback,
        session->renderCallbackContext
    );
    result = CVDisplayLinkStart(displayLink);
    if (result != kCVReturnSuccess) {
        CVDisplayLinkRelease(displayLink);
        return false;
    }

    session->displayLink = displayLink;
    return true;
}

Napi::Value IsSupported(const Napi::CallbackInfo& info)
{
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value CreateSession(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsObject()) {
        throw Napi::TypeError::New(
            env,
            "Expected window handle buffer and bounds object."
        );
    }

    const auto windowHandle = info[0].As<Napi::Buffer<uint8_t>>();
    if (windowHandle.Length() < sizeof(uintptr_t)) {
        throw Napi::Error::New(env, "Native window handle buffer is too small.");
    }

    uintptr_t windowHandleValue = 0;
    std::memcpy(
        &windowHandleValue,
        windowHandle.Data(),
        std::min(windowHandle.Length(), sizeof(uintptr_t))
    );

    NSView* parentView = (__bridge NSView*)reinterpret_cast<void*>(
        windowHandleValue
    );
    if (!parentView) {
        throw Napi::Error::New(env, "Unable to resolve Electron native window handle.");
    }

    const auto bounds = info[1].As<Napi::Object>();
    const auto session = std::make_shared<Session>();
    session->id = "embedded-mpv-" + std::to_string(gNextSessionId.fetch_add(1));
    session->parentView = parentView;
    session->hostView = [parentView window]
        ? [[parentView window] contentView]
        : parentView;
    session->renderQueue = dispatch_queue_create(
        "dev.iptvnator.embedded-mpv.render",
        DISPATCH_QUEUE_SERIAL
    );
    session->snapshot.volumePercent =
        info.Length() >= 4 && info[3].IsNumber()
            ? clampVolumePercent(info[3].As<Napi::Number>().DoubleValue())
            : 100.0;

    if (!session->hostView) {
        throw Napi::Error::New(env, "Unable to resolve the Electron content view.");
    }

    session->renderBackend = requestedRenderBackend();
    if (session->renderBackend == RenderBackend::OpenGL &&
        !createOpenGLView(session)) {
        traceEmbeddedMpv(
            session,
            "OpenGL view creation failed; falling back to software renderer."
        );
        session->renderBackend = RenderBackend::Software;
    }

    if (session->renderBackend == RenderBackend::Software &&
        !createSoftwareView(session)) {
        destroySession(session);
        throw Napi::Error::New(env, "Failed to create embedded MPV view.");
    }

    session->handle = mpv_create();
    if (!session->handle) {
        destroySession(session);
        throw Napi::Error::New(env, "Failed to create libmpv handle.");
    }

    mpv_set_option_string(session->handle, "terminal", "no");
    mpv_set_option_string(session->handle, "config", "no");
    mpv_set_option_string(session->handle, "osc", "no");
    mpv_set_option_string(session->handle, "idle", "yes");
    mpv_set_option_string(session->handle, "keep-open", "yes");
    mpv_set_option_string(session->handle, "input-default-bindings", "no");
    mpv_set_option_string(session->handle, "input-vo-keyboard", "no");
    // Keep parity with the external MPV launch path and avoid yt-dlp probing
    // IPTV-style URLs before handing them to FFmpeg directly.
    mpv_set_option_string(session->handle, "ytdl", "no");
    // The macOS `wid` path stays black inside Electron. Render into our own
    // surface instead of asking mpv to own a foreign Cocoa subwindow.
    mpv_set_option_string(session->handle, "vo", "libmpv");
    if (session->renderBackend == RenderBackend::OpenGL) {
        mpv_set_option_string(session->handle, "hwdec", "auto-safe");
    }

    const auto initialVolume =
        std::to_string(session->snapshot.volumePercent);
    mpv_set_option_string(session->handle, "volume", initialVolume.c_str());

    mpv_request_log_messages(session->handle, "warn");

    const int initializeResult = mpv_initialize(session->handle);
    if (initializeResult < 0) {
        destroySession(session);
        throw Napi::Error::New(
            env,
            std::string("Failed to initialize libmpv: ") +
                mpv_error_string(initializeResult)
        );
    }

    int renderResult = session->renderBackend == RenderBackend::OpenGL
        ? createOpenGLRenderContext(session)
        : createSoftwareRenderContext(session);

    if (renderResult < 0 &&
        session->renderBackend == RenderBackend::OpenGL) {
        traceEmbeddedMpv(
            session,
            std::string("OpenGL render context failed: ") +
                mpv_error_string(renderResult) +
                "; falling back to software renderer."
        );
        removeRenderView(session);
        session->renderBackend = RenderBackend::Software;
        if (!createSoftwareView(session)) {
            destroySession(session);
            throw Napi::Error::New(env, "Failed to create embedded MPV fallback view.");
        }
        renderResult = createSoftwareRenderContext(session);
    }

    if (renderResult < 0) {
        destroySession(session);
        throw Napi::Error::New(
            env,
            std::string("Failed to create libmpv render context: ") +
                mpv_error_string(renderResult)
        );
    }

    session->renderCallbackContext =
        new std::weak_ptr<Session>(session);

    if (session->renderBackend == RenderBackend::OpenGL &&
        !startDisplayLink(session)) {
        traceEmbeddedMpv(
            session,
            "CVDisplayLink startup failed; falling back to software renderer."
        );
        dispatch_sync(session->renderQueue, ^{
          if (session->renderContext) {
              CGLContextObj cglContext = [session->openGLContext CGLContextObj];
              if (cglContext) {
                  CGLLockContext(cglContext);
                  [session->openGLContext makeCurrentContext];
              }
              mpv_render_context_free(session->renderContext);
              session->renderContext = nullptr;
              [NSOpenGLContext clearCurrentContext];
              if (cglContext) {
                  CGLUnlockContext(cglContext);
              }
          }
        });
        removeRenderView(session);
        session->renderBackend = RenderBackend::Software;
        if (!createSoftwareView(session)) {
            destroySession(session);
            throw Napi::Error::New(env, "Failed to create embedded MPV fallback view.");
        }
        renderResult = createSoftwareRenderContext(session);
        if (renderResult < 0) {
            destroySession(session);
            throw Napi::Error::New(
                env,
                std::string("Failed to create libmpv fallback render context: ") +
                    mpv_error_string(renderResult)
            );
        }
    }

    traceEmbeddedMpv(
        session,
        std::string("Using renderer backend: ") +
            renderBackendName(session->renderBackend)
    );

    mpv_render_context_set_update_callback(
        session->renderContext,
        onRenderContextUpdate,
        session->renderCallbackContext
    );

    mpv_observe_property(session->handle, 1, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(session->handle, 2, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(session->handle, 3, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(session->handle, 4, "volume", MPV_FORMAT_DOUBLE);
    mpv_observe_property(session->handle, 5, "path", MPV_FORMAT_STRING);
    mpv_observe_property(session->handle, 6, "track-list", MPV_FORMAT_NODE);
    mpv_observe_property(session->handle, 7, "aid", MPV_FORMAT_STRING);
    mpv_observe_property(session->handle, 8, "sid", MPV_FORMAT_STRING);
    mpv_observe_property(session->handle, 9, "speed", MPV_FORMAT_DOUBLE);
    mpv_observe_property(
        session->handle,
        10,
        "video-aspect-override",
        MPV_FORMAT_STRING
    );

    session->running.store(true);
    session->eventThread = std::thread(runEventLoop, session);

    setSessionFrame(
        session,
        readOptionalNumber(bounds, "x", 0),
        readOptionalNumber(bounds, "y", 0),
        readOptionalNumber(bounds, "width", 0),
        readOptionalNumber(bounds, "height", 0)
    );

    {
        std::lock_guard<std::mutex> sessionsLock(gSessionsMutex);
        gSessions.emplace(session->id, session);
    }

    return Napi::String::New(env, session->id);
}

Napi::Value LoadPlayback(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        throw Napi::TypeError::New(env, "Expected session id and playback object.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto playback = info[1].As<Napi::Object>();
    const auto session = getSessionOrThrow(env, sessionId);
    const std::string streamUrl = readOptionalString(playback, "streamUrl");
    if (streamUrl.empty()) {
        throw Napi::Error::New(env, "Embedded MPV playback requires a stream URL.");
    }
    const std::string title = readOptionalString(playback, "title");
    const std::string userAgent = readOptionalString(playback, "userAgent");
    const std::string referer = readOptionalString(playback, "referer");
    const double startTime = readOptionalNumber(playback, "startTime", -1);

    bool recordingActive = false;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        recordingActive = session->snapshot.recordingActive;
    }
    if (recordingActive) {
        const char* disabledValue = "";
        const uint64_t stopRecordingRequestId = nextAsyncRequestId();
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            session->pendingRecordingStopRequestId = stopRecordingRequestId;
            session->pendingRecordingStopStartedAt =
                session->snapshot.recordingStartedAt;
        }

        const int stopResult = mpv_set_property_async(
            session->handle,
            stopRecordingRequestId,
            "stream-record",
            MPV_FORMAT_STRING,
            const_cast<char**>(&disabledValue)
        );
        if (stopResult < 0) {
            {
                std::lock_guard<std::mutex> lock(session->mutex);
                if (
                    session->pendingRecordingStopRequestId ==
                    stopRecordingRequestId
                ) {
                    session->pendingRecordingStopRequestId = 0;
                    session->pendingRecordingStopStartedAt.clear();
                }
            }
            updateSessionError(session, mpv_error_string(stopResult));
            throw Napi::Error::New(
                env,
                std::string("Failed to stop recording before loading playback: ") +
                    mpv_error_string(stopResult)
            );
        }
    }

    std::vector<std::pair<std::string, std::string>> options;
    if (!title.empty()) {
        options.emplace_back("force-media-title", title);
    }

    if (!userAgent.empty()) {
        options.emplace_back("user-agent", userAgent);
    }

    if (!referer.empty()) {
        options.emplace_back("referrer", referer);
    }

    if (std::isfinite(startTime) && startTime >= 0) {
        std::ostringstream startValue;
        startValue << startTime;
        options.emplace_back("start", startValue.str());
    }

    if (playback.Has("headers") && playback.Get("headers").IsObject()) {
        const auto headerFields =
            joinHeaderFields(playback.Get("headers").As<Napi::Object>());
        if (!headerFields.empty()) {
            options.emplace_back("http-header-fields", headerFields);
        }
    }

    std::vector<mpv_node> optionValues(options.size());
    std::vector<char*> optionKeys(options.size());
    for (size_t index = 0; index < options.size(); index += 1) {
        optionKeys[index] =
            const_cast<char*>(options[index].first.c_str());
        optionValues[index].format = MPV_FORMAT_STRING;
        optionValues[index].u.string =
            const_cast<char*>(options[index].second.c_str());
    }

    mpv_node_list optionList{};
    optionList.num = static_cast<int>(options.size());
    optionList.values = options.empty() ? nullptr : optionValues.data();
    optionList.keys = options.empty() ? nullptr : optionKeys.data();

    mpv_node optionMap{};
    optionMap.format = MPV_FORMAT_NODE_MAP;
    optionMap.u.list = &optionList;

    mpv_node commandValues[5]{};
    commandValues[0].format = MPV_FORMAT_STRING;
    commandValues[0].u.string = const_cast<char*>("loadfile");
    commandValues[1].format = MPV_FORMAT_STRING;
    commandValues[1].u.string = const_cast<char*>(streamUrl.c_str());
    commandValues[2].format = MPV_FORMAT_STRING;
    commandValues[2].u.string = const_cast<char*>("replace");
    commandValues[3].format = MPV_FORMAT_INT64;
    commandValues[3].u.int64 = -1;
    commandValues[4] = optionMap;

    mpv_node_list commandList{};
    commandList.num = 5;
    commandList.values = commandValues;
    commandList.keys = nullptr;

    mpv_node command{};
    command.format = MPV_FORMAT_NODE_ARRAY;
    command.u.list = &commandList;

    const int commandResult = mpv_command_node_async(
        session->handle,
        nextAsyncRequestId(),
        &command
    );
    if (commandResult < 0) {
        updateSessionError(session, mpv_error_string(commandResult));
        throw Napi::Error::New(
            env,
            std::string("Failed to load playback: ") +
                mpv_error_string(commandResult)
        );
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.streamUrl = streamUrl;
        session->snapshot.error.clear();
        session->snapshot.status = SessionStatus::Loading;
        session->snapshot.recordingActive = false;
        session->snapshot.recordingTargetPath.clear();
        session->snapshot.recordingStartedAt.clear();
        session->snapshot.recordingError.clear();
    }

    return env.Undefined();
}

Napi::Value SetBounds(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        throw Napi::TypeError::New(env, "Expected session id and bounds object.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto bounds = info[1].As<Napi::Object>();
    const auto session = getSessionOrThrow(env, sessionId);

    setSessionFrame(
        session,
        readOptionalNumber(bounds, "x", 0),
        readOptionalNumber(bounds, "y", 0),
        readOptionalNumber(bounds, "width", 0),
        readOptionalNumber(bounds, "height", 0)
    );

    return env.Undefined();
}

Napi::Value SetPaused(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBoolean()) {
        throw Napi::TypeError::New(env, "Expected session id and paused flag.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto session = getSessionOrThrow(env, sessionId);
    int paused = info[1].As<Napi::Boolean>().Value() ? 1 : 0;
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "pause",
        MPV_FORMAT_FLAG,
        &paused
    );

    if (result < 0) {
        throw Napi::Error::New(
            env,
            std::string("Failed to update playback state: ") +
                mpv_error_string(result)
        );
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->paused = paused != 0;
        if (session->loadedPath &&
            session->snapshot.status != SessionStatus::Error) {
            session->snapshot.status = session->paused
                ? SessionStatus::Paused
                : SessionStatus::Playing;
        }
    }

    return env.Undefined();
}

Napi::Value Seek(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and seek target.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto session = getSessionOrThrow(env, sessionId);
    const auto target = info[1].As<Napi::Number>().DoubleValue();
    const std::string targetValue = std::to_string(target);
    const char* command[] = {
        "seek",
        targetValue.c_str(),
        "absolute+exact",
        nullptr,
    };
    const int result = mpv_command_async(
        session->handle,
        nextAsyncRequestId(),
        command
    );

    if (result < 0) {
        throw Napi::Error::New(
            env,
            std::string("Failed to seek playback: ") +
                mpv_error_string(result)
        );
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.positionSeconds = std::max(0.0, target);
    }

    return env.Undefined();
}

Napi::Value SetVolume(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and volume.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto session = getSessionOrThrow(env, sessionId);
    double volume = clampVolumePercent(
        info[1].As<Napi::Number>().DoubleValue()
    );
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "volume",
        MPV_FORMAT_DOUBLE,
        &volume
    );

    if (result < 0) {
        throw Napi::Error::New(
            env,
            std::string("Failed to update volume: ") +
                mpv_error_string(result)
        );
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.volumePercent = volume;
    }

    return env.Undefined();
}

Napi::Value SetAudioTrack(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and audio track id.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto session = getSessionOrThrow(env, sessionId);
    int64_t trackId = info[1].As<Napi::Number>().Int64Value();
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "aid",
        MPV_FORMAT_INT64,
        &trackId
    );

    if (result < 0) {
        throw Napi::Error::New(
            env,
            std::string("Failed to update audio track: ") +
                mpv_error_string(result)
        );
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        updateSelectedAudioTrack(session->snapshot, trackId);
    }

    return env.Undefined();
}

Napi::Value SetSubtitleTrack(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(
            env,
            "Expected session id and subtitle track id."
        );
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto session = getSessionOrThrow(env, sessionId);
    int64_t trackId = info[1].As<Napi::Number>().Int64Value();

    int result = -1;
    if (trackId < 0) {
        const char* disabledValue = "no";
        std::string disabled = disabledValue;
        result = mpv_set_property_async(
            session->handle,
            nextAsyncRequestId(),
            "sid",
            MPV_FORMAT_STRING,
            const_cast<char**>(&disabledValue)
        );
    } else {
        result = mpv_set_property_async(
            session->handle,
            nextAsyncRequestId(),
            "sid",
            MPV_FORMAT_INT64,
            &trackId
        );
    }

    if (result < 0) {
        throw Napi::Error::New(
            env,
            std::string("Failed to update subtitle track: ") +
                mpv_error_string(result)
        );
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        updateSelectedSubtitleTrack(session->snapshot, trackId);
    }

    return env.Undefined();
}

Napi::Value SetSpeed(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and speed.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto session = getSessionOrThrow(env, sessionId);
    double speed = info[1].As<Napi::Number>().DoubleValue();
    speed = std::clamp(speed, 0.25, 4.0);

    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "speed",
        MPV_FORMAT_DOUBLE,
        &speed
    );

    if (result < 0) {
        throw Napi::Error::New(
            env,
            std::string("Failed to update playback speed: ") +
                mpv_error_string(result)
        );
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.playbackSpeed = speed;
    }

    return env.Undefined();
}

Napi::Value SetAspect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        throw Napi::TypeError::New(
            env,
            "Expected session id and aspect override."
        );
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto session = getSessionOrThrow(env, sessionId);
    std::string aspect = info[1].As<Napi::String>().Utf8Value();
    if (aspect.empty()) {
        aspect = "no";
    }

    const char* aspectValue = aspect.c_str();
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "video-aspect-override",
        MPV_FORMAT_STRING,
        const_cast<char**>(&aspectValue)
    );

    if (result < 0) {
        throw Napi::Error::New(
            env,
            std::string("Failed to update aspect override: ") +
                mpv_error_string(result)
        );
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.aspectOverride = aspect;
    }

    return env.Undefined();
}

Napi::Value StartRecording(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        throw Napi::TypeError::New(
            env,
            "Expected session id and recording target path."
        );
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const std::string targetPath = info[1].As<Napi::String>().Utf8Value();
    if (targetPath.empty()) {
        throw Napi::Error::New(env, "Recording target path is required.");
    }

    const auto session = getSessionOrThrow(env, sessionId);
    const char* targetValue = targetPath.c_str();
    const uint64_t requestId = nextAsyncRequestId();
    const std::string startedAt = currentUtcTimestamp();
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->pendingRecordingStartRequestId = requestId;
        session->pendingRecordingTargetPath = targetPath;
        session->pendingRecordingStartedAt = startedAt;
        session->snapshot.recordingActive = true;
        session->snapshot.recordingTargetPath = targetPath;
        session->snapshot.recordingStartedAt = startedAt;
        session->snapshot.recordingError.clear();
    }

    const int result = mpv_set_property_async(
        session->handle,
        requestId,
        "stream-record",
        MPV_FORMAT_STRING,
        const_cast<char**>(&targetValue)
    );

    if (result < 0) {
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            if (session->pendingRecordingStartRequestId == requestId) {
                session->pendingRecordingStartRequestId = 0;
                session->pendingRecordingTargetPath.clear();
                session->pendingRecordingStartedAt.clear();
            }
            session->snapshot.recordingActive = false;
            session->snapshot.recordingStartedAt.clear();
            session->snapshot.recordingError = mpv_error_string(result);
        }
        throw Napi::Error::New(
            env,
            std::string("Failed to start stream recording: ") +
                mpv_error_string(result)
        );
    }

    return env.Undefined();
}

Napi::Value StopRecording(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "Expected session id.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    const auto session = getSessionOrThrow(env, sessionId);
    const char* disabledValue = "";
    const uint64_t requestId = nextAsyncRequestId();
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->pendingRecordingStopRequestId = requestId;
        session->pendingRecordingStopStartedAt =
            session->snapshot.recordingStartedAt;
        session->snapshot.recordingActive = false;
        session->snapshot.recordingStartedAt.clear();
        session->snapshot.recordingError.clear();
    }

    const int result = mpv_set_property_async(
        session->handle,
        requestId,
        "stream-record",
        MPV_FORMAT_STRING,
        const_cast<char**>(&disabledValue)
    );

    if (result < 0) {
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            const std::string startedAt =
                session->pendingRecordingStopStartedAt;
            if (session->pendingRecordingStopRequestId == requestId) {
                session->pendingRecordingStopRequestId = 0;
                session->pendingRecordingStopStartedAt.clear();
            }
            session->snapshot.recordingActive = true;
            session->snapshot.recordingStartedAt = startedAt;
            session->snapshot.recordingError = mpv_error_string(result);
        }
        throw Napi::Error::New(
            env,
            std::string("Failed to stop stream recording: ") +
                mpv_error_string(result)
        );
    }

    return env.Undefined();
}

Napi::Value GetSessionSnapshot(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "Expected session id.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    std::shared_ptr<Session> session;

    {
        std::lock_guard<std::mutex> sessionsLock(gSessionsMutex);
        const auto iterator = gSessions.find(sessionId);
        if (iterator == gSessions.end()) {
            return env.Null();
        }
        session = iterator->second;
    }

    SessionSnapshot snapshot;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        snapshot = session->snapshot;
    }

    auto result = Napi::Object::New(env);
    result.Set("status", toStatusString(snapshot.status));
    result.Set(
        "positionSeconds",
        Napi::Number::New(env, snapshot.positionSeconds)
    );
    if (snapshot.durationSeconds < 0) {
        result.Set("durationSeconds", env.Null());
    } else {
        result.Set(
            "durationSeconds",
            Napi::Number::New(env, snapshot.durationSeconds)
        );
    }
    result.Set("volume", Napi::Number::New(env, snapshot.volumePercent / 100.0));
    result.Set("streamUrl", Napi::String::New(env, snapshot.streamUrl));
    if (snapshot.selectedAudioTrackId >= 0) {
        result.Set(
            "selectedAudioTrackId",
            Napi::Number::New(env, snapshot.selectedAudioTrackId)
        );
    } else {
        result.Set("selectedAudioTrackId", env.Null());
    }
    auto audioTracks = Napi::Array::New(env, snapshot.audioTracks.size());
    for (size_t index = 0; index < snapshot.audioTracks.size(); index += 1) {
        const AudioTrack& track = snapshot.audioTracks[index];
        auto trackObject = Napi::Object::New(env);
        trackObject.Set("id", Napi::Number::New(env, track.id));
        if (!track.title.empty()) {
            trackObject.Set("title", Napi::String::New(env, track.title));
        }
        if (!track.language.empty()) {
            trackObject.Set("language", Napi::String::New(env, track.language));
        }
        trackObject.Set("selected", Napi::Boolean::New(env, track.selected));
        trackObject.Set(
            "defaultTrack",
            Napi::Boolean::New(env, track.defaultTrack)
        );
        trackObject.Set("forced", Napi::Boolean::New(env, track.forced));
        audioTracks.Set(index, trackObject);
    }
    result.Set("audioTracks", audioTracks);

    if (snapshot.selectedSubtitleTrackId >= 0) {
        result.Set(
            "selectedSubtitleTrackId",
            Napi::Number::New(env, snapshot.selectedSubtitleTrackId)
        );
    } else {
        result.Set("selectedSubtitleTrackId", env.Null());
    }
    auto subtitleTracks =
        Napi::Array::New(env, snapshot.subtitleTracks.size());
    for (size_t index = 0; index < snapshot.subtitleTracks.size();
         index += 1) {
        const AudioTrack& track = snapshot.subtitleTracks[index];
        auto trackObject = Napi::Object::New(env);
        trackObject.Set("id", Napi::Number::New(env, track.id));
        if (!track.title.empty()) {
            trackObject.Set("title", Napi::String::New(env, track.title));
        }
        if (!track.language.empty()) {
            trackObject.Set("language", Napi::String::New(env, track.language));
        }
        trackObject.Set("selected", Napi::Boolean::New(env, track.selected));
        trackObject.Set(
            "defaultTrack",
            Napi::Boolean::New(env, track.defaultTrack)
        );
        trackObject.Set("forced", Napi::Boolean::New(env, track.forced));
        subtitleTracks.Set(index, trackObject);
    }
    result.Set("subtitleTracks", subtitleTracks);

    result.Set(
        "playbackSpeed",
        Napi::Number::New(env, snapshot.playbackSpeed)
    );
    result.Set(
        "aspectOverride",
        Napi::String::New(env, snapshot.aspectOverride)
    );
    if (snapshot.recordingActive ||
        !snapshot.recordingTargetPath.empty() ||
        !snapshot.recordingError.empty()) {
        auto recording = Napi::Object::New(env);
        recording.Set(
            "active",
            Napi::Boolean::New(env, snapshot.recordingActive)
        );
        if (!snapshot.recordingTargetPath.empty()) {
            recording.Set(
                "targetPath",
                Napi::String::New(env, snapshot.recordingTargetPath)
            );
        }
        if (!snapshot.recordingStartedAt.empty()) {
            recording.Set(
                "startedAt",
                Napi::String::New(env, snapshot.recordingStartedAt)
            );
        }
        if (!snapshot.recordingError.empty()) {
            recording.Set(
                "error",
                Napi::String::New(env, snapshot.recordingError)
            );
        }
        result.Set("recording", recording);
    }

    if (!snapshot.error.empty()) {
        result.Set("error", Napi::String::New(env, snapshot.error));
    }

    return result;
}

Napi::Value DisposeSession(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "Expected session id.");
    }

    const std::string sessionId = info[0].As<Napi::String>().Utf8Value();
    std::shared_ptr<Session> session;

    {
        std::lock_guard<std::mutex> sessionsLock(gSessionsMutex);
        const auto iterator = gSessions.find(sessionId);
        if (iterator == gSessions.end()) {
            return env.Undefined();
        }
        session = iterator->second;
        gSessions.erase(iterator);
    }

    destroySession(session);
    return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("isSupported", Napi::Function::New(env, IsSupported));
    exports.Set("createSession", Napi::Function::New(env, CreateSession));
    exports.Set("loadPlayback", Napi::Function::New(env, LoadPlayback));
    exports.Set("setBounds", Napi::Function::New(env, SetBounds));
    exports.Set("setPaused", Napi::Function::New(env, SetPaused));
    exports.Set("seek", Napi::Function::New(env, Seek));
    exports.Set("setVolume", Napi::Function::New(env, SetVolume));
    exports.Set("setAudioTrack", Napi::Function::New(env, SetAudioTrack));
    exports.Set(
        "setSubtitleTrack",
        Napi::Function::New(env, SetSubtitleTrack)
    );
    exports.Set("setSpeed", Napi::Function::New(env, SetSpeed));
    exports.Set("setAspect", Napi::Function::New(env, SetAspect));
    exports.Set("startRecording", Napi::Function::New(env, StartRecording));
    exports.Set("stopRecording", Napi::Function::New(env, StopRecording));
    exports.Set(
        "getSessionSnapshot",
        Napi::Function::New(env, GetSessionSnapshot)
    );
    exports.Set("disposeSession", Napi::Function::New(env, DisposeSession));
    return exports;
}

} // namespace

NODE_API_MODULE(embedded_mpv, Init)
