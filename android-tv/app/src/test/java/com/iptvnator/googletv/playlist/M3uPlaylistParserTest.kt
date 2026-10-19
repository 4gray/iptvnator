package com.iptvnator.googletv.playlist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.StringReader

class M3uPlaylistParserTest {
    @Test
    fun `streaming parse emits same channels and metadata as string parse`() {
        val content = """#EXTM3U x-tvg-url="https://guide.example/one.xml"
#EXTINF:-1 group-title="News",First
https://tv.example/first
#EXTINF:-1 radio="true",Second
https://radio.example/second"""
        val streamed = mutableListOf<TvChannel>()
        val metadata = M3uPlaylistParser.parse(StringReader(content).buffered(), "Remote", streamed::add)
        val materialized = M3uPlaylistParser.parse(content, "Remote")

        assertEquals(materialized, metadata.copy(channels = streamed))
    }

    @Test
    fun `parses channel metadata and provider user agent`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1 tvg-id="news.es" tvg-logo="https://cdn/logo.png" group-title="Noticias",News ES
#EXTVLCOPT:http-user-agent=ProviderAgent/1.0
https://provider/live/news.m3u8
""".trimIndent(),
            fallbackName = "Remote source",
        )

        assertEquals("Remote source", playlist.name)
        assertEquals(1, playlist.channels.size)
        assertEquals("news.es", playlist.channels.single().tvgId)
        assertNull(playlist.channels.single().tvgName)
        assertEquals("Noticias", playlist.channels.single().group)
        assertEquals("ProviderAgent/1.0", playlist.channels.single().userAgent)
        assertEquals("https://provider/live/news.m3u8", playlist.channels.single().url)
    }

    @Test
    fun `treats extinf attribute names case insensitively like the original parser`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1 TvG-Id="news.es" TVG-LOGO="https://cdn/logo.png" GROUP-TITLE="Noticias" TvG-ChNo="101",News ES
https://provider/live/news.m3u8""".trimIndent(),
        )

        assertEquals("news.es", playlist.channels.single().tvgId)
        assertEquals("https://cdn/logo.png", playlist.channels.single().logoUrl)
        assertEquals("Noticias", playlist.channels.single().group)
        assertEquals(101, playlist.channels.single().channelNumber)
    }

    @Test
    fun `keeps commas inside quoted extinf attributes separate from the channel title`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1 group-title="Noticias, España" tvg-name="Canal, Nacional" tvg-id="news.es",La 1, en directo
https://provider/live/news.m3u8""".trimIndent(),
        )

        val channel = playlist.channels.single()
        assertEquals("Noticias, España", channel.group)
        assertEquals("Canal, Nacional", channel.tvgName)
        assertEquals("La 1, en directo", channel.name)
    }

    @Test
    fun `keeps entries with duplicate tvg ids as distinct channels`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1 tvg-id="shared" group-title="News",First
https://provider.example/first.m3u8
#EXTINF:-1 tvg-id="shared" group-title="Sports",Second
https://provider.example/second.m3u8
#EXTINF:-1 tvg-id="shared" group-title="Movies",Third
https://provider.example/third.m3u8""".trimIndent(),
        )

        assertEquals(3, playlist.channels.size)
        assertEquals(3, playlist.channels.map(TvChannel::id).distinct().size)
        assertEquals(listOf("shared", "shared", "shared"), playlist.channels.map(TvChannel::tvgId))
        assertEquals(listOf("First", "Second", "Third"), playlist.channels.map(TvChannel::name))
    }

    @Test
    fun `preserves tvg-name as the epg fallback key`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1 tvg-id="" tvg-name="Guide News" group-title="News",Provider display title
https://provider/news.m3u8""".trimIndent(),
        )

        assertEquals("Guide News", playlist.channels.single().tvgName)
        assertEquals("Provider display title", playlist.channels.single().name)
    }

    @Test
    fun `uses extgrp for entries without a group title`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTGRP:Sports
#EXTINF:-1,Match
https://provider/match.ts
""".trimIndent(),
        )

        assertEquals("Sports", playlist.channels.single().group)
        assertNull(playlist.channels.single().logoUrl)
        assertNotNull(playlist.channels.single().id)
    }

    @Test
    fun `does not leak extgrp from one channel into later entries`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTGRP:Sports
#EXTINF:-1,Match
https://provider/match.ts
#EXTINF:-1 group-title="News",News
https://provider/news.ts
#EXTINF:-1,Uncategorised
https://provider/other.ts""".trimIndent(),
        )

        assertEquals("Sports", playlist.channels[0].group)
        assertEquals("News", playlist.channels[1].group)
        assertNull(playlist.channels[2].group)
    }

    @Test
    fun `preserves referrer and origin headers for playback`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1 http-referrer="https://portal.example/player" http-origin="https://portal.example",Protected
