package com.iptvnator.googletv.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class TvSubtitleMimeTest {
    @Test
    fun detectsCommonExternalSubtitleFormatsAndIgnoresQueryStrings() {
        assertEquals("text/vtt", subtitleMimeType("content://files/guide.VTT?name=guide"))
        assertEquals("text/x-ssa", subtitleMimeType("content://files/style.ass"))
        assertEquals("text/x-ssa", subtitleMimeType("content://files/style.ssa"))
        assertEquals("application/x-subrip", subtitleMimeType("content://files/dialogue.srt"))
    }
}
