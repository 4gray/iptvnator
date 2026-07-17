/*
 * iptvnator-mpv-helper — frame-copy embedded MPV helper process
 * (macOS + Linux + Windows; platform GL context in frame_helper_gl.h).
 *
 * One process = one playback session. Owns libmpv end to end: decodes,
 * renders offscreen at viewport size, publishes BGRA frames into a shared
 * memory ring (frame_shm.h), and plays audio directly through the OS.
 *
 * Control protocol: tab-separated commands on stdin, JSON events on stdout
 * (see frame_helper_io.h). The `snapshot` event mirrors the TypeScript
 * NativeEmbeddedMpvSessionSnapshot shape so the Electron-side adapter can
 * cache it verbatim. Status semantics are ported from embedded_mpv.mm:
 * END_FILE reason mapping, eof-reached => ended (keep-open), pause flag
 * gated on a loaded path, only fatal/load errors flip the status.
 *
 * Usage:
 *   iptvnator_mpv_helper --shm-base /impv-<id> --width 1280 --height 720
 *                        [--volume 0..1] [--hwdec auto]
 */
#include <mpv/client.h>

#include <algorithm>
#include <atomic>
#include <clocale>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "frame_helper_io.h"
#include "frame_helper_render.h"

namespace {

using frame_helper::Command;
using frame_helper::emitLine;
using frame_helper::GlContext;
using frame_helper::JsonWriter;
using frame_helper::RenderPipeline;

struct TrackInfo {
    int64_t id = -1;
    std::string title;
    std::string language;
    bool defaultTrack = false;
    bool forced = false;
};

struct SnapshotState {
    std::string status = "idle";
    double positionSeconds = 0;
    double durationSeconds = -1; /* <0 => null */
    double volume = 1;           /* 0..1 */
    int64_t videoWidth = 0;      /* mpv dwidth/dheight; 0 = unknown */
    int64_t videoHeight = 0;
    std::string streamUrl;
    std::vector<TrackInfo> audioTracks;
    int64_t selectedAudioTrackId = -1;
    std::vector<TrackInfo> subtitleTracks;
    int64_t selectedSubtitleTrackId = -1;
    double playbackSpeed = 1;
    std::string aspectOverride = "no";
    bool recordingActive = false;
    std::string recordingTargetPath;
    std::string recordingStartedAt;
    std::string recordingError;
    std::string error;
};

struct HelperState {
    mpv_handle* mpv = nullptr;
    RenderPipeline pipeline;

    std::mutex mutex;
    SnapshotState snapshot;
    bool paused = false;
    bool loadedPath = false;
    bool dirty = true;
    std::string lastEmittedStatus;
    uint64_t lastEmitNs = 0;
    /* Requested viewport in device pixels; the render target is the
     * aspect-fit of the video inside it so letterbox bars are never
     * rendered (and frames stay as small as possible). */
    int viewportWidth = 0;
    int viewportHeight = 0;

