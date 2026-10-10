package com.iptvnator.googletv

import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.playlist.StoredPlaylist
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvLiveEpgVisibilityTest {
    private fun playlist(id: String, epgUrl: String? = null, epgUrls: List<String> = emptyList()) =
        StoredPlaylist(id = id, name = id, sourceUrl = null, epgUrl = epgUrl, epgUrls = epgUrls, channels = emptyList())

    private val programme = TvEpgEntry("news", 1L, 2L, "Programme")

    @Test
    fun `hides empty programme placeholders when a playlist has no guide configured`() {
        assertFalse(shouldShowTvLiveEpg(listOf(playlist("m3u"))))
    }

    @Test
    fun `keeps programme rows for a configured guide before it has loaded`() {
        assertTrue(shouldShowTvLiveEpg(listOf(playlist("m3u", epgUrls = listOf("https://guide.test/xmltv.xml")))))
    }

    @Test
    fun `shows guide rows when the selected playlist has native guide data`() {
        assertTrue(shouldShowTvLiveEpg(listOf(playlist("xtream")), mapOf("xtream:news" to listOf(programme))))
    }

    @Test
    fun `does not show guide rows only because another playlist has EPG data`() {
        assertFalse(shouldShowTvLiveEpg(listOf(playlist("m3u")), mapOf("other:news" to listOf(programme))))
    }

    @Test
    fun `success and failure previews use separate bounded cache lifetimes`() {
        val success = TvXtreamEpgPreview(emptyList(), fetchedAtMs = 1_000L, offsetMinutes = 60)
        val failure = success.copy(failed = true)

        assertTrue(isFreshXtreamEpgPreview(success, offsetMinutes = 60, nowMs = 300_999L))
        assertFalse(isFreshXtreamEpgPreview(success, offsetMinutes = 60, nowMs = 301_000L))
        assertTrue(isFreshXtreamEpgPreview(failure, offsetMinutes = 60, nowMs = 60_999L))
        assertFalse(isFreshXtreamEpgPreview(failure, offsetMinutes = 60, nowMs = 61_000L))
        assertFalse(isFreshXtreamEpgPreview(success, offsetMinutes = 0, nowMs = 2_000L))
        assertFalse(isFreshXtreamEpgPreview(success, offsetMinutes = 60, nowMs = 999L))
    }
}
