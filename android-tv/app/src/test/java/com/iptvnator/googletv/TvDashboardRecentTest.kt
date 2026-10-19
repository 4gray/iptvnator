package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.TvSavedItem
import com.iptvnator.googletv.playlist.TvSavedItemType
import org.junit.Assert.assertEquals
import org.junit.Test

class TvDashboardRecentTest {
    @Test
    fun recentlyWatchedLiveRailContainsOnlyChannelsAndKeepsPlaybackOrder() {
        val firstChannel = saved("channel-1", TvSavedItemType.CHANNEL, 30L)
        val movie = saved("movie-1", TvSavedItemType.VOD, 20L)
        val secondChannel = saved("channel-2", TvSavedItemType.CHANNEL, 10L)
        val episode = saved("episode-1", TvSavedItemType.SERIES, 5L)

        assertEquals(
            listOf(firstChannel, secondChannel),
            tvDashboardRecentLiveHistory(listOf(firstChannel, movie, secondChannel, episode)),
        )
    }

    @Test
    fun vodOnlyHistoryDoesNotCreateARecentlyWatchedLiveRail() {
        assertEquals(
            emptyList<TvSavedItem>(),
            tvDashboardRecentLiveHistory(listOf(saved("movie-1", TvSavedItemType.VOD, 20L))),
        )
    }

    private fun saved(key: String, type: TvSavedItemType, lastPlayedAt: Long) = TvSavedItem(
        playlistId = "source",
        itemType = type,
        itemKey = key,
        title = key,
        uri = "https://example.invalid/$key",
        coverUrl = null,
        savedAt = lastPlayedAt,
        lastPlayedAt = lastPlayedAt,
    )
}
