package com.iptvnator.googletv.epg

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TvEpgSelectionTest {
    private val entries = listOf(
        TvEpgEntry("channel", 0, 100, "Pasado", null, null),
        TvEpgEntry("channel", 100, 200, "Actual", null, null),
        TvEpgEntry("channel", 200, 300, "Siguiente", null, null),
    )

    @Test
    fun selectsTheProgrammePlayingNow() {
        assertEquals("Actual", selectCurrentOrNextEpgEntry(entries, 150)?.title)
    }

    @Test
    fun selectsTheNextProgrammeWhenNothingIsPlaying() {
        assertEquals("Siguiente", selectCurrentOrNextEpgEntry(entries, 201)?.title)
    }

    @Test
    fun doesNotAdvertiseAnExpiredProgramme() {
        assertNull(selectCurrentOrNextEpgEntry(entries, 301))
    }

    @Test
    fun choosesTheEarliestCurrentProgrammeFromUnsortedOverlappingEntries() {
        val overlapping = listOf(
            TvEpgEntry("channel", 250, 400, "Later overlap", null, null),
            TvEpgEntry("channel", 100, 350, "Earlier overlap", null, null),
            TvEpgEntry("channel", 400, 500, "Future", null, null),
        )

        assertEquals("Earlier overlap", selectCurrentOrNextEpgEntry(overlapping, 325)?.title)
    }

    @Test
    fun choosesTheEarliestFutureProgrammeFromAnUnsortedList() {
        val unsorted = listOf(
            TvEpgEntry("channel", 500, 600, "Later", null, null),
            TvEpgEntry("channel", 100, 150, "Expired", null, null),
            TvEpgEntry("channel", 300, 400, "Next", null, null),
        )

        assertEquals("Next", selectCurrentOrNextEpgEntry(unsorted, 200)?.title)
    }

    @Test
    fun centersCatchupWindowAroundCurrentProgramme() {
        val many = (0 until 20).map { index ->
            TvEpgEntry("channel", index * 100L, (index + 1) * 100L, "Programa $index", null, null)
        }
        val window = selectEpgWindow(many, 950, 8)
        assertEquals("Programa 7", window.first().title)
        assertEquals("Programa 14", window.last().title)
        assertEquals(8, window.size)
    }
}
