#pragma once

#include "embedded_mpv_wid_types.h"

#include <napi.h>

#include <mpv/client.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

enum class SessionStatus {
    Idle,
    Loading,
    Playing,
    Paused,
    Error,
    Closed,
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
    NativeVideoHost host;
    std::thread eventThread;
    std::atomic<bool> running{false};
    std::mutex mutex;
    SessionSnapshot snapshot;
    uint64_t pendingRecordingStartRequestId = 0;
    uint64_t pendingRecordingStopRequestId = 0;
    std::string pendingRecordingTargetPath;
    std::string pendingRecordingStartedAt;
    std::string pendingRecordingStopStartedAt;
    uint64_t pendingPlaybackLoadRequestId = 0;
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

uint64_t nextAsyncRequestId()
{
    return gNextAsyncRequestId.fetch_add(1);
}

double clampVolumePercent(double value)
{
    if (!std::isfinite(value)) {
        return 100.0;
    }
    return std::max(0.0, std::min(100.0, value * 100.0));
}

std::string nowIsoString()
{
    const auto now = std::chrono::system_clock::now();
    const std::time_t nowTime = std::chrono::system_clock::to_time_t(now);
    std::tm timeValue{};
#if defined(_WIN32)
    gmtime_s(&timeValue, &nowTime);
#else
    gmtime_r(&nowTime, &timeValue);
#endif
    char buffer[32]{};
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeValue);
    return buffer;
}

