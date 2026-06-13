#pragma once

#include "embedded_mpv_wid_types.h"

#include <napi.h>

#include <mpv/client.h>

#ifdef IPTVNATOR_DYNAMIC_LIBMPV
#ifndef IPTVNATOR_MPV_SELECTANY
#ifdef MPV_SELECTANY
#define IPTVNATOR_MPV_SELECTANY MPV_SELECTANY
#elif defined(_WIN32)
#define IPTVNATOR_MPV_SELECTANY __declspec(selectany)
#else
#define IPTVNATOR_MPV_SELECTANY
#endif
#endif

#define IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(name) \
    IPTVNATOR_MPV_SELECTANY decltype(&name) pfn_##name = nullptr;

IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_command_async)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_command_node_async)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_create)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_error_string)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_initialize)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_observe_property)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_request_log_messages)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_set_option_string)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_set_property)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_set_property_async)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_terminate_destroy)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_wait_event)
IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL(mpv_wakeup)

#undef IPTVNATOR_DECLARE_MPV_DYNAMIC_SYMBOL

#define mpv_command_async pfn_mpv_command_async
#define mpv_command_node_async pfn_mpv_command_node_async
#define mpv_create pfn_mpv_create
#define mpv_error_string pfn_mpv_error_string
#define mpv_initialize pfn_mpv_initialize
#define mpv_observe_property pfn_mpv_observe_property
#define mpv_request_log_messages pfn_mpv_request_log_messages
#define mpv_set_option_string pfn_mpv_set_option_string
#define mpv_set_property pfn_mpv_set_property
#define mpv_set_property_async pfn_mpv_set_property_async
#define mpv_terminate_destroy pfn_mpv_terminate_destroy
#define mpv_wait_event pfn_mpv_wait_event
#define mpv_wakeup pfn_mpv_wakeup
#endif

#include <algorithm>
#include <atomic>
#include <charconv>
#include <chrono>
#include <cctype>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <system_error>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>
#ifdef __linux__
#include <csignal>
#include <dirent.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

#ifdef __linux__
extern char **environ;
#endif

