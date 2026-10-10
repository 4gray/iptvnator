package com.iptvnator.googletv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import com.iptvnator.googletv.playlist.TvChannel

class TvLivePaginationTest {
    @Test
    fun `live search matches channel names and groups case insensitively`() {
        val channel = TvChannel(id = "news-1", name = "Canal Uno", url = "http://example.test/1", group = "Noticias España")

        assertTrue(tvChannelMatchesLiveSearch(channel, "canal"))
        assertTrue(tvChannelMatchesLiveSearch(channel, "  NOTICIAS ESPAÑA  "))
        assertFalse(tvChannelMatchesLiveSearch(channel, "deportes"))
        assertTrue(tvChannelMatchesLiveSearch(channel, "   "))
    }

    @Test
    fun `live search grows by non overlapping bounded pages with one sentinel`() {
        assertEquals(TvLiveSearchWindow(offset = 0, limit = 101, keepPrevious = 0), tvLiveSearchWindow(100))
        assertEquals(TvLiveSearchWindow(offset = 100, limit = 201, keepPrevious = 100), tvLiveSearchWindow(300))
        assertEquals(TvLiveSearchWindow(offset = 300, limit = 201, keepPrevious = 300), tvLiveSearchWindow(500))
    }

    @Test
    fun `does not prefetch before the final channel rows`() {
        assertFalse(
            shouldPrefetchLiveChannelPage(
                lastVisibleItemIndex = 80,
                firstChannelItemIndex = 2,
                visibleChannelCount = 100,
                loadedChannelCount = 100,
                totalChannelCount = 1_000,
            ),
        )
    }

    @Test
    fun `prefetches near the end while more channels exist`() {
        assertTrue(
            shouldPrefetchLiveChannelPage(
                lastVisibleItemIndex = 95,
                firstChannelItemIndex = 2,
                visibleChannelCount = 100,
                loadedChannelCount = 100,
                totalChannelCount = 1_000,
            ),
        )
    }

    @Test
    fun `prefetches filtered pages even when hidden rows leave fewer than the page limit`() {
        assertFalse(
            shouldPrefetchLiveChannelPage(
                lastVisibleItemIndex = 20,
                firstChannelItemIndex = 2,
                visibleChannelCount = 40,
                loadedChannelCount = 100,
                totalChannelCount = 101,
            ),
        )
        assertTrue(
            shouldPrefetchLiveChannelPage(
                lastVisibleItemIndex = 41,
                firstChannelItemIndex = 2,
                visibleChannelCount = 40,
                loadedChannelCount = 100,
                totalChannelCount = 101,
            ),
        )
    }

    @Test
    fun `does not prefetch after the complete catalogue is loaded`() {
        assertFalse(
            shouldPrefetchLiveChannelPage(
                lastVisibleItemIndex = 95,
                firstChannelItemIndex = 2,
                visibleChannelCount = 100,
                loadedChannelCount = 1_000,
                totalChannelCount = 1_000,
            ),
        )
    }

    @Test
    fun `does not prefetch an empty filtered list`() {
        assertFalse(
            shouldPrefetchLiveChannelPage(
                lastVisibleItemIndex = 2,
                firstChannelItemIndex = 2,
                visibleChannelCount = 0,
                loadedChannelCount = 100,
                totalChannelCount = 1_000,
            ),
        )
    }
}
