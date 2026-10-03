@file:androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])

package com.iptvnator.googletv.playback

import androidx.media3.exoplayer.ExoPlaybackException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvPlaybackReconnectPolicyTest {
    @Test
    fun `uses the original capped exponential reconnect backoff`() {
        assertEquals(
            listOf(2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L),
            (1..TV_PLAYBACK_RECONNECT_MAX_ATTEMPTS).map(::tvPlaybackReconnectDelayMs),
        )
        assertEquals(0L, tvPlaybackReconnectDelayMs(0))
        assertEquals(0L, tvPlaybackReconnectDelayMs(7))
    }

    @Test
    fun `retries media-source failures but not renderer or internal engine errors`() {
        assertTrue(isRetryableTvPlaybackErrorType(ExoPlaybackException.TYPE_SOURCE))
        assertFalse(isRetryableTvPlaybackErrorType(ExoPlaybackException.TYPE_RENDERER))
        assertFalse(isRetryableTvPlaybackErrorType(ExoPlaybackException.TYPE_UNEXPECTED))
        assertFalse(isRetryableTvPlaybackErrorType(ExoPlaybackException.TYPE_REMOTE))
    }
}
