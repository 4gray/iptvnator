package com.iptvnator.googletv.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class TvVideoResizeModeTest {
    @Test
    fun `resize modes cycle in the same order exposed by the TV control`() {
        assertEquals(TvVideoResizeMode.ZOOM, TvVideoResizeMode.FIT.next())
        assertEquals(TvVideoResizeMode.FILL, TvVideoResizeMode.ZOOM.next())
        assertEquals(TvVideoResizeMode.FIT, TvVideoResizeMode.FILL.next())
    }
}
