package com.iptvnator.googletv.playlist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TvAutoDetectTest {
    @Test
    fun `detects a pasted M3U body without mining channel URLs`() {
        val source = detectTvSource("""#EXTM3U
#EXTINF:-1,News
https://cdn.example/news.m3u8""")

        assertEquals("#EXTM3U\n#EXTINF:-1,News\nhttps://cdn.example/news.m3u8", (source as TvDetectedSource.M3uText).content)
    }

    @Test
    fun `detects Xtream credentials from player api URL`() {
        val source = detectTvSource("https://panel.example/player_api.php?username=alice&password=secret")

        assertEquals(
            TvDetectedSource.Xtream("https://panel.example", "alice", "secret"),
            source,
        )
    }

    @Test
    fun `detects Stalker portal and MAC`() {
        val source = detectTvSource("Portal: http://portal.example/c/\nMAC: 00:1A:79:AA:BB:CC")

        assertEquals(
            TvDetectedSource.Stalker("http://portal.example/c/", "00:1A:79:AA:BB:CC", null, null),
            source,
        )
    }

    @Test
    fun `detects optional MAG identity values in a pasted provider message`() {
        val source = detectTvSource(
            """Portal: http://portal.example/c/
                MAC: 00:1A:79:AA:BB:CC
                Serial Number: SERIAL-1
                Device ID 1: DEVICE-1
                Device ID 2: DEVICE-2
                Signature 1: SIGNATURE-1
                Signature 2: SIGNATURE-2""".trimIndent(),
        )

        assertEquals(
            TvDetectedSource.Stalker(
                "http://portal.example/c/",
                "00:1A:79:AA:BB:CC",
                null,
                null,
                serialNumber = "SERIAL-1",
                deviceId1 = "DEVICE-1",
                deviceId2 = "DEVICE-2",
                signature1 = "SIGNATURE-1",
                signature2 = "SIGNATURE-2",
            ),
            source,
        )
    }

    @Test
    fun `detects a remote M3U URL`() {
        val source = detectTvSource("https://cdn.example/list.m3u8")

        assertTrue(source is TvDetectedSource.M3uUrl)
        assertEquals("https://cdn.example/list.m3u8", (source as TvDetectedSource.M3uUrl).url)
    }
}
