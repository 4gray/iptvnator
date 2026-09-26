package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.StoredPlaylist
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvSourceDisplayTest {
    @Test
    fun `source filters only include provider types that exist`() {
        val m3u = StoredPlaylist("m3u", "Local", null, channels = emptyList())

        assertEquals(listOf("Todos", "M3U"), tvSourceFilterOptions(listOf(m3u)))
    }

    @Test
    fun `empty downloads route stays represented in the sidebar`() {
        assertTrue(tvSidebarIncludesDownloads(TvSection.Downloads, hasDownloads = false))
        assertTrue(tvSidebarIncludesDownloads(TvSection.Sources, hasDownloads = true))
        assertTrue(tvSidebarIncludesDownloads(TvSection.Sources, hasDownloads = false, hasRecordings = true))
        assertFalse(tvSidebarIncludesDownloads(TvSection.Sources, hasDownloads = false))
    }

    @Test
    fun `redacts credentials in source urls shown in playlist information`() {
        assertEquals(
            "http://•••:•••@provider.example/list.m3u?username=•••&password=•••&type=m3u",
            redactTvSourceUrl("http://alice:secret@provider.example/list.m3u?username=alice&password=secret&type=m3u"),
        )
    }

    @Test
    fun `redacts token and api key query parameters case insensitively`() {
        assertEquals(
            "https://provider.example/list.m3u?Token=•••&api_key=•••&group=kids",
            redactTvSourceUrl("https://provider.example/list.m3u?Token=abc&api_key=xyz&group=kids"),
        )
    }
}