namespace {

enum class SessionStatus {
    Idle,
    Loading,
    Playing,
    Paused,
    Ended,
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
#ifdef __linux__
    pid_t mpvProcessId = -1;
    std::string mpvIpcSocketPath;
#endif
};

std::atomic<uint64_t> gNextSessionId{1};
std::atomic<uint64_t> gNextAsyncRequestId{1};
#ifdef __linux__
std::atomic<uint64_t> gNextLinuxIpcSocketId{1};
#endif
std::mutex gSessionsMutex;
std::unordered_map<std::string, std::shared_ptr<Session>> gSessions;

void traceMpvCommon(const std::string& message)
{
    if (!std::getenv("IPTVNATOR_TRACE_EMBEDDED_MPV")) {
        return;
    }

    std::cerr << "[Embedded MPV] " << message << std::endl;
}

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
        case SessionStatus::Ended:
            return "ended";
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

std::string formatInvariantDouble(double value)
{
    if (!std::isfinite(value)) {
        return "0";
    }

    char buffer[64]{};
    const auto result = std::to_chars(
        buffer,
        buffer + sizeof(buffer),
        value,
        std::chars_format::general,
        17
    );
    if (result.ec != std::errc()) {
        return "0";
    }

    return std::string(buffer, result.ptr);
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

#ifdef __linux__
struct LinuxMpvProcess {
    pid_t processId = -1;
    std::string ipcSocketPath;
};

bool isExecutableAvailable(const char* executableName)
{
    const char* pathValue = std::getenv("PATH");
    if (!pathValue || !executableName || executableName[0] == '\0') {
        return false;
    }

    std::string paths(pathValue);
    size_t start = 0;
    while (start <= paths.size()) {
        const size_t end = paths.find(':', start);
        const std::string directory = paths.substr(
            start,
            end == std::string::npos ? std::string::npos : end - start
        );
        const std::string candidate =
            (directory.empty() ? "." : directory) + "/" + executableName;
        if (access(candidate.c_str(), X_OK) == 0) {
            return true;
        }
        if (end == std::string::npos) {
            break;
        }
        start = end + 1;
    }

    return false;
}

bool hasEnvPrefix(const std::string& entry, const char* prefix)
{
    return entry.rfind(prefix, 0) == 0;
}

std::vector<std::string> buildLinuxMpvEnvironment()
{
    std::vector<std::string> environment;
    bool hasXdgSessionType = false;

    for (char** current = environ; current && *current; current += 1) {
        const std::string entry(*current);

        if (hasEnvPrefix(entry, "WAYLAND_DISPLAY=")) {
            continue;
        }

        if (hasEnvPrefix(entry, "XDG_SESSION_TYPE=")) {
            environment.push_back("XDG_SESSION_TYPE=x11");
            hasXdgSessionType = true;
            continue;
        }

        environment.push_back(entry);
    }

    if (!hasXdgSessionType) {
        environment.push_back("XDG_SESSION_TYPE=x11");
    }

    return environment;
}

void updateLinuxProcessState(const std::shared_ptr<Session>& session)
{
    if (!session || !session->running.load()) {
        return;
    }

    pid_t processId = -1;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        processId = session->mpvProcessId;
    }
    if (processId <= 0) {
        return;
    }

    int status = 0;
    const pid_t result = waitpid(processId, &status, WNOHANG);
    if (result != processId) {
        return;
    }
    if (!session->running.load()) {
        return;
    }

    std::lock_guard<std::mutex> lock(session->mutex);
    if (session->mpvProcessId != processId) {
        return;
    }
    session->mpvProcessId = -1;
    session->snapshot.status =
        WIFEXITED(status) && WEXITSTATUS(status) == 0
            ? SessionStatus::Closed
            : SessionStatus::Error;
    if (session->snapshot.status == SessionStatus::Error) {
        session->snapshot.error = "Embedded MPV process exited unexpectedly.";
    }
}

void unlinkLinuxIpcSocket(const std::string& ipcSocketPath)
{
    if (!ipcSocketPath.empty()) {
        unlink(ipcSocketPath.c_str());
    }
}

LinuxMpvProcess takeLinuxMpvProcess(const std::shared_ptr<Session>& session)
{
    LinuxMpvProcess process;
    if (!session) {
        return process;
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        process.processId = session->mpvProcessId;
        session->mpvProcessId = -1;
        process.ipcSocketPath = session->mpvIpcSocketPath;
        session->mpvIpcSocketPath.clear();
    }

    return process;
}

void waitForLinuxMpvProcessExit(LinuxMpvProcess process)
{
    if (process.processId <= 0) {
        unlinkLinuxIpcSocket(process.ipcSocketPath);
        return;
    }

    for (int attempt = 0; attempt < 10; attempt += 1) {
        int status = 0;
        const pid_t result = waitpid(process.processId, &status, WNOHANG);
        if (result == process.processId || result == -1) {
            unlinkLinuxIpcSocket(process.ipcSocketPath);
            return;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    kill(process.processId, SIGKILL);
    waitpid(process.processId, nullptr, 0);
    unlinkLinuxIpcSocket(process.ipcSocketPath);
}

void terminateLinuxMpvProcessAsync(const std::shared_ptr<Session>& session)
{
    auto process = takeLinuxMpvProcess(session);
    if (process.processId <= 0) {
        unlinkLinuxIpcSocket(process.ipcSocketPath);
        return;
    }

    kill(process.processId, SIGTERM);
    std::thread([process = std::move(process)]() mutable {
        waitForLinuxMpvProcessExit(std::move(process));
    }).detach();
}

void appendLinuxMpvOption(
    std::vector<std::string>& arguments,
    const std::string& name,
    const std::string& value)
{
    if (!value.empty()) {
        arguments.push_back("--" + name + "=" + value);
    }
}

std::vector<std::string> buildLinuxMpvArguments(
    const std::shared_ptr<Session>& session,
    const Napi::Object& playback,
    const std::string& streamUrl,
    const std::string& title,
    const std::string& userAgent,
    const std::string& referer,
    double startTime,
    const std::string& ipcSocketPath)
{
    std::vector<std::string> arguments;
    arguments.reserve(24);
    arguments.push_back("mpv");
    arguments.push_back("--no-config");
    arguments.push_back("--no-terminal");
    arguments.push_back("--force-window=immediate");
    arguments.push_back("--osc=no");
    arguments.push_back("--input-default-bindings=no");
    arguments.push_back("--input-vo-keyboard=no");
    arguments.push_back("--ytdl=no");
    arguments.push_back("--keep-open=yes");
    arguments.push_back("--wid=" + session->host.wid());
    arguments.push_back("--input-ipc-server=" + ipcSocketPath);
    arguments.push_back("--vo=gpu,x11");
    arguments.push_back("--gpu-context=x11egl");

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        arguments.push_back(
            "--volume=" +
                formatInvariantDouble(session->snapshot.volumePercent)
        );
    }

    if (std::getenv("IPTVNATOR_TRACE_EMBEDDED_MPV")) {
        arguments.push_back("--msg-level=all=trace");
        arguments.push_back("--log-file=/tmp/iptvnator-embedded-mpv.log");
    } else {
        arguments.push_back("--really-quiet");
    }

    appendLinuxMpvOption(arguments, "force-media-title", title);
    appendLinuxMpvOption(arguments, "user-agent", userAgent);
    appendLinuxMpvOption(arguments, "referrer", referer);
    if (std::isfinite(startTime) && startTime >= 0) {
        appendLinuxMpvOption(
            arguments,
            "start",
            formatInvariantDouble(startTime)
        );
    }
    if (playback.Has("headers") && playback.Get("headers").IsObject()) {
        appendLinuxMpvOption(
            arguments,
            "http-header-fields",
            joinHeaderFields(playback.Get("headers").As<Napi::Object>())
        );
    }
    arguments.push_back(streamUrl);
    return arguments;
}

void closeInheritedFileDescriptors()
{
    DIR* directory = opendir("/proc/self/fd");
    if (directory) {
        const int directoryFd = dirfd(directory);
        while (dirent* entry = readdir(directory)) {
            char* end = nullptr;
            const long value = std::strtol(entry->d_name, &end, 10);
            if (
                !end ||
                *end != '\0' ||
                value <= STDERR_FILENO ||
                value > INT_MAX
            ) {
                continue;
            }

            const int descriptor = static_cast<int>(value);
            if (descriptor == directoryFd) {
                continue;
            }
            const int flags = fcntl(descriptor, F_GETFD);
            if (flags >= 0) {
                fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC);
            }
        }
        closedir(directory);
        return;
    }

    for (int descriptor = STDERR_FILENO + 1; descriptor < 1024; descriptor += 1) {
        const int flags = fcntl(descriptor, F_GETFD);
        if (flags >= 0) {
            fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC);
        }
    }
}

