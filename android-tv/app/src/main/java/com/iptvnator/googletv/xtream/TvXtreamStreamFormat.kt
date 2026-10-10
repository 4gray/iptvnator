package com.iptvnator.googletv.xtream

enum class TvXtreamStreamFormat {
    AUTO,
    M3U8,
    TS,
}

/** Selects the other common Xtream live container after an AUTO failure. */
fun alternateXtreamLiveFormat(uri: String): TvXtreamStreamFormat {
    val path = uri.substringBefore('?').substringBefore('#').lowercase()
    return if (path.endsWith(".ts")) TvXtreamStreamFormat.M3U8 else TvXtreamStreamFormat.TS
}

/** A delayed alternate-format response is only valid for the exact channel/request that failed. */
internal fun xtreamLiveFallbackStillApplies(
    expectedChannelKey: String,
    expectedSourceUri: String,
    activeChannelKey: String?,
    activeRequestUri: String?,
): Boolean = activeChannelKey == expectedChannelKey && activeRequestUri == expectedSourceUri
