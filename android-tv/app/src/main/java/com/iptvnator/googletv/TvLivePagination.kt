package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.TvChannel

internal data class TvLiveSearchWindow(val offset: Int, val limit: Int, val keepPrevious: Int)

/** Keep the UI-side search predicate in sync with SQLite's name/group query. */
internal fun tvChannelMatchesLiveSearch(channel: TvChannel, query: String): Boolean {
    val normalized = query.trim()
    if (normalized.isEmpty()) return true
    return channel.name.contains(normalized, ignoreCase = true) ||
        channel.group?.contains(normalized, ignoreCase = true) == true
}

/** A 100-row initial search window followed by bounded 200-row SQL pages. */
internal fun tvLiveSearchWindow(channelLimit: Int): TvLiveSearchWindow {
    if (channelLimit <= 100) return TvLiveSearchWindow(offset = 0, limit = 101, keepPrevious = 0)
    val offset = (channelLimit - 200).coerceAtLeast(0)
    return TvLiveSearchWindow(offset = offset, limit = 201, keepPrevious = offset)
}

/** Whether a TV live list should prefetch its next page near the current end. */
internal fun shouldPrefetchLiveChannelPage(
    lastVisibleItemIndex: Int?,
    firstChannelItemIndex: Int,
    visibleChannelCount: Int,
    loadedChannelCount: Int,
    totalChannelCount: Int,
    prefetchRows: Int = 8,
): Boolean {
    if (lastVisibleItemIndex == null || visibleChannelCount <= 0) return false
    if (loadedChannelCount >= totalChannelCount) return false
    val prefetchThreshold = firstChannelItemIndex + (visibleChannelCount - prefetchRows).coerceAtLeast(0)
    return lastVisibleItemIndex >= prefetchThreshold
}
