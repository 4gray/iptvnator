package com.iptvnator.googletv.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class TvPlaybackSpeedTest {
    @Test
    fun `speed cycle matches the original presets including half speed`() {
        assertEquals(listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f), TV_PLAYBACK_SPEED_OPTIONS)
        assertEquals(0.75f, nextTvPlaybackSpeed(0.5f))
        assertEquals(0.5f, nextTvPlaybackSpeed(2f))
        assertEquals("0,5", playbackSpeedLabel(0.5f))
    }
}
