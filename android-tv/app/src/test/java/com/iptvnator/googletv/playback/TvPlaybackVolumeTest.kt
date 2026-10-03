package com.iptvnator.googletv.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class TvPlaybackVolumeTest {
    @Test
    fun finiteValuesAreClampedToTheMediaPlayerRange() {
        assertEquals(0f, normalizeTvPlayerVolume(-0.25f), 0f)
        assertEquals(0.37f, normalizeTvPlayerVolume(0.37f), 0f)
        assertEquals(1f, normalizeTvPlayerVolume(1.25f), 0f)
    }

    @Test
    fun nonFinitePreferenceValuesFallBackToFullVolume() {
        assertEquals(1f, normalizeTvPlayerVolume(Float.NaN), 0f)
        assertEquals(1f, normalizeTvPlayerVolume(Float.POSITIVE_INFINITY), 0f)
        assertEquals(1f, normalizeTvPlayerVolume(Float.NEGATIVE_INFINITY), 0f)
    }
}
