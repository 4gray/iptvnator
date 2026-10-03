package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.TvVodItem

data class TvVodFailoverCandidate(
    val playlistId: String,
    val item: TvVodItem,
) {
    val key: String get() = "$playlistId:${item.id}"
}

/** Picks the next distinct Xtream copy without looping over failed sources. */
fun nextTvVodFailoverCandidate(
    candidates: List<TvVodFailoverCandidate>,
    currentKey: String,
    attemptedKeys: Set<String>,
): TvVodFailoverCandidate? = candidates.firstOrNull { candidate ->
    candidate.item.providerType == "xtream" &&
        candidate.key != currentKey &&
        candidate.key !in attemptedKeys
}
