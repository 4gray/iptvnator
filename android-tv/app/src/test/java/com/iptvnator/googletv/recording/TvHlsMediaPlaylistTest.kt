package com.iptvnator.googletv.recording

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TvHlsMediaPlaylistTest {
    @Test
    fun `retains sequence key rotation map key and end marker`() {
        val playlist = parseTvHlsMediaPlaylist(
            """
                #EXTM3U
                #EXT-X-MEDIA-SEQUENCE:42
                #EXT-X-KEY:METHOD=AES-128,URI="keys/live,rotated.bin",IV=0x1f
                #EXT-X-MAP:URI="init.mp4"
                #EXTINF:4,
                segments/first.ts
                #EXT-X-KEY:METHOD=NONE
                #EXTINF:4,
                second.ts
                #EXT-X-ENDLIST
            """.trimIndent(),
        )

        assertEquals(TvHlsInitMap("init.mp4", TvHlsEncryptionKey("AES-128", "keys/live,rotated.bin", "0x1f", "identity")), playlist.initMap)
        assertEquals(2, playlist.segments.size)
        assertEquals(TvHlsMediaSegment("segments/first.ts", 42L, TvHlsEncryptionKey("AES-128", "keys/live,rotated.bin", "0x1f", "identity")), playlist.segments[0])
        assertEquals(TvHlsMediaSegment("second.ts", 43L, null), playlist.segments[1])
        assertTrue(playlist.ended)
    }

    @Test
    fun `defaults media sequence to zero and key format to identity`() {
        val playlist = parseTvHlsMediaPlaylist(
            """
                #EXTM3U
                #EXT-X-KEY:METHOD=AES-128,URI=key.bin
                first.ts
                second.ts
            """.trimIndent(),
        )

        assertEquals(0L, playlist.segments[0].sequence)
        assertEquals(1L, playlist.segments[1].sequence)
        assertEquals("identity", playlist.segments[0].encryptionKey?.keyFormat)
        assertFalse(playlist.ended)
        assertNull(playlist.initMap)
    }

    @Test(expected = java.io.IOException::class)
    fun `rejects malformed sequence instead of using an incorrect default IV`() {
        parseTvHlsMediaPlaylist("#EXT-X-MEDIA-SEQUENCE:not-a-number\nsegment.ts")
    }

    @Test
    fun `parses explicit and implicit byte ranges and map range`() {
        val playlist = parseTvHlsMediaPlaylist(
            """
                #EXTM3U
                #EXT-X-MAP:URI="packed.mp4",BYTERANGE="4@0"
                #EXT-X-BYTERANGE:5@4
                packed.mp4
                #EXT-X-BYTERANGE:3
                packed.mp4
                #EXT-X-BYTERANGE:2@20
                packed.mp4
            """.trimIndent(),
        )

        assertEquals(TvHlsByteRange(4L, 0L), playlist.initMap?.byteRange)
        assertEquals(listOf(TvHlsByteRange(5L, 4L), TvHlsByteRange(3L, 9L), TvHlsByteRange(2L, 20L)), playlist.segments.map { it.byteRange })
    }

    @Test
    fun `tracks I-frame playlist marker so encrypted range handling stays explicit`() {
        val playlist = parseTvHlsMediaPlaylist(
            """
                #EXTM3U
                #EXT-X-I-FRAMES-ONLY
                #EXT-X-BYTERANGE:16@32
                frames.bin
            """.trimIndent(),
        )

        assertTrue(playlist.iFramesOnly)
    }

    @Test(expected = java.io.IOException::class)
    fun `rejects implicit byte range when previous segment uses another resource`() {
        parseTvHlsMediaPlaylist(
            """
                #EXTM3U
                #EXT-X-BYTERANGE:5@0
                first.mp4
                #EXT-X-BYTERANGE:3
                second.mp4
            """.trimIndent(),
        )
    }

    @Test(expected = java.io.IOException::class)
    fun `rejects map byte range without explicit offset`() {
        parseTvHlsMediaPlaylist("#EXTM3U\n#EXT-X-MAP:URI=\"packed.mp4\",BYTERANGE=\"4\"")
    }
}
