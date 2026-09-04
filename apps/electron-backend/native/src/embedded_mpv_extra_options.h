#pragma once

#include <napi.h>

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace iptvnator {

/** One libmpv option name/value pair handed to a session at creation. */
using EmbeddedMpvExtraOption = std::pair<std::string, std::string>;

/**
 * Reads the optional `key=value` string array `createSession()` receives at
 * `index`. The Electron side already validated and ordered the lines
 * (network defaults first, then the user's options minus the keys the embed
 * depends on — see `resolveEmbeddedMpvSessionOptionArguments`), so this only
 * splits on the first `=` and skips anything that is not a non-empty pair.
 * No libmpv call lives here: each engine applies the pairs itself, because
 * on Linux the libmpv symbols are macros over dynamically resolved pointers.
 */
inline std::vector<EmbeddedMpvExtraOption> readEmbeddedMpvExtraOptions(
    const Napi::CallbackInfo& info,
    size_t index
)
{
    std::vector<EmbeddedMpvExtraOption> options;
    if (info.Length() <= index || !info[index].IsArray()) {
        return options;
    }

    const auto entries = info[index].As<Napi::Array>();
    for (uint32_t i = 0; i < entries.Length(); ++i) {
        const Napi::Value entry = entries.Get(i);
        if (!entry.IsString()) {
            continue;
        }
        const std::string line = entry.As<Napi::String>().Utf8Value();
        const auto separator = line.find('=');
        if (
            separator == std::string::npos ||
            separator == 0 ||
            separator + 1 >= line.size()
        ) {
            continue;
        }
        options.emplace_back(
            line.substr(0, separator),
            line.substr(separator + 1)
        );
    }
    return options;
}

} // namespace iptvnator
