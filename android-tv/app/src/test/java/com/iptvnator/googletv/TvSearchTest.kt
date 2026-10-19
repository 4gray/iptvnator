package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.StoredPlaylist
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.playlist.TvSeriesItem
import com.iptvnator.googletv.playlist.TvVodItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvSearchTest {
    @Test
    fun `search zap queue follows visible sorted results across playlists`() {
        val visibleResults = listOf(
            TvSearchResult(
                playlistId = "playlist-b",
                type = TvSearchResultType.CHANNEL,
                title = "Alpha",
                subtitle = "TV · B",
                channel = TvChannel("b-alpha", "Alpha", "https://example/b-alpha"),
            ),
            TvSearchResult(
                playlistId = "playlist-a",
                type = TvSearchResultType.VOD,
                title = "Alpha film",
                subtitle = "Película · A",
            ),
            TvSearchResult(
                playlistId = "playlist-a",
                type = TvSearchResultType.CHANNEL,
                title = "Alpha News",
                subtitle = "TV · A",
                channel = TvChannel("a-news", "Alpha News", "https://example/a-news"),
            ),
            TvSearchResult(
                playlistId = "playlist-a",
                type = TvSearchResultType.CHANNEL,
                title = "Unavailable row",
                subtitle = "TV · A",
            ),
        )

        assertEquals(
            listOf(
                TvChannelZapEntry("playlist-b", "b-alpha"),
                TvChannelZapEntry("playlist-a", "a-news"),
            ),
            tvSearchChannelZapQueue(visibleResults),
        )
    }

    @Test
    fun `marks channel results with a group as categorized`() {
        val results = searchPlaylists(
            listOf(
                StoredPlaylist(
                    id = "playlist",
                    name = "Test",
                    sourceUrl = null,
                    channels = listOf(
                        TvChannel("news", "News", "https://example/news", group = "Noticias"),
                        TvChannel("misc", "Misc", "https://example/misc"),
                    ),
                ),
            ),
            "",
        )

        // Blank queries intentionally return no results; the category flag is
        // asserted through the same public search contract with a matching term.
        val matching = searchPlaylists(
            listOf(
                StoredPlaylist(
                    id = "playlist",
                    name = "Test",
                    sourceUrl = null,
                    channels = listOf(
                        TvChannel("news", "News", "https://example/news", group = "Noticias"),
                        TvChannel("misc", "Misc", "https://example/misc"),
                    ),
                ),
            ),
            "s",
        )
        assertTrue(results.isEmpty())
        assertTrue(matching.any { it.title == "News" && it.hasCategory })
        assertFalse(matching.any { it.title == "Misc" && it.hasCategory })
    }

    @Test
    fun `includes persisted catalogue overrides outside the initial playlist window`() {
        val playlist = StoredPlaylist(
            id = "playlist",
            name = "Large source",
            sourceUrl = null,
            channels = emptyList(),
        )
        val results = searchPlaylists(
            listOf(playlist),
            "remote",
            vodOverrides = mapOf("playlist" to listOf(
                TvVodItem(9001, "Remote Film", "https://example/movie.mp4", null, null, "mp4", null),
            )),
            seriesOverrides = mapOf("playlist" to listOf(
                TvSeriesItem(9002, "Remote Series", null, null, null, null),
            )),
        )

        assertTrue(results.any { it.type == TvSearchResultType.VOD && it.title == "Remote Film" })
        assertTrue(results.any { it.type == TvSearchResultType.SERIES && it.title == "Remote Series" })
    }

    @Test
    fun `can exclude channels from groups hidden in their playlist`() {
        val playlist = StoredPlaylist(
            id = "playlist",
            name = "Hidden groups",
            sourceUrl = null,
            channels = listOf(
                TvChannel("visible", "News", "https://example/news", group = "Visible"),
                TvChannel("hidden", "News 24", "https://example/news24", group = "Hidden"),
            ),
            hiddenGroupTitles = listOf("Hidden"),
        )
        val results = searchPlaylists(listOf(playlist), "news", excludeHiddenGroups = true)
        assertTrue(results.any { it.title == "News" })
        assertFalse(results.any { it.title == "News 24" })
    }
}