void updateSessionError(
    const std::shared_ptr<Session>& session,
    const std::string& error)
{
    if (!session) {
        return;
    }

    std::lock_guard<std::mutex> lock(session->mutex);
    session->snapshot.status = SessionStatus::Error;
    session->snapshot.error = error;
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

double readOptionalNumber(
    const Napi::Object& object,
    const char* key,
    double fallbackValue)
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

Bounds readBounds(const Napi::Object& object)
{
    return {
        readOptionalNumber(object, "x", 0),
        readOptionalNumber(object, "y", 0),
        readOptionalNumber(object, "width", 1),
        readOptionalNumber(object, "height", 1),
    };
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

std::vector<AudioTrack> readTracksOfType(
    const mpv_node& node,
    const std::string& type)
{
    std::vector<AudioTrack> tracks;
    if (node.format != MPV_FORMAT_NODE_ARRAY || !node.u.list) {
        return tracks;
    }

    for (int index = 0; index < node.u.list->num; index += 1) {
        const mpv_node& trackNode = node.u.list->values[index];
        const mpv_node* typeNode = getNodeMapValue(trackNode, "type");
        if (!typeNode || readNodeString(*typeNode) != type) {
            continue;
        }

        const mpv_node* idNode = getNodeMapValue(trackNode, "id");
        int64_t id = 0;
        if (!idNode || !readNodeInteger(*idNode, id)) {
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

        tracks.push_back(track);
    }

    return tracks;
}

void updateAudioTracksFromNode(SessionSnapshot& snapshot, const mpv_node& node)
{
    snapshot.audioTracks = readTracksOfType(node, "audio");
    snapshot.selectedAudioTrackId = -1;
    for (const auto& track : snapshot.audioTracks) {
        if (track.selected) {
            snapshot.selectedAudioTrackId = track.id;
            break;
        }
    }
}

void updateSubtitleTracksFromNode(SessionSnapshot& snapshot, const mpv_node& node)
{
    snapshot.subtitleTracks = readTracksOfType(node, "sub");
    snapshot.selectedSubtitleTrackId = -1;
    for (const auto& track : snapshot.subtitleTracks) {
        if (track.selected) {
            snapshot.selectedSubtitleTrackId = track.id;
            break;
        }
    }
}

bool reconcileRecordingPropertyReply(
    const std::shared_ptr<Session>& session,
    uint64_t requestId,
    int error)
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

bool reconcilePlaybackLoadReply(
    const std::shared_ptr<Session>& session,
    uint64_t requestId,
    int error)
{
    if (
        requestId == 0 ||
        requestId != session->pendingPlaybackLoadRequestId
    ) {
        return false;
    }

    session->pendingPlaybackLoadRequestId = 0;
    if (error < 0) {
        session->snapshot.status = SessionStatus::Error;
        session->snapshot.error = mpv_error_string(error);
    }
    return true;
}

void runEventLoop(std::shared_ptr<Session> session)
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
                break;
            case MPV_EVENT_FILE_LOADED:
                session->snapshot.status =
                    session->snapshot.status == SessionStatus::Paused
                        ? SessionStatus::Paused
                        : SessionStatus::Playing;
                session->snapshot.error.clear();
                break;
            case MPV_EVENT_END_FILE: {
                const auto* endFile =
                    static_cast<mpv_event_end_file*>(event->data);
                if (endFile && endFile->reason == MPV_END_FILE_REASON_ERROR) {
                    session->snapshot.status = SessionStatus::Error;
                    session->snapshot.error = endFile->error < 0
                        ? mpv_error_string(endFile->error)
                        : "Embedded MPV playback ended with an error.";
                }
                break;
            }
            case MPV_EVENT_PROPERTY_CHANGE: {
                const auto* property =
                    static_cast<mpv_event_property*>(event->data);
                if (!property || !property->name || !property->data) {
                    break;
                }
                const std::string name(property->name);
                if (name == "time-pos" && property->format == MPV_FORMAT_DOUBLE) {
                    session->snapshot.positionSeconds =
                        *static_cast<double*>(property->data);
                } else if (name == "duration" && property->format == MPV_FORMAT_DOUBLE) {
                    session->snapshot.durationSeconds =
                        *static_cast<double*>(property->data);
                } else if (name == "pause" && property->format == MPV_FORMAT_FLAG) {
                    const bool paused = *static_cast<int*>(property->data) != 0;
                    session->snapshot.status = paused
                        ? SessionStatus::Paused
                        : SessionStatus::Playing;
                    session->snapshot.error.clear();
                } else if (name == "volume" && property->format == MPV_FORMAT_DOUBLE) {
                    session->snapshot.volumePercent =
                        *static_cast<double*>(property->data);
                } else if (name == "path" && property->format == MPV_FORMAT_STRING) {
                    const char* value =
                        *static_cast<char**>(property->data);
                    session->snapshot.streamUrl = value ? value : "";
                } else if (name == "track-list" && property->format == MPV_FORMAT_NODE) {
                    const mpv_node& node =
                        *static_cast<mpv_node*>(property->data);
                    updateAudioTracksFromNode(session->snapshot, node);
                    updateSubtitleTracksFromNode(session->snapshot, node);
                } else if (name == "aid") {
                    const char* rawValue = property->format == MPV_FORMAT_STRING
                        ? *static_cast<char**>(property->data)
                        : nullptr;
                    const std::string value = rawValue ? rawValue : "";
                    int64_t trackId = -1;
                    if (parseIntegerString(value, trackId)) {
                        session->snapshot.selectedAudioTrackId = trackId;
                    }
                } else if (name == "sid") {
                    const char* rawValue = property->format == MPV_FORMAT_STRING
                        ? *static_cast<char**>(property->data)
                        : nullptr;
                    const std::string value = rawValue ? rawValue : "";
                    int64_t trackId = -1;
                    if (parseIntegerString(value, trackId)) {
                        session->snapshot.selectedSubtitleTrackId = trackId;
                    } else {
                        session->snapshot.selectedSubtitleTrackId = -1;
                    }
                } else if (name == "speed" && property->format == MPV_FORMAT_DOUBLE) {
                    session->snapshot.playbackSpeed =
                        *static_cast<double*>(property->data);
                } else if (name == "video-aspect-override" &&
                           property->format == MPV_FORMAT_STRING) {
                    const char* value =
                        *static_cast<char**>(property->data);
                    session->snapshot.aspectOverride =
                        value && value[0] ? value : "no";
                }
                break;
            }
            case MPV_EVENT_COMMAND_REPLY:
            case MPV_EVENT_SET_PROPERTY_REPLY:
                if (reconcilePlaybackLoadReply(
                        session,
                        event->reply_userdata,
                        event->error
                    )) {
                    break;
                }
                if (reconcileRecordingPropertyReply(
                        session,
                        event->reply_userdata,
                        event->error
                    )) {
                    break;
                }
                if (event->error < 0) {
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

void destroySession(const std::shared_ptr<Session>& session)
{
    if (!session) {
        return;
    }

    session->running.store(false);
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
        }
        mpv_wakeup(session->handle);
    }

    if (session->eventThread.joinable()) {
        session->eventThread.join();
    }

    if (session->handle) {
        mpv_terminate_destroy(session->handle);
        session->handle = nullptr;
    }

    session->host.destroy();
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.status = SessionStatus::Closed;
        session->snapshot.recordingActive = false;
        session->snapshot.recordingStartedAt.clear();
    }
}

Napi::Value IsSupported(const Napi::CallbackInfo& info)
{
    return Napi::Boolean::New(info.Env(), NativeVideoHost::isAvailable());
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
    if (windowHandleValue == 0) {
        throw Napi::Error::New(env, "Unable to resolve Electron native window handle.");
    }

    const auto bounds = readBounds(info[1].As<Napi::Object>());
    const auto session = std::make_shared<Session>();
    session->id = "embedded-mpv-" + std::to_string(gNextSessionId.fetch_add(1));
    session->snapshot.volumePercent =
        info.Length() >= 4 && info[3].IsNumber()
            ? clampVolumePercent(info[3].As<Napi::Number>().DoubleValue())
            : 100.0;

    if (!session->host.create(windowHandleValue, bounds)) {
        throw Napi::Error::New(env, NativeVideoHost::lastError());
    }

    session->handle = mpv_create();
    if (!session->handle) {
        session->host.destroy();
        throw Napi::Error::New(env, "Failed to create libmpv handle.");
    }

    const std::string wid = session->host.wid();
    mpv_set_option_string(session->handle, "terminal", "no");
    mpv_set_option_string(session->handle, "config", "no");
    mpv_set_option_string(session->handle, "osc", "no");
    mpv_set_option_string(session->handle, "idle", "yes");
    mpv_set_option_string(session->handle, "keep-open", "yes");
    mpv_set_option_string(session->handle, "input-default-bindings", "no");
    mpv_set_option_string(session->handle, "input-vo-keyboard", "no");
    mpv_set_option_string(session->handle, "ytdl", "no");
    mpv_set_option_string(session->handle, "wid", wid.c_str());
    mpv_set_option_string(session->handle, "vo", "gpu");
    mpv_set_option_string(session->handle, "hwdec", "auto-safe");

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
    session->host.setBounds(bounds);

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
        optionKeys[index] = const_cast<char*>(options[index].first.c_str());
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

    const uint64_t loadPlaybackRequestId = nextAsyncRequestId();
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.streamUrl = streamUrl;
        session->snapshot.error.clear();
        session->snapshot.status = SessionStatus::Loading;
        session->snapshot.recordingActive = false;
        session->snapshot.recordingTargetPath.clear();
        session->snapshot.recordingStartedAt.clear();
        session->snapshot.recordingError.clear();
        session->pendingPlaybackLoadRequestId = loadPlaybackRequestId;
    }

    const int commandResult = mpv_command_node_async(
        session->handle,
        loadPlaybackRequestId,
        &command
    );
    if (commandResult < 0) {
        {
            std::lock_guard<std::mutex> lock(session->mutex);
            session->pendingPlaybackLoadRequestId = 0;
        }
        updateSessionError(session, mpv_error_string(commandResult));
        throw Napi::Error::New(
            env,
            std::string("Failed to load playback: ") +
                mpv_error_string(commandResult)
        );
    }

    return env.Undefined();
}

