package com.iptvnator.googletv

import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.playlist.StoredPlaylist

/** Match IPTVnator's live-list rule: only reserve programme rows for configured/available guides. */
internal fun shouldShowTvLiveEpg(
    playlists: List<StoredPlaylist>,
    vararg snapshots: Map<String, List<TvEpgEntry>>,
): Boolean {
    if (playlists.any { !it.epgUrl.isNullOrBlank() || it.epgUrls.isNotEmpty() }) return true

    val playlistIds = playlists.mapTo(mutableSetOf()) { it.id }
    return snapshots.asSequence()
        .flatMap { it.asSequence() }
        .any { (key, entries) ->
            entries.isNotEmpty() && key.substringBefore(':') in playlistIds
        }
}
