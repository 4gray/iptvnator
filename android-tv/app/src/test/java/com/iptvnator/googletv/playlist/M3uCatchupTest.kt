package com.iptvnator.googletv.playlist

import com.iptvnator.googletv.epg.TvEpgEntry
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test

class M3uCatchupTest {
    private val programme = TvEpgEntry("news", 1_775_820_000_000, 1_775_821_800_000, "Noticias")

    @Test
    fun `rewrites utc and lutc on catchup source`() {
        val channel = TvChannel(
            id = "news",
            name = "News",
            url = "http://live.example/news.m3u8",
            catchupSource = "https://archive.example/news?token=x",
            catchupDays = 7,
        )
        assertEquals(
            "https://archive.example/news?token=x&utc=1775820000&lutc=1775906400",
            resolveM3uCatchupUrl(channel, programme, nowMs = 1_775_906_400_000),
        )
    }

    @Test
    fun `replaces catchup query parameters in place and drops duplicates like URLSearchParams`() {
        val channel = TvChannel(
            id = "news",
            name = "News",
            url = "http://live.example/news.m3u8",
            catchupSource = "https://archive.example/news?utc=1&token=a+b&lutc=2&utc=3",
            catchupDays = 7,
        )

        assertEquals(
            "https://archive.example/news?utc=1775820000&token=a+b&lutc=1775906400",
            resolveM3uCatchupUrl(channel, programme, nowMs = 1_775_906_400_000),
        )
    }

    @Test
    fun `accepts and encodes catchup source templates and spaces`() {
        val channel = TvChannel(
            id = "news",
            name = "News",
            url = "http://live.example/news.m3u8",
            catchupSource = "https://archive.example/catch up/{utc}?token={access token}",
            catchupDays = 7,
        )

        assertTrue(supportsM3uCatchup(channel))
        val resolved = URI(requireNotNull(
            resolveM3uCatchupUrl(channel, programme, nowMs = 1_775_906_400_000),
        ))
        assertEquals("/catch%20up/%7Butc%7D", resolved.rawPath)
        val query = requireNotNull(resolved.rawQuery).split('&').associate { parameter ->
            val (key, value) = parameter.split('=', limit = 2)
            URLDecoder.decode(key, StandardCharsets.UTF_8.name()) to
                URLDecoder.decode(value, StandardCharsets.UTF_8.name())
        }
        assertEquals("{access token}", query["token"])
        assertEquals("1775820000", query["utc"])
        assertEquals("1775906400", query["lutc"])
    }

    @Test
    fun `normalizes existing query values like browser URLSearchParams`() {
        val channel = TvChannel(
            id = "news",
            name = "News",
            url = "http://live.example/news.m3u8",
            catchupSource = "https://archive.example/news?token=a%20b&broken=%",
            catchupDays = 7,
        )

        assertEquals(
            "https://archive.example/news?token=a+b&broken=%25&utc=1775820000&lutc=1775906400",
            resolveM3uCatchupUrl(channel, programme, nowMs = 1_775_906_400_000),
        )
    }

    @Test
    fun `uses the stream url for default shift mode`() {
        val channel = TvChannel("news", "News", "http://live.example/news.m3u8", catchupDays = 2)
        assertEquals(
            "http://live.example/news.m3u8?utc=1775820000&lutc=1775906400",
            resolveM3uCatchupUrl(channel, programme, nowMs = 1_775_906_400_000),
        )
    }

    @Test
    fun `current programme start-over ends its archive window at now`() {
        val nowMs = 1_775_906_400_000L
        val channel = TvChannel(
            id = "news",
            name = "News",
            url = "http://live.example/news.m3u8",
            catchupDays = 2,
        )
        val currentProgramme = programme.copy(
            startMs = nowMs - 5 * 60_000L,
            endMs = nowMs + 25 * 60_000L,
        )

        assertEquals(
            "http://live.example/news.m3u8?utc=1775906100&lutc=1775906400",
            resolveM3uCatchupUrl(channel, currentProgramme, nowMs = nowMs),
        )
    }

    @Test
    fun `rejects catchup without an archive window`() {
        val channel = TvChannel("news", "News", "http://live.example/news.m3u8")
        assertNull(resolveM3uCatchupUrl(channel, programme))
    }
}