    std::atomic<bool> running{true};
};

HelperState g_state;

constexpr uint64_t SNAPSHOT_EMIT_INTERVAL_NS = 250ull * 1000 * 1000;

std::string isoTimestampNow() {
    char buffer[32];
    const time_t now = time(nullptr);
    struct tm utc;
#if defined(_WIN32)
    gmtime_s(&utc, &now);
#else
    gmtime_r(&now, &utc);
#endif
    strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
    return buffer;
}

std::string tracksJson(const std::vector<TrackInfo>& tracks,
                       int64_t selectedId) {
    std::string out = "[";
    bool first = true;
    for (const TrackInfo& track : tracks) {
        JsonWriter writer;
        writer.num("id", (double)track.id);
        if (!track.title.empty()) writer.str("title", track.title);
        if (!track.language.empty()) writer.str("language", track.language);
        writer.boolean("selected", track.id == selectedId);
        writer.boolean("defaultTrack", track.defaultTrack);
        writer.boolean("forced", track.forced);
        if (!first) out += ',';
        first = false;
        out += writer.finish();
    }
    out += ']';
    return out;
}

/* Compose the snapshot event. Caller holds g_state.mutex. */
std::string composeSnapshotLocked() {
    const SnapshotState& s = g_state.snapshot;
    JsonWriter writer;
    writer.str("event", "snapshot");
    writer.str("status", s.status);
    writer.num("positionSeconds", std::max(0.0, s.positionSeconds));
    if (s.videoWidth > 0 && s.videoHeight > 0) {
        writer.num("videoWidth", (double)s.videoWidth);
        writer.num("videoHeight", (double)s.videoHeight);
    }
    if (s.durationSeconds >= 0) {
        writer.num("durationSeconds", s.durationSeconds);
    } else {
        writer.nullValue("durationSeconds");
    }
    writer.num("volume", std::clamp(s.volume, 0.0, 1.5));
    writer.str("streamUrl", s.streamUrl);
    writer.raw("audioTracks", tracksJson(s.audioTracks, s.selectedAudioTrackId));
    if (s.selectedAudioTrackId >= 0) {
        writer.num("selectedAudioTrackId", (double)s.selectedAudioTrackId);
    } else {
        writer.nullValue("selectedAudioTrackId");
    }
    writer.raw("subtitleTracks",
               tracksJson(s.subtitleTracks, s.selectedSubtitleTrackId));
    if (s.selectedSubtitleTrackId >= 0) {
        writer.num("selectedSubtitleTrackId",
                   (double)s.selectedSubtitleTrackId);
    } else {
        writer.nullValue("selectedSubtitleTrackId");
    }
    writer.num("playbackSpeed", s.playbackSpeed);
    writer.str("aspectOverride", s.aspectOverride);
    JsonWriter recording;
    recording.boolean("active", s.recordingActive);
    if (!s.recordingTargetPath.empty())
        recording.str("targetPath", s.recordingTargetPath);
    if (!s.recordingStartedAt.empty())
        recording.str("startedAt", s.recordingStartedAt);
    if (!s.recordingError.empty()) recording.str("error", s.recordingError);
    writer.raw("recording", recording.finish());
    if (!s.error.empty()) writer.str("error", s.error);
    return writer.finish();
}

/* Emit the snapshot when dirty: immediately on status changes, otherwise at
 * most every SNAPSHOT_EMIT_INTERVAL_NS. Called from the mpv event thread. */
void maybeEmitSnapshot(bool force = false) {
    std::string line;
    {
        std::lock_guard<std::mutex> lock(g_state.mutex);
        if (!g_state.dirty && !force) return;
        const uint64_t now = frame_helper::nowNs();
        const bool statusChanged =
            g_state.snapshot.status != g_state.lastEmittedStatus;
        if (!force && !statusChanged &&
            now - g_state.lastEmitNs < SNAPSHOT_EMIT_INTERVAL_NS) {
            return;
        }
        g_state.dirty = false;
        g_state.lastEmitNs = now;
        g_state.lastEmittedStatus = g_state.snapshot.status;
        line = composeSnapshotLocked();
    }
    emitLine(line);
}

void markDirtyLocked() { g_state.dirty = true; }

/* Aspect-fit of the current video inside the requested viewport. Caller
 * holds g_state.mutex. Letterbox bars are handled by the renderer layout,
 * not baked into frames. */
std::pair<int, int> computeRenderSizeLocked() {
    const int vpW = g_state.viewportWidth;
    const int vpH = g_state.viewportHeight;
    const int64_t vw = g_state.snapshot.videoWidth;
    const int64_t vh = g_state.snapshot.videoHeight;
    if (vw < 16 || vh < 16 || vpW < 16 || vpH < 16) {
        return {vpW, vpH};
    }
    const double scale =
        std::min(vpW / (double)vw, vpH / (double)vh);
    const int width =
        std::max(16, (int)llround((double)vw * scale)) & ~1;
    const int height =
        std::max(16, (int)llround((double)vh * scale)) & ~1;
    return {width, height};
}

void applyRenderSizeLocked() {
    const auto [width, height] = computeRenderSizeLocked();
    if (width >= 16 && height >= 16) {
        g_state.pipeline.requestResize(width, height);
    }
}

/* ---- track-list parsing (ported from embedded_mpv.mm) ------------------- */

void parseTrackNode(const mpv_node& trackNode, const char* wantedType,
                    std::vector<TrackInfo>& out) {
    if (trackNode.format != MPV_FORMAT_NODE_MAP || !trackNode.u.list) return;
    TrackInfo track;
    bool matchesType = false;
    const mpv_node_list& map = *trackNode.u.list;
    for (int i = 0; i < map.num; i++) {
        const char* key = map.keys[i];
        const mpv_node& value = map.values[i];
        if (!key) continue;
        if (std::strcmp(key, "type") == 0 &&
            value.format == MPV_FORMAT_STRING && value.u.string) {
            matchesType = std::strcmp(value.u.string, wantedType) == 0;
        } else if (std::strcmp(key, "id") == 0 &&
                   value.format == MPV_FORMAT_INT64) {
            track.id = value.u.int64;
        } else if (std::strcmp(key, "title") == 0 &&
                   value.format == MPV_FORMAT_STRING && value.u.string) {
            track.title = value.u.string;
        } else if (std::strcmp(key, "lang") == 0 &&
                   value.format == MPV_FORMAT_STRING && value.u.string) {
            track.language = value.u.string;
        } else if (std::strcmp(key, "default") == 0 &&
                   value.format == MPV_FORMAT_FLAG) {
            track.defaultTrack = value.u.flag != 0;
        } else if (std::strcmp(key, "forced") == 0 &&
                   value.format == MPV_FORMAT_FLAG) {
            track.forced = value.u.flag != 0;
        }
    }
    if (matchesType && track.id >= 0) {
        out.push_back(std::move(track));
    }
}

void updateTracksFromNode(const mpv_node& trackListNode) {
    if (trackListNode.format != MPV_FORMAT_NODE_ARRAY ||
        !trackListNode.u.list) {
        return;
    }
    std::vector<TrackInfo> audio;
    std::vector<TrackInfo> subs;
    for (int i = 0; i < trackListNode.u.list->num; i++) {
        parseTrackNode(trackListNode.u.list->values[i], "audio", audio);
        parseTrackNode(trackListNode.u.list->values[i], "sub", subs);
    }
    g_state.snapshot.audioTracks = std::move(audio);
    g_state.snapshot.subtitleTracks = std::move(subs);
}

bool parseTrackSelection(const char* value, int64_t& out) {
    if (!value) return false;
    char* end = nullptr;
    const long long parsed = strtoll(value, &end, 10);
    if (end == value || (end && *end != '\0')) return false;
    out = parsed;
    return true;
}

/* ---- mpv event loop (status semantics ported from embedded_mpv.mm) ------ */

void handlePropertyChange(const mpv_event_property& property) {
    const std::string name = property.name ? property.name : "";
    SnapshotState& s = g_state.snapshot;

    if (name == "time-pos" && property.format == MPV_FORMAT_DOUBLE &&
        property.data) {
        s.positionSeconds = *static_cast<double*>(property.data);
    } else if (name == "duration" && property.format == MPV_FORMAT_DOUBLE &&
               property.data) {
        s.durationSeconds = *static_cast<double*>(property.data);
    } else if (name == "pause" && property.format == MPV_FORMAT_FLAG &&
               property.data) {
        g_state.paused = *static_cast<int*>(property.data) != 0;
        if (s.status != "loading" && s.status != "ended" &&
            s.status != "error" && g_state.loadedPath) {
            s.status = g_state.paused ? "paused" : "playing";
        }
    } else if (name == "eof-reached" && property.format == MPV_FORMAT_FLAG &&
               property.data) {
        if (*static_cast<int*>(property.data) != 0 && g_state.loadedPath) {
            s.status = "ended";
        }
    } else if (name == "volume" && property.format == MPV_FORMAT_DOUBLE &&
               property.data) {
        s.volume = *static_cast<double*>(property.data) / 100.0;
    } else if (name == "path" && property.format == MPV_FORMAT_STRING &&
               property.data) {
        const char* value = *static_cast<char**>(property.data);
        s.streamUrl = value ? value : "";
    } else if (name == "track-list" && property.format == MPV_FORMAT_NODE &&
               property.data) {
        updateTracksFromNode(*static_cast<mpv_node*>(property.data));
    } else if (name == "aid" && property.format == MPV_FORMAT_STRING &&
               property.data) {
        int64_t selected = -1;
        if (parseTrackSelection(*static_cast<char**>(property.data),
                                selected)) {
            s.selectedAudioTrackId = selected;
        } else {
            s.selectedAudioTrackId = -1;
        }
    } else if (name == "sid" && property.format == MPV_FORMAT_STRING &&
               property.data) {
        int64_t selected = -1;
        if (parseTrackSelection(*static_cast<char**>(property.data),
                                selected)) {
            s.selectedSubtitleTrackId = selected;
        } else {
            s.selectedSubtitleTrackId = -1;
        }
    } else if (name == "speed" && property.format == MPV_FORMAT_DOUBLE &&
               property.data) {
        s.playbackSpeed = *static_cast<double*>(property.data);
    } else if ((name == "dwidth" || name == "dheight") &&
               property.format == MPV_FORMAT_INT64 && property.data) {
        const int64_t value = *static_cast<int64_t*>(property.data);
        if (name == "dwidth") {
            s.videoWidth = value;
        } else {
            s.videoHeight = value;
        }
        applyRenderSizeLocked();
    } else if (name == "video-aspect-override" &&
               property.format == MPV_FORMAT_STRING && property.data) {
        const char* value = *static_cast<char**>(property.data);
        /* mpv reports the unset override as "-1.000000"; the renderer
         * contract uses "no" for that state. */
        s.aspectOverride =
            value && *value && std::atof(value) > 0 ? value : "no";
    } else {
        return;
    }
    markDirtyLocked();
}

void runMpvEventLoop() {
    while (g_state.running.load()) {
        mpv_event* event = mpv_wait_event(g_state.mpv, 0.1);
        if (!event) continue;
        if (event->event_id == MPV_EVENT_NONE) {
            maybeEmitSnapshot();
            continue;
        }

        {
            std::lock_guard<std::mutex> lock(g_state.mutex);
            SnapshotState& s = g_state.snapshot;
            switch (event->event_id) {
                case MPV_EVENT_START_FILE:
                    s.status = "loading";
                    s.error.clear();
                    s.audioTracks.clear();
                    s.selectedAudioTrackId = -1;
                    s.subtitleTracks.clear();
                    s.selectedSubtitleTrackId = -1;
                    g_state.loadedPath = false;
                    markDirtyLocked();
                    break;
                case MPV_EVENT_FILE_LOADED:
                    g_state.loadedPath = true;
                    s.status = g_state.paused ? "paused" : "playing";
                    markDirtyLocked();
                    break;
                case MPV_EVENT_END_FILE: {
                    const auto* endFile =
                        static_cast<mpv_event_end_file*>(event->data);
                    if (endFile &&
                        endFile->reason == MPV_END_FILE_REASON_ERROR) {
                        s.status = "error";
                        s.error = endFile->error < 0
                                      ? mpv_error_string(endFile->error)
                                      : "Playback failed.";
                    } else if (endFile &&
                               endFile->reason == MPV_END_FILE_REASON_EOF &&
                               g_state.running.load()) {
                        s.status = "ended";
                    } else if (endFile &&
                               endFile->reason ==
                                   MPV_END_FILE_REASON_REDIRECT &&
                               g_state.running.load()) {
                        s.status = "loading";
                        s.error.clear();
                        g_state.loadedPath = false;
                    } else if (g_state.running.load()) {
                        s.status = "idle";
                    }
                    markDirtyLocked();
                    break;
                }
                case MPV_EVENT_PROPERTY_CHANGE: {
                    const auto* property =
                        static_cast<mpv_event_property*>(event->data);
                    if (property) handlePropertyChange(*property);
                    break;
                }
                case MPV_EVENT_LOG_MESSAGE: {
                    const auto* logMessage =
                        static_cast<mpv_event_log_message*>(event->data);
                    if (!logMessage || !logMessage->level ||
                        !logMessage->text) {
                        break;
                    }
                    const std::string level = logMessage->level;
                    if (level == "error" || level == "fatal") {
                        s.error = logMessage->text;
                        markDirtyLocked();
                    }
                    if (level == "fatal") {
                        s.status = "error";
                    }
                    emitLine(JsonWriter()
                                 .str("event", "log")
                                 .str("level", level)
                                 .str("prefix", logMessage->prefix
                                                    ? logMessage->prefix
                                                    : "mpv")
                                 .str("text", logMessage->text)
                                 .finish());
                    break;
                }
                case MPV_EVENT_SHUTDOWN:
                    g_state.running.store(false);
                    s.status = "closed";
                    markDirtyLocked();
                    break;
                default:
                    break;
            }
        }
        maybeEmitSnapshot();
    }
    maybeEmitSnapshot(true);
}

/* ---- command handling ---------------------------------------------------- */

void setPropertyString(const char* name, const std::string& value) {
    mpv_set_property_string(g_state.mpv, name, value.c_str());
}

void handleLoadCommand(const Command& command) {
    const std::string url = command.get("url");
    if (url.empty()) return;

    /* Loading a replacement stream stops any active recording first,
     * mirroring the .mm behavior. */
    {
        std::lock_guard<std::mutex> lock(g_state.mutex);
        if (g_state.snapshot.recordingActive) {
            setPropertyString("stream-record", "");
            g_state.snapshot.recordingActive = false;
            g_state.snapshot.recordingStartedAt.clear();
        }
        g_state.snapshot.streamUrl = url;
        g_state.snapshot.error.clear();
        g_state.snapshot.status = "loading";
        g_state.dirty = true;
    }

    /* Generic pass-through: every `opt.<name>` argument becomes a loadfile
     * option, so the adapter controls start/user-agent/referrer/headers
     * without protocol changes. */
    std::string optionString;
    for (const auto& [key, value] : command.args) {
        if (key.rfind("opt.", 0) != 0 || value.empty()) continue;
        if (!optionString.empty()) optionString += ',';
        std::string escaped = value;
        /* loadfile options string uses %len%value quoting to stay safe */
        optionString += key.substr(4) + "=%" +
                        std::to_string(escaped.size()) + "%" + escaped;
    }

    const char* args[] = {"loadfile", url.c_str(), "replace",
                          optionString.empty() ? nullptr : optionString.c_str(),
                          nullptr};
    /* mpv >= 0.38 expects an index argument before options; use the
     * options-map-free form: loadfile <url> replace [options] */
    int result;
    if (optionString.empty()) {
        const char* plain[] = {"loadfile", url.c_str(), "replace", nullptr};
        result = mpv_command(g_state.mpv, plain);
    } else {
        const char* withOpts[] = {"loadfile", url.c_str(), "replace", "-1",
                                  optionString.c_str(), nullptr};
        result = mpv_command(g_state.mpv, withOpts);
        if (result == MPV_ERROR_INVALID_PARAMETER) {
            /* Older mpv without the index argument. */
            result = mpv_command(g_state.mpv, args);
        }
    }
    if (result < 0) {
        std::lock_guard<std::mutex> lock(g_state.mutex);
        g_state.snapshot.status = "error";
        g_state.snapshot.error = mpv_error_string(result);
        g_state.dirty = true;
    }
}

void handleRecordCommand(const Command& command) {
    const std::string path = command.get("path");
    const int result = mpv_set_property_string(g_state.mpv, "stream-record",
                                               path.c_str());
    std::lock_guard<std::mutex> lock(g_state.mutex);
    if (result < 0) {
        g_state.snapshot.recordingError = mpv_error_string(result);
    } else if (path.empty()) {
        g_state.snapshot.recordingActive = false;
        g_state.snapshot.recordingStartedAt.clear();
        g_state.snapshot.recordingError.clear();
    } else {
        g_state.snapshot.recordingActive = true;
        g_state.snapshot.recordingTargetPath = path;
        g_state.snapshot.recordingStartedAt = isoTimestampNow();
        g_state.snapshot.recordingError.clear();
    }
    g_state.dirty = true;
}

void handleCommand(const Command& command) {
    if (command.name == "load") {
        handleLoadCommand(command);
    } else if (command.name == "pause") {
        const int flag = command.get("value") == "1" ? 1 : 0;
        mpv_set_property(g_state.mpv, "pause", MPV_FORMAT_FLAG,
                         const_cast<int*>(&flag));
    } else if (command.name == "seek") {
        const double seconds = command.getDouble("seconds", 0);
        const std::string value = std::to_string(seconds);
        const char* args[] = {"seek", value.c_str(), "absolute", nullptr};
        mpv_command(g_state.mpv, args);
    } else if (command.name == "volume") {
        double percent =
            std::clamp(command.getDouble("value", 1) * 100.0, 0.0, 100.0);
        mpv_set_property(g_state.mpv, "volume", MPV_FORMAT_DOUBLE, &percent);
    } else if (command.name == "aid" || command.name == "sid") {
        const std::string value = command.get("value");
        setPropertyString(command.name.c_str(),
                          value == "-1" ? "no" : value);
    } else if (command.name == "speed") {
        double speed = std::clamp(command.getDouble("value", 1), 0.25, 4.0);
        mpv_set_property(g_state.mpv, "speed", MPV_FORMAT_DOUBLE, &speed);
    } else if (command.name == "aspect") {
        setPropertyString("video-aspect-override", command.get("value", "no"));
    } else if (command.name == "record") {
        handleRecordCommand(command);
    } else if (command.name == "size") {
        const int width = (int)command.getDouble("width", 0);
        const int height = (int)command.getDouble("height", 0);
        if (width >= 16 && height >= 16) {
            std::lock_guard<std::mutex> lock(g_state.mutex);
            g_state.viewportWidth = width;
            g_state.viewportHeight = height;
            applyRenderSizeLocked();
        }
    } else if (command.name == "quit") {
        g_state.running.store(false);
        mpv_wakeup(g_state.mpv);
    }
}

void runStdinLoop() {
    std::string line;
    while (g_state.running.load() && std::getline(std::cin, line)) {
        if (line.empty()) continue;
        handleCommand(frame_helper::parseCommandLine(line));
    }
    /* stdin EOF => the parent process died or closed us: shut down. */
    g_state.running.store(false);
    mpv_wakeup(g_state.mpv);
}

void onRenderUpdate(void* pipeline) {
    static_cast<RenderPipeline*>(pipeline)->notifyUpdate();
}

struct HelperArgs {
    std::string shmBase = "/impv";
    std::string hwdec = "auto";
    std::string audioDelay; /* seconds, mpv audio-delay passthrough */
    int width = 1280;
    int height = 720;
    double volume = 1;
    bool runtimeProbe = false;
};

HelperArgs parseArgs(int argc, char** argv) {
    HelperArgs args;
    for (int i = 1; i < argc; i++) {
        const std::string arg = argv[i];
        auto next = [&]() -> std::string {
            return i + 1 < argc ? argv[++i] : "";
        };
        if (arg == "--shm-base") args.shmBase = next();
        else if (arg == "--width") args.width = std::atoi(next().c_str());
        else if (arg == "--height") args.height = std::atoi(next().c_str());
        else if (arg == "--volume") args.volume = std::atof(next().c_str());
        else if (arg == "--hwdec") args.hwdec = next();
        else if (arg == "--audio-delay") args.audioDelay = next();
        else if (arg == "--runtime-probe") args.runtimeProbe = true;
    }
    args.width = std::max(16, args.width);
    args.height = std::max(16, args.height);
    return args;
}

int runtimeProbeFailure(const std::string& reason,
                        const std::string& detail = "") {
    JsonWriter writer;
    writer.num("protocol", 1)
        .boolean("usable", false)
        .str("reason", reason);
    if (!detail.empty()) writer.str("detail", detail);
    emitLine(writer.finish());
    return 1;
}

std::string libmpvClientApiVersion() {
    const unsigned long version = mpv_client_api_version();
    return std::to_string(version >> 16) + "." +
           std::to_string(version & 0xffff);
}

/*
 * Bounded startup capability probe: initialize an idle libmpv client and
 * create the platform GL + mpv OpenGL render contexts. It deliberately does
 * not create an FBO/shm ring, open media, or enter either command loop.
 */
int runRuntimeProbe() {
    mpv_handle* mpv = mpv_create();
    if (!mpv) {
        return runtimeProbeFailure("mpv-create-failed");
    }

    mpv_set_option_string(mpv, "vo", "libmpv");
    mpv_set_option_string(mpv, "idle", "yes");
    mpv_set_option_string(mpv, "input-default-bindings", "no");
    mpv_set_option_string(mpv, "osc", "no");
    const int initializeResult = mpv_initialize(mpv);
    if (initializeResult < 0) {
        const std::string error = mpv_error_string(initializeResult);
        mpv_destroy(mpv);
        return runtimeProbeFailure("mpv-initialize-failed", error);
    }

    GlContext gl;
    std::string error;
    if (!gl.create(error)) {
        gl.destroy();
        mpv_terminate_destroy(mpv);
        return runtimeProbeFailure("gl-context-create-failed", error);
    }
    if (!gl.makeCurrent(error)) {
        gl.destroy();
        mpv_terminate_destroy(mpv);
        return runtimeProbeFailure("gl-context-bind-failed", error);
    }

    mpv_opengl_init_params glInit = {
        gl.procLoader(),
        gl.procLoaderCtx(),
    };
    mpv_render_param renderParams[] = {
        {MPV_RENDER_PARAM_API_TYPE,
         const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    mpv_render_context* renderContext = nullptr;
    const int renderResult =
        mpv_render_context_create(&renderContext, mpv, renderParams);
    if (renderResult < 0 || !renderContext) {
        const std::string renderError =
            renderResult < 0 ? mpv_error_string(renderResult)
                             : "render context unavailable";
        if (renderContext) mpv_render_context_free(renderContext);
        gl.destroy();
        mpv_terminate_destroy(mpv);
        return runtimeProbeFailure("mpv-render-context-failed", renderError);
    }

    const std::string libmpvVersion = libmpvClientApiVersion();
    mpv_render_context_free(renderContext);
    gl.destroy();
    mpv_terminate_destroy(mpv);
    emitLine(JsonWriter()
                 .num("protocol", 1)
                 .boolean("usable", true)
                 .str("libmpv", libmpvVersion)
                 .str("renderApi", gl.renderApiName())
                 .finish());
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    std::setlocale(LC_NUMERIC, "C");
#if !defined(_WIN32)
    signal(SIGPIPE, SIG_IGN);
#endif
    const HelperArgs args = parseArgs(argc, argv);
    if (args.runtimeProbe) {
        return runRuntimeProbe();
    }

    g_state.mpv = mpv_create();
    if (!g_state.mpv) {
        emitLine(JsonWriter()
                     .str("event", "fatal")
                     .str("error", "mpv_create failed")
                     .finish());
        return 1;
    }

    mpv_set_option_string(g_state.mpv, "vo", "libmpv");
    mpv_set_option_string(g_state.mpv, "hwdec", args.hwdec.c_str());
    mpv_set_option_string(g_state.mpv, "keep-open", "yes");
    mpv_set_option_string(g_state.mpv, "idle", "yes");
    mpv_set_option_string(g_state.mpv, "input-default-bindings", "no");
    mpv_set_option_string(g_state.mpv, "osc", "no");
    if (!args.audioDelay.empty()) {
        /* Compensates the frame-copy video-path latency to restore
         * lip-sync; calibrated per platform, see the architecture doc. */
        mpv_set_option_string(g_state.mpv, "audio-delay",
                              args.audioDelay.c_str());
    }
    if (mpv_initialize(g_state.mpv) < 0) {
        emitLine(JsonWriter()
                     .str("event", "fatal")
                     .str("error", "mpv_initialize failed")
                     .finish());
        return 1;
    }
    mpv_request_log_messages(g_state.mpv, "warn");

    double initialVolumePercent =
        std::clamp(args.volume, 0.0, 1.0) * 100.0;
    mpv_set_property(g_state.mpv, "volume", MPV_FORMAT_DOUBLE,
                     &initialVolumePercent);

    mpv_observe_property(g_state.mpv, 1, "time-pos", MPV_FORMAT_DOUBLE);
    mpv_observe_property(g_state.mpv, 2, "duration", MPV_FORMAT_DOUBLE);
    mpv_observe_property(g_state.mpv, 3, "pause", MPV_FORMAT_FLAG);
    mpv_observe_property(g_state.mpv, 4, "volume", MPV_FORMAT_DOUBLE);
    mpv_observe_property(g_state.mpv, 5, "path", MPV_FORMAT_STRING);
    mpv_observe_property(g_state.mpv, 6, "track-list", MPV_FORMAT_NODE);
    mpv_observe_property(g_state.mpv, 7, "aid", MPV_FORMAT_STRING);
    mpv_observe_property(g_state.mpv, 8, "sid", MPV_FORMAT_STRING);
    mpv_observe_property(g_state.mpv, 9, "speed", MPV_FORMAT_DOUBLE);
    mpv_observe_property(g_state.mpv, 10, "video-aspect-override",
                         MPV_FORMAT_STRING);
    mpv_observe_property(g_state.mpv, 11, "eof-reached", MPV_FORMAT_FLAG);
    mpv_observe_property(g_state.mpv, 12, "dwidth", MPV_FORMAT_INT64);
    mpv_observe_property(g_state.mpv, 13, "dheight", MPV_FORMAT_INT64);

    g_state.pipeline.onGenerationChanged = [](const std::string& name,
                                              int width, int height,
                                              uint32_t generation) {
        emitLine(JsonWriter()
                     .str("event", "shm")
                     .str("name", name)
                     .num("width", width)
                     .num("height", height)
                     .num("generation", generation)
                     .finish());
    };

    g_state.viewportWidth = args.width;
    g_state.viewportHeight = args.height;

    std::string startError;
    if (!g_state.pipeline.start(g_state.mpv, args.shmBase, args.width,
                                args.height, startError)) {
        emitLine(JsonWriter()
                     .str("event", "fatal")
                     .str("error", startError)
                     .finish());
        return 1;
    }

    std::thread renderThread([] { g_state.pipeline.runLoop(); });
    /* The render context is created inside the render thread; hook the
     * update callback once it exists (or bail if GL init failed). */
    while (g_state.pipeline.initState() == 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    if (g_state.pipeline.initState() < 0) {
        renderThread.join();
        mpv_terminate_destroy(g_state.mpv);
        return 1;
    }
    mpv_render_context_set_update_callback(g_state.pipeline.renderContext(),
                                           onRenderUpdate, &g_state.pipeline);

#if defined(_WIN32)
    const double helperPid = (double)GetCurrentProcessId();
#else
    const double helperPid = (double)getpid();
#endif
    emitLine(JsonWriter()
                 .str("event", "hello")
                 .num("pid", helperPid)
                 .num("protocolVersion", 1)
                 .finish());

    std::thread stdinThread(runStdinLoop);
    runMpvEventLoop();

    g_state.pipeline.stop();
    renderThread.join();
    mpv_terminate_destroy(g_state.mpv);
    if (stdinThread.joinable()) {
        /* stdin thread exits on EOF; detach if the pipe is still open. */
        stdinThread.detach();
    }
    emitLine(JsonWriter().str("event", "bye").finish());
    return 0;
}