Napi::Value SetBounds(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
        throw Napi::TypeError::New(env, "Expected session id and bounds object.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    session->host.setBounds(readBounds(info[1].As<Napi::Object>()));
    return env.Undefined();
}

Napi::Value SetPaused(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBoolean()) {
        throw Napi::TypeError::New(env, "Expected session id and paused flag.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    int paused = info[1].As<Napi::Boolean>().Value() ? 1 : 0;
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "pause",
        MPV_FORMAT_FLAG,
        &paused
    );
    if (result < 0) {
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

Napi::Value Seek(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and seek time.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    const std::string seconds =
        std::to_string(info[1].As<Napi::Number>().DoubleValue());
    const char* command[] = { "seek", seconds.c_str(), "absolute", nullptr };
    const int result = mpv_command_async(
        session->handle,
        nextAsyncRequestId(),
        command
    );
    if (result < 0) {
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

Napi::Value SetVolume(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and volume.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    double volume = clampVolumePercent(info[1].As<Napi::Number>().DoubleValue());
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "volume",
        MPV_FORMAT_DOUBLE,
        &volume
    );
    if (result < 0) {
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

Napi::Value SetAudioTrack(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and audio track id.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    int64_t trackId =
        static_cast<int64_t>(info[1].As<Napi::Number>().Int64Value());
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "aid",
        MPV_FORMAT_INT64,
        &trackId
    );
    if (result < 0) {
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

Napi::Value SetSubtitleTrack(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and subtitle track id.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    int64_t trackId =
        static_cast<int64_t>(info[1].As<Napi::Number>().Int64Value());
    int result = 0;
    if (trackId < 0) {
        const char* disabledValue = "no";
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
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

Napi::Value SetSpeed(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        throw Napi::TypeError::New(env, "Expected session id and playback speed.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    double speed = info[1].As<Napi::Number>().DoubleValue();
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "speed",
        MPV_FORMAT_DOUBLE,
        &speed
    );
    if (result < 0) {
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

Napi::Value SetAspect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        throw Napi::TypeError::New(env, "Expected session id and aspect override.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    const std::string aspect = info[1].As<Napi::String>().Utf8Value();
    const char* aspectValue = aspect.c_str();
    const int result = mpv_set_property_async(
        session->handle,
        nextAsyncRequestId(),
        "video-aspect-override",
        MPV_FORMAT_STRING,
        const_cast<char**>(&aspectValue)
    );
    if (result < 0) {
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

Napi::Value StartRecording(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        throw Napi::TypeError::New(env, "Expected session id and target path.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    const std::string targetPath = info[1].As<Napi::String>().Utf8Value();
    const char* targetValue = targetPath.c_str();
    const uint64_t requestId = nextAsyncRequestId();
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->pendingRecordingStartRequestId = requestId;
        session->pendingRecordingTargetPath = targetPath;
        session->pendingRecordingStartedAt = nowIsoString();
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
        std::lock_guard<std::mutex> lock(session->mutex);
        session->pendingRecordingStartRequestId = 0;
        session->pendingRecordingTargetPath.clear();
        session->pendingRecordingStartedAt.clear();
        session->snapshot.recordingError = mpv_error_string(result);
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

Napi::Value StopRecording(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "Expected session id.");
    }
    const auto session =
        getSessionOrThrow(env, info[0].As<Napi::String>().Utf8Value());
    const char* disabledValue = "";
    const uint64_t requestId = nextAsyncRequestId();
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->pendingRecordingStopRequestId = requestId;
        session->pendingRecordingStopStartedAt =
            session->snapshot.recordingStartedAt;
    }
    const int result = mpv_set_property_async(
        session->handle,
        requestId,
        "stream-record",
        MPV_FORMAT_STRING,
        const_cast<char**>(&disabledValue)
    );
    if (result < 0) {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->pendingRecordingStopRequestId = 0;
        session->pendingRecordingStopStartedAt.clear();
        session->snapshot.recordingError = mpv_error_string(result);
        throw Napi::Error::New(env, mpv_error_string(result));
    }
    return env.Undefined();
}

void writeTracks(
    Napi::Env env,
    Napi::Object result,
    const char* key,
    const std::vector<AudioTrack>& tracks)
{
    auto output = Napi::Array::New(env, tracks.size());
    for (size_t index = 0; index < tracks.size(); index += 1) {
        const AudioTrack& track = tracks[index];
        auto trackObject = Napi::Object::New(env);
        trackObject.Set("id", Napi::Number::New(env, track.id));
        if (!track.title.empty()) {
            trackObject.Set("title", Napi::String::New(env, track.title));
        }
        if (!track.language.empty()) {
            trackObject.Set("language", Napi::String::New(env, track.language));
        }
        trackObject.Set("selected", Napi::Boolean::New(env, track.selected));
        trackObject.Set("defaultTrack", Napi::Boolean::New(env, track.defaultTrack));
        trackObject.Set("forced", Napi::Boolean::New(env, track.forced));
        output.Set(index, trackObject);
    }
    result.Set(key, output);
}

Napi::Value GetSessionSnapshot(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "Expected session id.");
    }

    const auto session = findSession(info[0].As<Napi::String>().Utf8Value());
    if (!session) {
        return env.Null();
    }

    SessionSnapshot snapshot;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        snapshot = session->snapshot;
    }

    auto result = Napi::Object::New(env);
    result.Set("status", toStatusString(snapshot.status));
    result.Set("positionSeconds", Napi::Number::New(env, snapshot.positionSeconds));
    if (snapshot.durationSeconds < 0) {
        result.Set("durationSeconds", env.Null());
    } else {
        result.Set("durationSeconds", Napi::Number::New(env, snapshot.durationSeconds));
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
    writeTracks(env, result, "audioTracks", snapshot.audioTracks);
    if (snapshot.selectedSubtitleTrackId >= 0) {
        result.Set(
            "selectedSubtitleTrackId",
            Napi::Number::New(env, snapshot.selectedSubtitleTrackId)
        );
    } else {
        result.Set("selectedSubtitleTrackId", env.Null());
    }
    writeTracks(env, result, "subtitleTracks", snapshot.subtitleTracks);
    result.Set("playbackSpeed", Napi::Number::New(env, snapshot.playbackSpeed));
    result.Set("aspectOverride", Napi::String::New(env, snapshot.aspectOverride));
    if (
        snapshot.recordingActive ||
        !snapshot.recordingTargetPath.empty() ||
        !snapshot.recordingError.empty()
    ) {
        auto recording = Napi::Object::New(env);
        recording.Set("active", Napi::Boolean::New(env, snapshot.recordingActive));
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
            recording.Set("error", Napi::String::New(env, snapshot.recordingError));
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
    exports.Set("setSubtitleTrack", Napi::Function::New(env, SetSubtitleTrack));
    exports.Set("setSpeed", Napi::Function::New(env, SetSpeed));
    exports.Set("setAspect", Napi::Function::New(env, SetAspect));
    exports.Set("startRecording", Napi::Function::New(env, StartRecording));
    exports.Set("stopRecording", Napi::Function::New(env, StopRecording));
    exports.Set("getSessionSnapshot", Napi::Function::New(env, GetSessionSnapshot));
    exports.Set("disposeSession", Napi::Function::New(env, DisposeSession));
    return exports;
}

} // namespace

NODE_API_MODULE(embedded_mpv, Init)
