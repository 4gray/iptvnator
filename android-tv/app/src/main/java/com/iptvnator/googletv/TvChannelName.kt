package com.iptvnator.googletv

private val tvTagPrefixPattern = Regex(
    "^(?:(?=[0-9+]*[A-Z])[A-Z0-9+]{2,5}(?:-(?=[0-9+]*[A-Z])[A-Z0-9+]{2,6}){1,2}|(?=[0-9+]*[A-Z])[A-Z0-9+]{2,3})$",
)
private val tvColonTagPattern = Regex("^(?=[0-9+]*[A-Z])[A-Z0-9+]{2,3}$")

/**
 * Mirrors IPTVnator's display-only country/tag prefix cleanup.
 *
 * The stored channel name is deliberately never changed: IDs, EPG matching,
 * favourites, history and playback continue using the provider value.
 */
internal fun stripTvCountryPrefix(name: String): String {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return name
    var separatorIndex = trimmed.indexOf('|')
    var separatorLength = if (separatorIndex >= 0) 1 else 0
    for (separator in listOf(" - ", "- ", " -", ": ")) {
        val index = trimmed.indexOf(separator)
        if (index < 0 || (separatorIndex >= 0 && separatorIndex <= index)) continue
        val prefix = trimmed.substring(0, index).trim()
        val isColon = separator == ": "
        val pattern = if (isColon) tvColonTagPattern else tvTagPrefixPattern
        if (pattern.matches(prefix)) {
            separatorIndex = index
            separatorLength = separator.length
        }
    }

    if (separatorIndex < 0) return trimmed
    val prefix = trimmed.substring(0, separatorIndex).trim()
    val remainder = trimmed.substring(separatorIndex + separatorLength).trim()
    if (remainder.isEmpty()) return trimmed
    // Pipes are tag separators by convention; dash/colon candidates were
    // validated above. A leading pipe is retried so "|DE| ARD" becomes ARD.
    return if (prefix.isEmpty()) stripTvCountryPrefix(remainder) else remainder
}

internal fun displayTvChannelName(name: String, stripCountryPrefix: Boolean): String =
    if (stripCountryPrefix) stripTvCountryPrefix(name) else name