std::string buildLinuxIpcSocketPath(const std::shared_ptr<Session>& session)
{
    std::string safeSessionId = session ? session->id : "unknown";
    for (char& character : safeSessionId) {
        if (!std::isalnum(static_cast<unsigned char>(character))) {
            character = '-';
        }
    }

    return "/tmp/iptvnator-embedded-mpv-" +
        std::to_string(static_cast<long>(getpid())) +
        "-" + safeSessionId +
        "-" + std::to_string(gNextLinuxIpcSocketId.fetch_add(1)) + ".sock";
}

bool writeAll(int fileDescriptor, const std::string& payload)
{
    const char* current = payload.c_str();
    size_t remaining = payload.size();

    while (remaining > 0) {
        const ssize_t written = write(fileDescriptor, current, remaining);
        if (written <= 0) {
            return false;
        }
        current += written;
        remaining -= static_cast<size_t>(written);
    }

    return true;
}

bool readLine(int fileDescriptor, std::string& output)
{
    output.clear();
    char buffer[512];

    while (output.find('\n') == std::string::npos) {
        const ssize_t received = read(fileDescriptor, buffer, sizeof(buffer));
        if (received <= 0) {
            return !output.empty();
        }
        output.append(buffer, static_cast<size_t>(received));
    }

    const size_t newline = output.find('\n');
    if (newline != std::string::npos) {
        output.erase(newline + 1);
    }
    return true;
}

bool transactLinuxMpvIpc(
    const std::string& socketPath,
    const std::string& payload,
    std::string& response)
{
    if (socketPath.empty() || socketPath.size() >= sizeof(sockaddr_un::sun_path)) {
        return false;
    }

    const int fileDescriptor = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fileDescriptor < 0) {
        return false;
    }

    timeval timeout{};
    timeout.tv_sec = 0;
    timeout.tv_usec = 250000;
    setsockopt(fileDescriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fileDescriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));

    sockaddr_un address{};
    address.sun_family = AF_UNIX;
    std::strncpy(address.sun_path, socketPath.c_str(), sizeof(address.sun_path) - 1);

    bool ok = connect(
        fileDescriptor,
        reinterpret_cast<sockaddr*>(&address),
        sizeof(address)
    ) == 0;
    if (ok) {
        ok = writeAll(fileDescriptor, payload) && readLine(fileDescriptor, response);
    }

    close(fileDescriptor);
    return ok;
}

