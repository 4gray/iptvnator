package com.iptvnator.googletv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import com.iptvnator.googletv.playlist.TvSavedItem
import com.iptvnator.googletv.playlist.TvSavedItemType

class TvZappingTest {
    @Test
    fun `channel up wraps from last to first`() {
        assertEquals(0, nextTvChannelIndex(size = 3, currentIndex = 2, delta = 1))
    }

    @Test
    fun `channel down wraps from first to last`() {
        assertEquals(2, nextTvChannelIndex(size = 3, currentIndex = 0, delta = -1))
    }

    @Test
    fun `captured channel order crosses sources and wraps both ways`() {
        val queue = listOf(
            TvChannelZapEntry("source-a", "first"),
            TvChannelZapEntry("source-b", "other"),
            TvChannelZapEntry("source-a", "second"),
        )

        assertEquals(TvChannelZapEntry("source-b", "other"), adjacentTvChannelInCapturedQueue(queue, "source-a", "first", 1))
        assertEquals(TvChannelZapEntry("source-a", "second"), adjacentTvChannelInCapturedQueue(queue, "source-a", "first", -1))
        assertNull(adjacentTvChannelInCapturedQueue(queue, "source-a", "other", 1))
    }

    @Test
    fun `numeric channel selection follows the captured cross-source order`() {
        val queue = listOf(TvChannelZapEntry("a", "one"), TvChannelZapEntry("b", "two"))

        assertEquals(TvChannelZapEntry("b", "two"), tvChannelEntryForNumber(queue, 2))
        assertNull(tvChannelEntryForNumber(queue, 3))
    }

    @Test
    fun `saved collection zap queue preserves visible cross-source channel order only`() {
        val visibleItems = listOf(
            savedItem("source-b", TvSavedItemType.CHANNEL, "channel-2"),
            savedItem("source-a", TvSavedItemType.VOD, "movie-1"),
            savedItem("source-a", TvSavedItemType.CHANNEL, "channel-1"),
            savedItem("source-b", TvSavedItemType.SERIES, "series-1"),
        )

        assertEquals(
            listOf(
                TvChannelZapEntry("source-b", "channel-2"),
                TvChannelZapEntry("source-a", "channel-1"),
            ),
            tvSavedChannelZapQueue(visibleItems),
        )
    }

    @Test
    fun `single channel and invalid positions do not zap`() {
        assertNull(nextTvChannelIndex(size = 1, currentIndex = 0, delta = 1))
        assertNull(nextTvChannelIndex(size = 3, currentIndex = 3, delta = 1))
        assertNull(nextTvChannelIndex(size = 3, currentIndex = 1, delta = 0))
    }

    @Test
    fun `numeric channel selection uses one based playlist position`() {
        assertEquals(0, tvChannelIndexForNumber(size = 3, number = 1))
        assertEquals(2, tvChannelIndexForNumber(size = 3, number = 3))
        assertEquals(0, tvChannelPositionForNumber(1))
        assertEquals(2, tvChannelPositionForNumber(3))
        assertNull(tvChannelPositionForNumber(0))
        assertNull(tvChannelIndexForNumber(size = 3, number = 0))
        assertNull(tvChannelIndexForNumber(size = 3, number = 4))
    }

    @Test
    fun `numeric channel entry uses the original two second debounce`() {
        assertEquals(2_000L, TV_CHANNEL_NUMBER_INPUT_TIMEOUT_MS)
    }

    @Test
    fun `numeric channel entry accepts at most four digits`() {
        val input = "1".let { appendTvChannelNumberDigit(it, '2') }
            .let { appendTvChannelNumberDigit(it, '3') }
            .let { appendTvChannelNumberDigit(it, '4') }

        assertEquals("1234", appendTvChannelNumberDigit(input, '5'))
        assertEquals("1234", appendTvChannelNumberDigit(input, 'x'))
    }

    private fun savedItem(playlistId: String, type: TvSavedItemType, key: String) = TvSavedItem(
        playlistId = playlistId,
        itemType = type,
        itemKey = key,
        title = key,
        uri = "https://example.invalid/$key",
        coverUrl = null,
        savedAt = 1L,
        lastPlayedAt = null,
    )
}
