package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.StoredPlaylist
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.playlist.TvSeriesItem
import com.iptvnator.googletv.playlist.TvVodItem

enum class TvSearchResultType { CHANNEL, VOD, SERIES }

data class TvSearchResult(
    val playlistId: String,
    val type: TvSearchResultType,
    val title: String,
    val subtitle: String,
    val hasCategory: Boolean = false,
    val channel: TvChannel? = null,
    val vod: TvVodItem? = null,
    val series: TvSeriesItem? = null,
)

/** Keep the exact visible Search result order, even when rows span playlists. */
internal fun tvSearchChannelZapQueue(visibleResults: List<TvSearchResult>): List<TvChannelZapEntry> =
    visibleResults.asSequence()
        .filter { it.type == TvSearchResultType.CHANNEL }
        .mapNotNull { result ->
            result.channel?.let { TvChannelZapEntry(result.playlistId, it.id) }
        }
        .toList()

fun searchPlaylists(
    playlists: List<StoredPlaylist>,
    query: String,
    channelOverrides: Map<String, List<TvChannel>> = emptyMap(),
    vodOverrides: Map<String, List<TvVodItem>> = emptyMap(),
    seriesOverrides: Map<String, List<TvSeriesItem>> = emptyMap(),
    excludeHiddenGroups: Boolean = false,
): List<TvSearchResult> {
    val needle = query.trim()
    if (needle.isBlank()) return emptyList()
    return buildList {
        playlists.forEach { playlist ->
            (channelOverrides[playlist.id] ?: playlist.channels).forEach { channel ->
                val hidden = excludeHiddenGroups && playlist.hiddenGroupTitles.any {
                    it.equals(channel.group, ignoreCase = true)
                }
                if (!hidden && channel.name.contains(needle, ignoreCase = true)) {
                    add(TvSearchResult(playlist.id, TvSearchResultType.CHANNEL, channel.name, "TV · ${playlist.name}", hasCategory = !channel.group.isNullOrBlank(), channel = channel))
                }
            }
            (vodOverrides[playlist.id] ?: playlist.vod).forEach { item ->
                if (item.name.contains(needle, ignoreCase = true)) {
                    add(TvSearchResult(playlist.id, TvSearchResultType.VOD, item.name, "Película · ${playlist.name}", hasCategory = !item.categoryId.isNullOrBlank(), vod = item))
                }
            }
            (seriesOverrides[playlist.id] ?: playlist.series).forEach { item ->
                if (item.name.contains(needle, ignoreCase = true)) {
                    add(TvSearchResult(playlist.id, TvSearchResultType.SERIES, item.name, "Serie · ${playlist.name}", hasCategory = !item.categoryId.isNullOrBlank(), series = item))
                }
            }
        }
    }
}