std::optional<std::string> parseJsonDataToken(const std::string& response)
{
    const size_t key = response.find("\"data\"");
    if (key == std::string::npos) {
        return std::nullopt;
    }
    const size_t colon = response.find(':', key);
    if (colon == std::string::npos) {
        return std::nullopt;
    }

    size_t start = colon + 1;
    while (start < response.size() &&
           std::isspace(static_cast<unsigned char>(response[start]))) {
        start += 1;
    }
    if (start >= response.size()) {
        return std::nullopt;
    }

    if (response.compare(start, 4, "null") == 0) {
        return std::nullopt;
    }

    if (response[start] == '"') {
        size_t end = start + 1;
        while (end < response.size()) {
            if (response[end] == '"' && response[end - 1] != '\\') {
                break;
            }
            end += 1;
        }
        if (end >= response.size()) {
            return std::nullopt;
        }
        return response.substr(start + 1, end - start - 1);
    }

    size_t end = start;
    while (end < response.size() &&
           response[end] != ',' &&
           response[end] != '}' &&
           !std::isspace(static_cast<unsigned char>(response[end]))) {
        end += 1;
    }

    return response.substr(start, end - start);
}

std::optional<double> parseJsonDataNumber(const std::string& response)
{
    const auto token = parseJsonDataToken(response);
    if (!token) {
        return std::nullopt;
    }

    char* end = nullptr;
    const double value = std::strtod(token->c_str(), &end);
    if (end == token->c_str() || !std::isfinite(value)) {
        return std::nullopt;
    }

    return value;
}

std::optional<bool> parseJsonDataBoolean(const std::string& response)
{
    const auto token = parseJsonDataToken(response);
    if (!token) {
        return std::nullopt;
    }
    if (*token == "true") {
        return true;
    }
    if (*token == "false") {
        return false;
    }
    return std::nullopt;
}

std::optional<std::string> parseJsonDataString(const std::string& response)
{
    return parseJsonDataToken(response);
}

std::optional<double> queryLinuxMpvNumber(
    const std::string& socketPath,
    const std::string& propertyName)
{
    std::string response;
    if (!transactLinuxMpvIpc(
            socketPath,
            "{\"command\":[\"get_property\",\"" + propertyName + "\"]}\n",
            response
        )) {
        return std::nullopt;
    }

    return parseJsonDataNumber(response);
}

std::optional<bool> queryLinuxMpvBoolean(
    const std::string& socketPath,
    const std::string& propertyName)
{
    std::string response;
    if (!transactLinuxMpvIpc(
            socketPath,
            "{\"command\":[\"get_property\",\"" + propertyName + "\"]}\n",
            response
        )) {
        return std::nullopt;
    }

    return parseJsonDataBoolean(response);
}

std::optional<std::string> queryLinuxMpvString(
    const std::string& socketPath,
    const std::string& propertyName)
{
    std::string response;
    if (!transactLinuxMpvIpc(
            socketPath,
            "{\"command\":[\"get_property\",\"" + propertyName + "\"]}\n",
            response
        )) {
        return std::nullopt;
    }

    return parseJsonDataString(response);
}

bool sendLinuxMpvCommand(
    const std::string& socketPath,
    const std::string& command)
{
    std::string response;
    return transactLinuxMpvIpc(socketPath, command, response);
}

void refreshLinuxMpvSnapshot(const std::shared_ptr<Session>& session)
{
    updateLinuxProcessState(session);
    if (!session || !session->running.load()) {
        return;
    }

    std::string socketPath;
    pid_t processId = -1;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        socketPath = session->mpvIpcSocketPath;
        processId = session->mpvProcessId;
    }
    if (processId <= 0 || socketPath.empty()) {
        return;
    }

    const auto position = queryLinuxMpvNumber(socketPath, "time-pos");
    const auto duration = queryLinuxMpvNumber(socketPath, "duration");
    const auto volume = queryLinuxMpvNumber(socketPath, "volume");
    const auto paused = queryLinuxMpvBoolean(socketPath, "pause");
    const auto path = queryLinuxMpvString(socketPath, "path");

    std::lock_guard<std::mutex> lock(session->mutex);
    if (
        !session->running.load() ||
        session->mpvProcessId != processId ||
        session->mpvIpcSocketPath != socketPath
    ) {
        return;
    }
    if (position) {
        session->snapshot.positionSeconds = std::max(0.0, *position);
    }
    if (duration) {
        session->snapshot.durationSeconds = std::max(0.0, *duration);
    }
    if (volume) {
        session->snapshot.volumePercent =
            std::max(0.0, std::min(100.0, *volume));
    }
    if (paused) {
        session->snapshot.status =
            *paused ? SessionStatus::Paused : SessionStatus::Playing;
        session->snapshot.error.clear();
    }
    if (path && !path->empty()) {
        session->snapshot.streamUrl = *path;
    }
}