#EXTVLCOPT:http-user-agent=Player/1.0
#EXTVLCOPT:http-referrer=https://portal.example/referrer
#EXTVLCOPT:http-origin=https://portal.example
https://portal.example/live/protected.m3u8""".trimIndent(),
        )

        assertEquals(
            mapOf("Referer" to "https://portal.example/referrer", "Origin" to "https://portal.example"),
            playlist.channels.single().headers,
        )
    }

    @Test
    fun `preserves xmltv url from m3u header`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U url-tvg="https://guide.example/xmltv.xml"
#EXTINF:-1,News
https://stream.example/news""",
        )
        assertEquals("https://guide.example/xmltv.xml", playlist.epgUrl)
    }

    @Test
    fun `applies header catchup window to every channel`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U catchup="append" catchup-days="3" catchup-source="https://archive.example/{utc}"
#EXTINF:-1,News
https://stream.example/news
""".trimIndent(),
        )

        val channel = playlist.channels.single()
        assertEquals(true, channel.tvArchive)
        assertEquals(3 * 24 * 60, channel.tvArchiveDurationMinutes)
        assertEquals(3, channel.catchupDays)
        assertEquals("append", channel.catchupType)
        assertEquals("https://archive.example/{utc}", channel.catchupSource)
    }

    @Test
    fun `accepts all common xmltv header aliases`() {
        listOf("x-tvg-url", "url-tvg", "tvg-url").forEach { header ->
            val playlist = M3uPlaylistParser.parse(
                """#EXTM3U $header="https://guide.example/$header.xml"
#EXTINF:-1,News
https://stream.example/news""",
            )
            assertEquals("https://guide.example/$header.xml", playlist.epgUrl)
        }
    }

    @Test
    fun `ignores local xmltv paths declared by a remote playlist`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U x-tvg-url="file:///tmp/local.xml, https://guide.example/remote.xml"
#EXTINF:-1,News
https://stream.example/news""",
        )
        assertEquals("https://guide.example/remote.xml", playlist.epgUrl)
    }

    @Test
    fun `preserves all remote xmltv urls from the common header aliases`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U x-tvg-url="https://guide.example/one.xml, https://guide.example/two.xml" url-tvg="https://guide.example/three.xml"
#EXTINF:-1,News
https://stream.example/news""",
        )

        assertEquals(
            listOf(
                "https://guide.example/one.xml",
                "https://guide.example/two.xml",
                "https://guide.example/three.xml",
            ),
            playlist.epgUrls,
        )
        assertEquals(playlist.epgUrls.first(), playlist.epgUrl)
    }

    @Test
    fun `recommends country-matched guides instead of the first five`() {
        val urls = listOf(
            "https://epg.example/guides/us-en/guide.xml",
            "https://epg.example/guides/gb-en/guide.xml",
            "https://epg.example/guides/fr-fr/guide.xml",
            "https://epg.example/guides/pt-pt/guide.xml",
            "https://epg.example/guides/de-de/guide.xml",
            "https://epg.example/guides/it-it/guide.xml",
        )
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U x-tvg-url="${urls.joinToString(",")}" 
#EXTINF:-1 tvg-country="PT" tvg-id="channel.pt",Canal
https://stream.example/live""".trimIndent(),
        )

        assertEquals(urls, playlist.epgUrls)
        assertEquals(listOf(urls[3]), playlist.recommendedEpgUrls)
    }

    @Test
    fun `recommends guides by language when the playlist has no country hints`() {
        val urls = listOf(
            "https://epg.example/guides/us-en/guide.xml",
            "https://epg.example/guides/es-es/guide.xml",
            "https://epg.example/guides/gb-en/guide.xml",
            "https://epg.example/guides/fr-fr/guide.xml",
            "https://epg.example/guides/pt-pt/guide.xml",
            "https://epg.example/guides/mx-es/guide.xml",
        )
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U url-tvg="${urls.joinToString(",")}" 
#EXTINF:-1 tvg-language="Spanish",Canal
https://stream.example/live""".trimIndent(),
        )

        assertEquals(listOf(urls[1], urls[5]), playlist.recommendedEpgUrls)
    }

    @Test
    fun `falls back to first five guides when region metadata has no match`() {
        val urls = (1..6).map { "https://epg.example/guides/gb-en/$it.xml" }
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U x-tvg-url="${urls.joinToString(",")}" 
#EXTINF:-1 tvg-country="ES",Canal
https://stream.example/live""".trimIndent(),
        )

        assertEquals(urls.take(5), playlist.recommendedEpgUrls)
    }

    @Test
    fun `recommends epgshare01 guides by the country in their file name`() {
        val base = "https://epgshare01.online/epgshare01/epg_ripper_"
        val urls = listOf("AL1", "ALJAZEERA1", "ALL_SOURCES1", "AR1", "AT1", "ES1", "RAKUTEN_ES1", "RALLY_TV1")
            .map { "$base$it.xml.gz" }
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U x-tvg-url="${urls.joinToString(", ")}"
#EXTINF:-1 tvg-id="La1.es" tvg-country="ES" group-title="Spain",La 1
https://stream.example/la1.m3u8""".trimIndent(),
        )

        assertEquals(listOf("${base}ES1.xml.gz", "${base}RAKUTEN_ES1.xml.gz"), playlist.recommendedEpgUrls)
    }

    @Test
    fun `fallback never auto-imports catch-all aggregate guides`() {
        val base = "https://epgshare01.online/epgshare01/epg_ripper_"
        val urls = listOf("AL1", "ALL_SOURCES1", "AR1", "AT1", "AU1", "BE2", "BR1").map { "$base$it.xml.gz" }
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U x-tvg-url="${urls.joinToString(",")}"
#EXTINF:-1 tvg-country="JP",Canal
https://stream.example/live""".trimIndent(),
        )

        assertEquals(urls.filterNot { "ALL_SOURCES" in it }.take(5), playlist.recommendedEpgUrls)
    }

    @Test
    fun `keeps radio entries separate from video channels`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1 radio="true" group-title="Jazz",Jazz FM
