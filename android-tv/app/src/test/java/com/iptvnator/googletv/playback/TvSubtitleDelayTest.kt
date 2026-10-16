package com.iptvnator.googletv.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class TvSubtitleDelayTest {
    @Test
    fun `shifts SRT cues and preserves comma timestamps`() {
        val source = "1\n00:00:01,000 --> 00:00:02,500\nHola\n"
        assertEquals(
            "1\n00:00:01,500 --> 00:00:03,000\nHola\n",
            shiftTvSubtitleCues(source, 500),
        )
    }

    @Test
    fun `shifts VTT cues backwards without producing negative timestamps`() {
        val source = "WEBVTT\n\n00:00:00.200 --> 00:00:01.000\nHola\n"
        assertEquals(
            "WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nHola\n",
            shiftTvSubtitleCues(source, -500),
        )
    }
}
