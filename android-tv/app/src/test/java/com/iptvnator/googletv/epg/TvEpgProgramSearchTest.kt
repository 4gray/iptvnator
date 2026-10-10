package com.iptvnator.googletv.epg

import com.iptvnator.googletv.playlist.TvChannel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TvEpgProgramSearchTest {
    private val channel = TvChannel("channel-1", "Canal Uno", "https://example.test/live")

    @Test
    fun requiresTwoCharactersAndSearchesTitleSubtitleDescriptionAndCategoryWithoutCaseSensitivity() {
        val programmes = listOf(
            TvEpgEntry("guide-1", 100, 200, "Noticias de hoy", "Edición tarde", "Resumen local"),
            TvEpgEntry("guide-1", 200, 300, "Cine", "Historias del Norte", "Drama", "Ciencia ficción"),
        )
        val channels = listOf(TvEpgSearchChannel("source-1", channel, programmes))

        assertTrue(searchTvEpgPrograms(channels, "n", nowMs = 150).isEmpty())
        assertEquals("Noticias de hoy", searchTvEpgPrograms(channels, "  NOTICIAS ", 150).single().programme.title)
        assertEquals("Cine", searchTvEpgPrograms(channels, "norte", 150).single().programme.title)
        assertEquals("Noticias de hoy", searchTvEpgPrograms(channels, "local", 150).single().programme.title)
        assertEquals("Cine", searchTvEpgPrograms(channels, "FICCIÓN", 150).single().programme.title)
    }

    @Test
    fun ranksCurrentThenNearestUpcomingThenMostRecentPastAndHonoursLimit() {
        val past = TvEpgEntry("guide-1", 600, 700, "Programa coincidente", null, null)
        val distantFuture = TvEpgEntry("guide-1", 2_000, 2_100, "Programa coincidente", null, null)
        val current = TvEpgEntry("guide-1", 950, 1_050, "Programa coincidente", null, null)
        val nearFuture = TvEpgEntry("guide-1", 1_100, 1_200, "Programa coincidente", null, null)
        val recentPast = TvEpgEntry("guide-1", 800, 900, "Programa coincidente", null, null)
        val channels = listOf(TvEpgSearchChannel(
            "source-1",
            channel,
            listOf(past, distantFuture, nearFuture, current, recentPast),
        ))

        val results = searchTvEpgPrograms(channels, "coincidente", nowMs = 1_000, limit = 3)

        assertEquals(listOf(current, nearFuture, distantFuture), results.map(TvEpgSearchHit::programme))
        assertTrue(results.all { it.playlistId == "source-1" && it.channel == channel })
    }

    @Test
    fun returnsMostRecentlyEndedArchiveBeforeOlderMatches() {
        val older = TvEpgEntry("guide-1", 100, 200, "Archivo especial", null, null)
        val recent = TvEpgEntry("guide-1", 800, 900, "Archivo especial", null, null)
        val channels = listOf(TvEpgSearchChannel("source-1", channel, listOf(older, recent)))

        assertEquals(recent, searchTvEpgPrograms(channels, "archivo", nowMs = 1_000).first().programme)
    }
}