void runLinuxProcessPollLoop(std::shared_ptr<Session> session)
{
    while (session && session->running.load()) {
        refreshLinuxMpvSnapshot(session);
        for (int tick = 0; tick < 10 && session->running.load(); tick += 1) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    }
}

bool startLinuxProcessPolling(const std::shared_ptr<Session>& session)
{
    if (!session) {
        return false;
    }

    bool expected = false;
    if (!session->running.compare_exchange_strong(expected, true)) {
        return true;
    }

    try {
        session->eventThread = std::thread(runLinuxProcessPollLoop, session);
    } catch (...) {
        session->running.store(false);
        return false;
    }

    return true;
}

pid_t spawnLinuxMpvProcess(
    const std::vector<std::string>& arguments,
    const std::vector<std::string>& environment)
{
    std::vector<char*> argv;
    argv.reserve(arguments.size() + 1);
    for (const auto& argument : arguments) {
        argv.push_back(const_cast<char*>(argument.c_str()));
    }
    argv.push_back(nullptr);

    std::vector<char*> envp;
    envp.reserve(environment.size() + 1);
    for (const auto& entry : environment) {
        envp.push_back(const_cast<char*>(entry.c_str()));
    }
    envp.push_back(nullptr);

    const bool traceEnabled = std::getenv("IPTVNATOR_TRACE_EMBEDDED_MPV");
    const pid_t processId = fork();
    if (processId != 0) {
        return processId;
    }

    if (!traceEnabled) {
        const int nullFd = open("/dev/null", O_RDWR);
        if (nullFd >= 0) {
            dup2(nullFd, STDOUT_FILENO);
            dup2(nullFd, STDERR_FILENO);
            if (nullFd > STDERR_FILENO) {
                close(nullFd);
            }
        }
    }

    closeInheritedFileDescriptors();
    execvpe(argv[0], argv.data(), envp.data());
    _exit(127);
}

void loadLinuxProcessPlayback(
    Napi::Env env,
    const std::shared_ptr<Session>& session,
    const Napi::Object& playback,
    const std::string& streamUrl,
    const std::string& title,
    const std::string& userAgent,
    const std::string& referer,
    double startTime)
{
    terminateLinuxMpvProcessAsync(session);
    const auto ipcSocketPath = buildLinuxIpcSocketPath(session);
    unlink(ipcSocketPath.c_str());
    const auto arguments = buildLinuxMpvArguments(
        session,
        playback,
        streamUrl,
        title,
        userAgent,
        referer,
        startTime,
        ipcSocketPath
    );
    const auto environment = buildLinuxMpvEnvironment();

    const pid_t processId = spawnLinuxMpvProcess(arguments, environment);
    if (processId < 0) {
        throw Napi::Error::New(env, "Failed to start embedded MPV process.");
    }

    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->mpvProcessId = processId;
        session->mpvIpcSocketPath = ipcSocketPath;
        session->snapshot.positionSeconds = std::max(0.0, startTime);
        session->snapshot.durationSeconds = -1.0;
        session->snapshot.streamUrl = streamUrl;
        session->snapshot.error.clear();
        session->snapshot.status = SessionStatus::Playing;
        session->snapshot.audioTracks.clear();
        session->snapshot.selectedAudioTrackId = -1;
        session->snapshot.subtitleTracks.clear();
        session->snapshot.selectedSubtitleTrackId = -1;
        session->snapshot.playbackSpeed = 1.0;
        session->snapshot.aspectOverride = "no";
        session->snapshot.recordingActive = false;
        session->snapshot.recordingTargetPath.clear();
        session->snapshot.recordingStartedAt.clear();
        session->snapshot.recordingError.clear();
    }
    if (!startLinuxProcessPolling(session)) {
        terminateLinuxMpvProcessAsync(session);
        throw Napi::Error::New(
            env,
            "Failed to start embedded MPV snapshot polling."
        );
    }
}
#endif

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
                } else if (
                    endFile &&
                    endFile->reason == MPV_END_FILE_REASON_EOF &&
                    session->running.load()) {
                    session->snapshot.status = SessionStatus::Ended;
                } else if (
                    endFile &&
                    endFile->reason == MPV_END_FILE_REASON_REDIRECT &&
                    session->running.load()) {
                    session->snapshot.status = SessionStatus::Loading;
                    session->snapshot.error.clear();
                } else if (session->running.load()) {
                    session->snapshot.status = SessionStatus::Idle;
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
                    if (
                        session->snapshot.status != SessionStatus::Loading &&
                        session->snapshot.status != SessionStatus::Ended &&
                        session->snapshot.status != SessionStatus::Error
                    ) {
                        session->snapshot.status = paused
                            ? SessionStatus::Paused
                            : SessionStatus::Playing;
                        session->snapshot.error.clear();
                    }
                } else if (name == "eof-reached" && property->format == MPV_FORMAT_FLAG) {
                    const bool eofReached =
                        *static_cast<int*>(property->data) != 0;
                    if (eofReached && session->running.load()) {
                        session->snapshot.status = SessionStatus::Ended;
                    }
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

#ifdef __linux__
    session->running.store(false);
    terminateLinuxMpvProcessAsync(session);
    if (session->eventThread.joinable()) {
        session->eventThread.detach();
    }
    session->host.destroy();
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        session->snapshot.status = SessionStatus::Closed;
        session->snapshot.recordingActive = false;
        session->snapshot.recordingStartedAt.clear();
    }
    return;
