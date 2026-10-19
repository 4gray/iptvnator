package com.iptvnator.googletv.playback

import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

class TvSubtitleStyleTest {
    @Test
    fun cyclesThroughOriginalSubtitleSizePresets() {
        val style = TvSubtitleStyle()
        assertEquals(150, style.nextSize().nextSize().sizePercent)
        assertEquals(75, TvSubtitleStyle(200).nextSize().sizePercent)
    }

    @Test
    fun cyclesThroughDefaultAndReadableSubtitleColors() {
        val style = TvSubtitleStyle()
        assertEquals(Color.WHITE, style.nextColor().colorArgb)
        assertEquals(0xFFFFE94F.toInt(), style.nextColor().nextColor().colorArgb)
        assertEquals("Predeterminado", style.colorLabel())
    }
}