https://radio.example/jazz.aac
#EXTINF:-1 radio="false",News TV
https://tv.example/news.m3u8""".trimIndent(),
        )

        assertEquals(true, playlist.channels[0].radio)
        assertEquals(false, playlist.channels[1].radio)
    }

    @Test
    fun `parses tvg channel numbers for remote control selection`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1 tvg-chno="101",News
https://tv.example/news
#EXTINF:-1 channel-number="7",Sports
https://tv.example/sports""".trimIndent(),
        )

        assertEquals(101, playlist.channels[0].channelNumber)
        assertEquals(7, playlist.channels[1].channelNumber)
    }

    @Test
    fun `preserves ClearKey KODIPROP metadata for Media3 playback`() {
        val playlist = M3uPlaylistParser.parse(
            """#KODIPROP:inputstream.adaptive.license_type=clearkey
#KODIPROP:inputstream.adaptive.license_key=00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100
#EXTM3U
#EXTINF:-1,Protected
https://provider.example/protected.mpd""",
        )

        assertEquals(true, playlist.channels.single().drm?.supported)
        assertEquals(
            "ffeeddccbbaa99887766554433221100",
            playlist.channels.single().drm?.clearKeys?.get("00112233445566778899aabbccddeeff"),
        )
    }

    @Test
    fun `preserves native Widevine KODIPROP license metadata`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
#KODIPROP:inputstream.adaptive.license_key=https://license.example.test/widevine|Content-Type=application/octet-stream&Authorization=Bearer%20token|R{SSM}|R
#EXTINF:-1,Protected DASH
https://provider.example/protected.mpd""",
        )

        assertEquals(true, playlist.channels.single().drm?.supported)
        assertEquals("https://license.example.test/widevine", playlist.channels.single().drm?.licenseUrl)
        assertEquals("application/octet-stream", playlist.channels.single().drm?.licenseHeaders?.get("Content-Type"))
        assertEquals("Bearer token", playlist.channels.single().drm?.licenseHeaders?.get("Authorization"))
        assertEquals("R{SSM}", playlist.channels.single().drm?.licenseRequestData)
        assertEquals("R", playlist.channels.single().drm?.licenseResponseData)
    }

    @Test
    fun `strips pipe options into playback headers`() {
        val playlist = M3uPlaylistParser.parse(
            """#EXTM3U
#EXTINF:-1,Piped
https://provider.example/live.ts|User-Agent=CustomUA&Referer=https://ref.example&Origin=https://origin.example""".trimIndent(),
        )

        assertEquals("https://provider.example/live.ts", playlist.channels.single().url)
        assertEquals("CustomUA", playlist.channels.single().userAgent)
        assertEquals(
            mapOf("Referer" to "https://ref.example", "Origin" to "https://origin.example"),
            playlist.channels.single().headers,
        )
    }

    @Test
    fun `accepts utf8 bom and keeps comments between metadata and url`() {
        val playlist = M3uPlaylistParser.parse(
            "\uFEFF#EXTM3U\n#EXTINF:-1,One\n# comment\n#EXT-X-SESSION-DATA:VALUE=x\nhttps://provider.example/one",
        )

        assertEquals(1, playlist.channels.size)
        assertEquals("https://provider.example/one", playlist.channels.single().url)
    }
}