#endif
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
    bool supported = NativeVideoHost::isAvailable();
#ifdef __linux__
    supported = supported && isExecutableAvailable("mpv");
#endif
    return Napi::Boolean::New(info.Env(), supported);
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
    const auto windowHandleLength = windowHandle.Length();
    if (windowHandleLength == 0) {
        throw Napi::Error::New(env, "Native window handle buffer is empty.");
    }

    uintptr_t windowHandleValue = 0;
    std::memcpy(
        &windowHandleValue,
        windowHandle.Data(),
        std::min(windowHandleLength, sizeof(uintptr_t))
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

    traceMpvCommon("creating native video host");
    if (!session->host.create(windowHandleValue, bounds)) {
        throw Napi::Error::New(env, NativeVideoHost::lastError());
    }
    traceMpvCommon("native video host created");

#ifdef __linux__
    session->host.setBounds(bounds);
    {
        std::lock_guard<std::mutex> sessionsLock(gSessionsMutex);
        gSessions.emplace(session->id, session);
    }
    return Napi::String::New(env, session->id);
#endif

    traceMpvCommon("creating libmpv handle");
    session->handle = mpv_create();
    if (!session->handle) {
        session->host.destroy();
        throw Napi::Error::New(env, "Failed to create libmpv handle.");
    }
    traceMpvCommon("libmpv handle created");

    traceMpvCommon("resolving native video host id");
    const std::string wid = session->host.wid();
    traceMpvCommon("native video host id resolved");
    traceMpvCommon("setting libmpv options");
    mpv_set_option_string(session->handle, "terminal", "no");
    mpv_set_option_string(session->handle, "config", "no");
    mpv_set_option_string(session->handle, "osc", "no");
    mpv_set_option_string(session->handle, "idle", "yes");
    mpv_set_option_string(session->handle, "keep-open", "yes");
    mpv_set_option_string(session->handle, "input-default-bindings", "no");
    mpv_set_option_string(session->handle, "input-vo-keyboard", "no");
    mpv_set_option_string(session->handle, "ytdl", "no");
    mpv_set_option_string(session->handle, "wid", wid.c_str());
#ifdef __linux__
    mpv_set_option_string(session->handle, "vo", "x11");
    mpv_set_option_string(session->handle, "hwdec", "no");
#else
    mpv_set_option_string(session->handle, "vo", "gpu");
    mpv_set_option_string(session->handle, "hwdec", "auto-safe");
#endif
    if (std::getenv("IPTVNATOR_TRACE_EMBEDDED_MPV")) {
        mpv_set_option_string(session->handle, "msg-level", "all=trace");
        mpv_set_option_string(
            session->handle,
            "log-file",
            "/tmp/iptvnator-embedded-mpv.log"
        );
    }

    const auto initialVolume = formatInvariantDouble(
        session->snapshot.volumePercent
    );
    mpv_set_option_string(session->handle, "volume", initialVolume.c_str());
    mpv_request_log_messages(session->handle, "warn");

    traceMpvCommon("initializing libmpv");
    const int initializeResult = mpv_initialize(session->handle);
    if (initializeResult < 0) {
        destroySession(session);
        throw Napi::Error::New(
            env,
            std::string("Failed to initialize libmpv: ") +
                mpv_error_string(initializeResult)
        );
    }
    traceMpvCommon("libmpv initialized");

    traceMpvCommon("observing libmpv properties");
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
    mpv_observe_property(session->handle, 11, "eof-reached", MPV_FORMAT_FLAG);

    session->running.store(true);
    session->eventThread = std::thread(runEventLoop, session);
    session->host.setBounds(bounds);
    traceMpvCommon("session event loop started");

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

#ifdef __linux__
    loadLinuxProcessPlayback(
        env,
        session,
        playback,
        streamUrl,
        title,
        userAgent,
        referer,
        startTime
    );
    return env.Undefined();
#endif

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
#ifdef __linux__
    std::string socketPath;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        socketPath = session->mpvIpcSocketPath;
        session->snapshot.status =
            paused ? SessionStatus::Paused : SessionStatus::Playing;
    }
    if (!socketPath.empty()) {
        sendLinuxMpvCommand(
            socketPath,
            std::string("{\"command\":[\"set_property\",\"pause\",") +
                (paused ? "true" : "false") + "]}\n"
        );
    }
    return env.Undefined();
