package com.iptvnator.googletv.epg

import com.iptvnator.googletv.tvCatchupAvailable
import com.iptvnator.googletv.isEpgProgrammePast
import com.iptvnator.googletv.playlist.TvChannel
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvEpgCatchupAvailabilityTest {
    private val now = 1_000_000L
    private val past = TvEpgEntry("channel", now - 60_000L, now - 1_000L, "Pasado", null, null)
    private val current = TvEpgEntry("channel", now - 60_000L, now + 60_000L, "En emisión", null, null)

    @Test
    fun requiresArchiveMetadata() {
        assertFalse(tvCatchupAvailable(TvChannel("id", "Canal", "https://live.example/stream"), past, now))
    }

    @Test
    fun respectsM3uArchiveDays() {
        val channel = TvChannel("id", "Canal", "https://live.example/stream", catchupDays = 1)
        assertTrue(tvCatchupAvailable(channel, past, now))
        assertFalse(tvCatchupAvailable(channel, past.copy(startMs = now - 2 * 24 * 60 * 60 * 1_000L), now))
        assertTrue("M3U shift archives should allow starting the current programme over", tvCatchupAvailable(channel, current, now))
        assertFalse("Future programmes are not available in the archive yet", tvCatchupAvailable(channel, current.copy(startMs = now + 1), now))
    }

    @Test
    fun onlyAdvertisesM3uCatchupWhenTheDeclaredRouteCanBeResolved() {
        val invalidAppend = TvChannel(
            "append", "Append", "https://live.example/stream", catchupType = "append", catchupDays = 3,
        )
        val invalidUdp = TvChannel(
            "udp", "UDP", "udp://239.0.0.1:1234", catchupDays = 3,
        )
        val appendSource = TvChannel(
            "source", "Source", "https://live.example/stream",
            catchupType = "append", catchupSource = "https://archive.example/stream?token=x", catchupDays = 3,
        )
        val shift = TvChannel(
            "shift", "Shift", "https://live.example/stream", catchupType = "shift", catchupDays = 3,
        )

        assertFalse(tvCatchupAvailable(invalidAppend, past, now))
        assertFalse(tvCatchupAvailable(invalidUdp, past, now))
        assertTrue(tvCatchupAvailable(appendSource, past, now))
        assertTrue(tvCatchupAvailable(shift, past, now))
    }

    @Test
    fun respectsXtreamArchiveDuration() {
        val channel = TvChannel("xtream:7", "Canal", "https://live.example/stream", tvArchive = true, tvArchiveDurationMinutes = 3 * 24 * 60)
        assertTrue(tvCatchupAvailable(channel, past, now))
        assertTrue(tvCatchupAvailable(channel, past.copy(startMs = now - 2 * 24 * 60 * 60 * 1_000L), now))
        assertFalse(tvCatchupAvailable(channel, past.copy(startMs = now - 4 * 24 * 60 * 60 * 1_000L), now))
        assertTrue("An enabled archive with no reported duration follows the original's unbounded window", tvCatchupAvailable(channel.copy(tvArchiveDurationMinutes = 0), past, now))
        assertTrue("Xtream archive also offers start-over for a current programme", tvCatchupAvailable(channel, current, now))
    }

    @Test
    fun doesNotAdvertiseUnsupportedStalkerCatchup() {
        val stalker = TvChannel(
            "stalker:1", "Canal", "https://live.example/stream",
            tvArchive = true, tvArchiveDurationMinutes = 60, providerCommand = "ffmpeg http://portal/play/1",
        )
        assertFalse(tvCatchupAvailable(stalker, past, now))
    }

    @Test
    fun catchupPlaybackAndDownloadUseTheSameProviderAdjustedClockAsGuideAvailability() {
        val systemNow = 1_000_000L
        val fiveMinutesAheadOnSystemClock = systemNow + 4 * 60_000L

        // With a +5 minute provider offset, this programme is already past to
        // the EPG even though its timestamp is still ahead of the device clock.
        assertTrue(isEpgProgrammePast(fiveMinutesAheadOnSystemClock, systemNow, providerClockOffsetMinutes = -5))
        // The reverse offset must not make a programme appear catch-up ready early.
        assertFalse(isEpgProgrammePast(systemNow - 4 * 60_000L, systemNow, providerClockOffsetMinutes = 5))
        assertTrue(isEpgProgrammePast(systemNow, systemNow, providerClockOffsetMinutes = 0))
    }
}
