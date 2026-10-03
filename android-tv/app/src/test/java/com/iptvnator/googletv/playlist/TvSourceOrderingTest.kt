package com.iptvnator.googletv.playlist

import org.junit.Assert.assertEquals
import org.junit.Test

class TvSourceOrderingTest {
    private val playlists = listOf(
        source("old", "Older", 100L),
        source("new", "Newer", 300L),
        source("middle", "Middle", 200L),
        source("unknown", "Unknown", null),
    )

    @Test
    fun `date sort modes use playlist import timestamps and keep unknown dates last`() {
        assertEquals(
            listOf("new", "middle", "old", "unknown"),
            orderTvSources(playlists, emptyList(), "Más recientes").map { it.id },
        )
        assertEquals(
            listOf("old", "middle", "new", "unknown"),
            orderTvSources(playlists, emptyList(), "Más antiguas").map { it.id },
        )
    }

    @Test
    fun `manual ordering follows saved source order independently of input order`() {
        assertEquals(
            listOf("middle", "old", "unknown", "new"),
            orderTvSources(playlists, listOf("middle", "old", "unknown", "new"), "Personalizado")
                .map { it.id },
        )
    }

    @Test
    fun `using a move action switches the visible sort to custom`() {
        assertEquals("Personalizado", sourceSortModeAfterManualMove("Más recientes"))
        assertEquals("Personalizado", sourceSortModeAfterManualMove("Nombre A-Z"))
        assertEquals("Personalizado", sourceSortModeAfterManualMove("Personalizado"))
    }

    private fun source(id: String, name: String, importedAtMs: Long?) = StoredPlaylist(
        id = id,
        name = name,
        sourceUrl = "https://example.test/$id.m3u",
        importedAtMs = importedAtMs,
        channels = emptyList(),
    )
}