#endif
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
    const std::string seconds = formatInvariantDouble(
        info[1].As<Napi::Number>().DoubleValue()
    );
#ifdef __linux__
    std::string socketPath;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        socketPath = session->mpvIpcSocketPath;
        session->snapshot.positionSeconds =
            std::max(0.0, info[1].As<Napi::Number>().DoubleValue());
    }
    if (!socketPath.empty()) {
        sendLinuxMpvCommand(
            socketPath,
            "{\"command\":[\"seek\"," + seconds + ",\"absolute\"]}\n"
        );
    }
    return env.Undefined();
#endif
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
#ifdef __linux__
    std::string socketPath;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        socketPath = session->mpvIpcSocketPath;
        session->snapshot.volumePercent = volume;
    }
    if (!socketPath.empty()) {
        sendLinuxMpvCommand(
            socketPath,
            "{\"command\":[\"set_property\",\"volume\"," +
                formatInvariantDouble(volume) + "]}\n"
        );
    }
    return env.Undefined();
#endif
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
#ifdef __linux__
    std::string socketPath;
    {
        std::lock_guard<std::mutex> lock(session->mutex);
        socketPath = session->mpvIpcSocketPath;
        session->snapshot.selectedAudioTrackId = trackId;
    }
    if (!socketPath.empty()) {
        sendLinuxMpvCommand(
            socketPath,
            "{\"command\":[\"set_property\",\"aid\"," +
                std::to_string(trackId) + "]}\n"
        );
    }
    return env.Undefined();
#endif
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

[[maybe_unused]] Napi::Value SetSubtitleTrack(const Napi::CallbackInfo& info)
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

[[maybe_unused]] Napi::Value SetSpeed(const Napi::CallbackInfo& info)
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

[[maybe_unused]] Napi::Value SetAspect(const Napi::CallbackInfo& info)
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

[[maybe_unused]] Napi::Value StartRecording(const Napi::CallbackInfo& info)
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

[[maybe_unused]] Napi::Value StopRecording(const Napi::CallbackInfo& info)
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
#ifndef __linux__
    exports.Set("setSubtitleTrack", Napi::Function::New(env, SetSubtitleTrack));
    exports.Set("setSpeed", Napi::Function::New(env, SetSpeed));
    exports.Set("setAspect", Napi::Function::New(env, SetAspect));
    exports.Set("startRecording", Napi::Function::New(env, StartRecording));
    exports.Set("stopRecording", Napi::Function::New(env, StopRecording));
#endif
    exports.Set("getSessionSnapshot", Napi::Function::New(env, GetSessionSnapshot));
    exports.Set("disposeSession", Napi::Function::New(env, DisposeSession));
    return exports;
}

} // namespace

NODE_API_MODULE(embedded_mpv, Init)
