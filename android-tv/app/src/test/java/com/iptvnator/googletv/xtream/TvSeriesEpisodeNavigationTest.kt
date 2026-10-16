package com.iptvnator.googletv.xtream

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TvSeriesEpisodeNavigationTest {
    private val episodes = listOf(
        episode(id = 11, season = 1, number = 1),
        episode(id = 21, season = 2, number = 1),
        episode(id = 12, season = 1, number = 2),
        episode(id = 22, season = 2, number = 2),
    )

    @Test
    fun `neighbors stay in the current season even when seasons are interleaved`() {
        val neighbors = tvSeriesEpisodeNeighbors(episodes, currentEpisodeId = 12)

        assertEquals(11, neighbors.previous?.id)
        assertNull(neighbors.next)
    }

    @Test
    fun `first episode has no previous episode from the prior season`() {
        val neighbors = tvSeriesEpisodeNeighbors(episodes, currentEpisodeId = 21)

        assertNull(neighbors.previous)
        assertEquals(22, neighbors.next?.id)
    }

    @Test
    fun `unknown episode has no neighbors`() {
        val neighbors = tvSeriesEpisodeNeighbors(episodes, currentEpisodeId = 999)

        assertNull(neighbors.previous)
        assertNull(neighbors.next)
    }

    @Test
    fun `single episode season has no neighbors`() {
        val singleEpisodeSeason = episodes + episode(id = 31, season = 3, number = 1)
        val neighbors = tvSeriesEpisodeNeighbors(singleEpisodeSeason, currentEpisodeId = 31)

        assertNull(neighbors.previous)
        assertNull(neighbors.next)
    }

    private fun episode(id: Int, season: Int, number: Int) = XtreamSeriesEpisode(
        id = id,
        title = "Episode $number",
        season = season,
        episode = number,
        extension = "mp4",
    )
}
