/*
 * stdio line protocol for the frame-copy helper.
 *
 * Inbound commands (stdin): one command per line, tab-separated fields.
 * The first field is the command name; the rest are `key=value` pairs with
 * percent-encoded values (%XX for at least '%', TAB, CR, LF). This avoids a
 * JSON parser in native code — the TypeScript adapter owns serialization.
 *
 * Outbound events (stdout): one JSON object per line. Emitting JSON only
 * needs string escaping, which lives here too.
 */
#pragma once

#include <cstdint>
#include <cstdio>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace frame_helper {

inline int hexValue(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

inline std::string percentDecode(const std::string& value) {
    std::string out;
    out.reserve(value.size());
    for (size_t i = 0; i < value.size(); i++) {
        if (value[i] == '%' && i + 2 < value.size() &&
            hexValue(value[i + 1]) >= 0 && hexValue(value[i + 2]) >= 0) {
            out.push_back(
                (char)((hexValue(value[i + 1]) << 4) | hexValue(value[i + 2])));
            i += 2;
            continue;
        }
        out.push_back(value[i]);
    }
    return out;
}

struct Command {
    std::string name;
    std::unordered_map<std::string, std::string> args;

    std::string get(const std::string& key,
                    const std::string& fallback = "") const {
        const auto it = args.find(key);
        return it == args.end() ? fallback : it->second;
    }

    double getDouble(const std::string& key, double fallback) const {
        const auto it = args.find(key);
        if (it == args.end()) return fallback;
        try {
            return std::stod(it->second);
        } catch (...) {
            return fallback;
        }
    }
};

inline Command parseCommandLine(const std::string& line) {
    Command command;
    std::stringstream stream(line);
    std::string field;
    bool first = true;
    while (std::getline(stream, field, '\t')) {
        if (first) {
            command.name = field;
            first = false;
            continue;
        }
        const size_t eq = field.find('=');
        if (eq == std::string::npos) continue;
        command.args[field.substr(0, eq)] =
            percentDecode(field.substr(eq + 1));
    }
    return command;
}

inline std::string jsonEscape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 8);
    for (const char c : value) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if ((unsigned char)c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out.push_back(c);
                }
        }
    }
    return out;
}

/* Minimal JSON writer for flat/one-level-nested event objects. */
class JsonWriter {
public:
    JsonWriter() { buffer_ += '{'; }

    JsonWriter& str(const std::string& key, const std::string& value) {
        writeKey(key);
        buffer_ += '"';
        buffer_ += jsonEscape(value);
        buffer_ += '"';
        return *this;
    }

    JsonWriter& num(const std::string& key, double value) {
        writeKey(key);
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%.6g", value);
        buffer_ += buf;
        return *this;
    }

    JsonWriter& boolean(const std::string& key, bool value) {
        writeKey(key);
        buffer_ += value ? "true" : "false";
        return *this;
    }

    JsonWriter& nullValue(const std::string& key) {
        writeKey(key);
        buffer_ += "null";
        return *this;
    }

    JsonWriter& raw(const std::string& key, const std::string& rawJson) {
        writeKey(key);
        buffer_ += rawJson;
        return *this;
    }

    std::string finish() {
        buffer_ += '}';
        return buffer_;
    }

private:
    void writeKey(const std::string& key) {
        if (!first_) buffer_ += ',';
        first_ = false;
        buffer_ += '"';
        buffer_ += jsonEscape(key);
        buffer_ += "\":";
    }

    std::string buffer_;
    bool first_ = true;
};

/* stdout is shared by every thread that emits events. */
inline void emitLine(const std::string& jsonLine) {
    static std::mutex stdoutMutex;
    std::lock_guard<std::mutex> lock(stdoutMutex);
    std::fwrite(jsonLine.data(), 1, jsonLine.size(), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);
}

} // namespace frame_helper
