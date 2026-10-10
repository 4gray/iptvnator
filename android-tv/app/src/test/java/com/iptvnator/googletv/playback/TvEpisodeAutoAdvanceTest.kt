package com.iptvnator.googletv.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvEpisodeAutoAdvanceTest {
    @Test
    fun `auto advances only when enabled for a non-live video with a next episode`() {
        assertTrue(
            shouldAutoAdvanceEpisode(
                autoPlayEnabled = true,
                isLive = false,
                isAudio = false,
                hasNextEpisode = true,
            ),
        )
    }

    @Test
    fun `does not auto advance when disabled`() {
        assertFalse(shouldAutoAdvanceEpisode(false, isLive = false, isAudio = false, hasNextEpisode = true))
    }

    @Test
    fun `does not auto advance live or audio playback`() {
        assertFalse(shouldAutoAdvanceEpisode(true, isLive = true, isAudio = false, hasNextEpisode = true))
        assertFalse(shouldAutoAdvanceEpisode(true, isLive = false, isAudio = true, hasNextEpisode = true))
    }

    @Test
    fun `does not auto advance at the end of a season`() {
        assertFalse(shouldAutoAdvanceEpisode(true, isLive = false, isAudio = false, hasNextEpisode = false))
    }
}
