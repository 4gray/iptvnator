package com.iptvnator.googletv.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import com.iptvnator.googletv.playback.TvPlaybackRequest

class TvLiveRecordingManagerTest {
    @Test
    fun `safe filename keeps readable titles and removes path separators`() {
        assertEquals("Noticias_Noche_1080p", TvLiveRecordingManager.safeFileName(" Noticias / Noche: 1080p "))
    }

    @Test
    fun `blank or punctuation-only titles receive a stable fallback`() {
        assertEquals("iptvnator-recording", TvLiveRecordingManager.safeFileName(" /:*? "))
        assertTrue(TvLiveRecordingManager.safeFileName("Canal 1").length <= 80)
    }

    @Test
    fun `DASH streams are not mislabeled as transport stream recordings`() {
        val byExtension = TvPlaybackRequest("https://iptv.invalid/live/channel.mpd?token=redacted", "DASH")
        val byMimeType = TvPlaybackRequest("https://iptv.invalid/live/channel", "DASH", mimeType = "application/dash+xml")

        assertTrue(TvLiveRecordingManager.isDashStream(byExtension))
        assertTrue(TvLiveRecordingManager.isDashStream(byMimeType))
        assertFalse(TvLiveRecordingManager.isDashStream(TvPlaybackRequest("https://iptv.invalid/live/channel.m3u8", "HLS")))
    }
}
