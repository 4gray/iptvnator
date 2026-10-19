package com.iptvnator.googletv.stalker

import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.io.ByteArrayOutputStream
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.zip.DeflaterOutputStream
import java.util.zip.GZIPOutputStream

class StalkerApiClientTest {
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private lateinit var baseUrl: String
    @Volatile private var lastProfileQuery: Map<String, String> = emptyMap()
    @Volatile private var lastAuthQuery: Map<String, String> = emptyMap()
    @Volatile private var lastShortEpgQuery: Map<String, String> = emptyMap()

    @Before
    fun setUp() {
        server = ServerSocket(0, 8, InetSocketAddress("127.0.0.1", 0).address)
        serverThread = Thread {
            while (!server.isClosed) {
                runCatching { server.accept().use(::serve) }
            }
        }.also { it.start() }
        baseUrl = "http://127.0.0.1:${server.localPort}"
    }

    private fun serve(socket: Socket) {
        val requestLine = socket.getInputStream().bufferedReader().readLine().orEmpty()
        val target = requestLine.split(' ').getOrNull(1).orEmpty()
        val targetUri = URI(target)
        val query = parseQuery(targetUri)
        when (query["action"]) {
            "get_profile" -> lastProfileQuery = query
            "do_auth" -> lastAuthQuery = query
            "get_short_epg" -> lastShortEpgQuery = query
        }
        if (targetUri.path == "/discovery/server/load.php") {
            val output = socket.getOutputStream()
            output.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.UTF_8))
            output.flush()
            return
        }
        if (targetUri.path.contains("/fallback-failure/") &&
            query["action"] == "get_ordered_list" && query["type"] == "itv" && query["p"] == "3"
        ) {
            val output = socket.getOutputStream()
            output.write("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.UTF_8))
            output.flush()
            return
        }
        val fallbackPortal = targetUri.path.contains("/fallback/") || targetUri.path.contains("/fallback-failure/")
        val response = when (query["action"]) {
            "handshake" -> """{"js":{"token":"test-token","random":"random"}}"""
            "get_profile" -> if (targetUri.path.contains("/login-required/") && query["auth_second_step"] != "1") {
                """{"js":{"status":"2","msg":"Login required"}}"""
            } else if (targetUri.path.contains("/date-account/")) {
                """{"js":{"status":"0","account_info":{"login":"date-user","expire_date":"2026-10-01"}}}"""
            } else """{"js":{"status":"0","account_info":{"login":"demo-user","tariff_plan_name":"Premium","expire_date":1790000000}}}"""
            "get_genres" -> """{"js":[{"id":"7","title":"Noticias"}]}"""
            "do_auth" -> """{"js":true}"""
            "get_all_channels" -> if (fallbackPortal) """{"js":{"data":[]}}""" else """{"js":{"data":[{"id":"11","name":"TV Nacional","cmd":"ffrt http://example.test/11.m3u8","tv_genre_id":"7","use_http_tmp_link":"0","use_load_balancing":"0"},{"stream_id":"12","name":"Radio Nacional","cmd":"http://example.test/12.aac","radio":1}]}}"""
            "create_link" -> """{"js":{"cmd":"/media/episode-${query["type"]}-${query["series"]}.mp4"}}"""
            "get_ordered_list" -> if (targetUri.path.contains("/catalog-pages/") && query["type"] == "vod") {
                when (query["p"]) {
                    "1" -> """{"js":{"data":[{"id":"51","name":"VOD 1","cmd":"ffrt http://example.test/51.mp4"},{"id":"52","name":"VOD 2","cmd":"ffrt http://example.test/52.mp4"}],"total_items":"3","max_page_items":"2"}}"""
                    "2" -> """{"js":{"data":[{"id":"53","name":"VOD 3","cmd":"ffrt http://example.test/53.mp4"}],"total_items":"3","max_page_items":"2"}}"""
                    else -> """{"js":{"data":[],"total_items":"3","max_page_items":"2"}}"""
                }
            } else if (fallbackPortal && query["type"] == "itv") {
                when (query["p"]) {
                    "1" -> """{"js":{"data":[{"id":"21","name":"Canal 1","cmd":"ffrt http://example.test/21.m3u8"}],"total_items":"3","max_page_items":"1"}}"""
                    "2" -> """{"js":{"data":[{"id":"22","name":"Canal 2","cmd":"ffrt http://example.test/22.m3u8"}],"total_items":"3","max_page_items":"1"}}"""
                    "3" -> """{"js":{"data":[{"id":"23","name":"Canal 3","cmd":"ffrt http://example.test/23.m3u8"}],"total_items":"3","max_page_items":"1"}}"""
                    else -> """{"js":{"data":[],"total_items":"3","max_page_items":"1"}}"""
                }
            } else """{"js":[{"id":"42","name":"Película","cmd":"ffmpeg http://example.test/movie.mp4","category_name":"Estrenos","added":"1700000000"}]}"""
            "get_epg_info" -> """{"js":{"data":{"7":[{"id":"1","name":"Noticias","start_timestamp":1700000000,"stop_timestamp":1700003600,"descr":"Resumen"}],"8":[{"id":"2","name":"Radio","start_timestamp":"1700000000000","stop_timestamp":"1700003600000"}]}}}"""
            "get_short_epg" -> """{"js":{"data":[{"id":"3","name":"Ahora","start_timestamp":1700000000,"stop_timestamp":1700001800,"descr":"Resumen actual"}]}}"""
            else -> """{"js":[]}"""
        }
        val responseBytes = response.toByteArray(StandardCharsets.UTF_8)
        val encoding = when {
            targetUri.path.contains("/gzip/") -> "gzip"
            targetUri.path.contains("/deflate/") -> "deflate"
            else -> null
        }
        val bytes = when (encoding) {
            "gzip" -> ByteArrayOutputStream().also { output ->
                GZIPOutputStream(output).use { it.write(responseBytes) }
            }.toByteArray()
            "deflate" -> ByteArrayOutputStream().also { output ->
                DeflaterOutputStream(output).use { it.write(responseBytes) }
            }.toByteArray()
            else -> responseBytes
        }
        val output = socket.getOutputStream()
        output.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Encoding: ${encoding ?: "identity"}\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.UTF_8))
        output.write(bytes)
        output.flush()
    }

    @After
    fun tearDown() {
        server.close()
        serverThread.join(1_000)
    }

    @Test
    fun `loads native bulk epg with seconds and milliseconds`() {
        val client = StalkerApiClient()
        val session = client.authenticate(
            StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"),
        )

        val entries = client.getEpgInfo(session)

        assertEquals(2, entries.size)
        assertEquals("stalker:7", entries[0].channelId)
        assertEquals(1_700_000_000_000L, entries[0].startMs)
        assertEquals(1_700_003_600_000L, entries[0].endMs)
        assertEquals("Noticias", entries[0].title)
        assertEquals("Resumen", entries[0].description)
        assertEquals("stalker:8", entries[1].channelId)
        assertTrue(entries[1].startMs < entries[1].endMs)
    }

    @Test
    fun `loads short epg for one channel and caps the requested window`() {
        val client = StalkerApiClient()
        val session = client.authenticate(StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"))

        val entries = client.getShortEpgInfo(session, "stalker:21", size = 99)

        assertEquals("21", lastShortEpgQuery["ch_id"])
        assertEquals("50", lastShortEpgQuery["size"])
        assertEquals("get_short_epg", lastShortEpgQuery["action"])
        assertEquals("stalker:21", entries.single().channelId)
        assertEquals(1_700_000_000_000L, entries.single().startMs)
        assertEquals(1_700_001_800_000L, entries.single().endMs)
        assertEquals("Ahora", entries.single().title)
        assertEquals("Resumen actual", entries.single().description)
    }

    @Test
    fun `short epg window compensates for negative provider clock offset`() {
        assertEquals(3, stalkerShortEpgWindowSize(0))
        assertEquals(3, stalkerShortEpgWindowSize(120))
        assertEquals(5, stalkerShortEpgWindowSize(-30))
        assertEquals(50, stalkerShortEpgWindowSize(-720))
    }

    @Test
    fun `loads named live genres for TV catalogue grouping`() {
        val client = StalkerApiClient()
        val session = client.authenticate(StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"))

        val genres = client.getGenres(session)

        assertEquals("Noticias", genres.single { it.id == "7" }.title)
    }

    @Test
    fun `prefers the native bulk channel list for live TV`() {
        val client = StalkerApiClient()
        val session = client.authenticate(StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"))

        val channels = client.getLiveChannels(session)

        assertEquals(listOf("11", "12"), channels.map { it.id })
        assertEquals("7", channels.first().genreId)
        assertEquals(false, channels.first().useHttpTmpLink)
        assertEquals(false, channels.first().useLoadBalancing)
        assertEquals("Radio Nacional", channels.last().name)
        assertEquals(false, channels.first().radio)
        assertEquals(true, channels.last().radio)
    }

    @Test
    fun `completes the credentialed profile retry after do_auth`() {
        val client = StalkerApiClient()

        val session = client.authenticate(
            StalkerCredentials(
                "$baseUrl/login-required",
                "00:1A:79:AA:BB:CC",
                username = "user",
                password = "pass",
                serialNumber = "SERIAL-1",
                deviceId1 = "DEVICE-1",
                deviceId2 = "DEVICE-2",
                signature1 = "SIGNATURE-1",
                signature2 = "SIGNATURE-2",
            ),
        )

        assertEquals("0", session.profileStatus)
        assertEquals("SERIAL-1", lastProfileQuery["sn"])
        assertEquals("DEVICE-1", lastProfileQuery["device_id"])
        assertEquals("DEVICE-2", lastProfileQuery["device_id2"])
        assertEquals("SIGNATURE-1", lastProfileQuery["signature"])
        assertEquals("SIGNATURE-2", lastProfileQuery["signature2"])
        assertTrue(lastProfileQuery["metrics"].orEmpty().contains("\"sn\":\"SERIAL-1\""))
        assertEquals("DEVICE-1", lastAuthQuery["device_id"])
        assertEquals("DEVICE-2", lastAuthQuery["device_id2"])
        assertTrue("MAG signatures are sent with get_profile, not do_auth", !lastAuthQuery.containsKey("signature"))
    }

    @Test
    fun `keeps subscription facts exposed by the profile account block`() {
        val session = StalkerApiClient().authenticate(
            StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"),
        )

        assertEquals("demo-user", session.accountLogin)
        assertEquals("Premium", session.tariffPlanName)
        assertEquals(1_790_000_000L, session.expirationEpochSeconds)
    }

    @Test
    fun `decodes compressed handshake and catalogue responses`() {
        val client = StalkerApiClient()
        val gzipSession = client.authenticate(StalkerCredentials("$baseUrl/gzip", "00:1A:79:AA:BB:CC"))
        val deflateSession = client.authenticate(StalkerCredentials("$baseUrl/deflate", "00:1A:79:AA:BB:CC"))

        assertEquals("Noticias", client.getGenres(gzipSession).single().title)
        assertEquals("Noticias", client.getGenres(deflateSession).single().title)
    }

    @Test
    fun `accepts calendar-date subscription expirations`() {
        val session = StalkerApiClient().authenticate(
            StalkerCredentials("$baseUrl/date-account", "00:1A:79:AA:BB:CC"),
        )

        assertTrue(session.expirationEpochSeconds != null)
    }

    @Test
    fun `discovers a working sibling endpoint when the normalized path is absent`() {
        val client = StalkerApiClient()

        val session = client.authenticate(
            StalkerCredentials("$baseUrl/discovery", "00:1A:79:AA:BB:CC"),
        )

        assertTrue(session.credentials.portalUrl.endsWith("/discovery/portal.php"))
    }

    @Test
    fun `retries and crawls ordered pages when bulk channels are unsupported`() {
        val client = StalkerApiClient()
        val session = client.authenticate(
            StalkerCredentials("$baseUrl/fallback", "00:1A:79:AA:BB:CC"),
        )

        val channels = client.getLiveChannels(session)

        assertEquals(listOf("21", "22", "23"), channels.map { it.id })
    }

    @Test
    fun `fails instead of returning an incomplete Stalker channel prefix when a page remains unavailable`() {
        val client = StalkerApiClient()
        val session = client.authenticate(
            StalkerCredentials("$baseUrl/fallback-failure", "00:1A:79:AA:BB:CC"),
        )

        val failure = runCatching { client.getLiveChannels(session) }.exceptionOrNull()

        assertTrue("Expected failed page 3 to abort the catalogue, got $failure", failure?.message.orEmpty().contains("page 3"))
    }

    @Test
    fun `keeps direct category name and added timestamp from Stalker catalog`() {
        val client = StalkerApiClient()
        val session = client.authenticate(StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"))

        val item = client.getCatalog(session, "vod").single()

        assertEquals("Estrenos", item.categoryId)
        assertEquals(1_700_000_000_000L, item.addedAtMs)
    }

    @Test
    fun `keeps paging a small catalog page until the declared total is reached`() {
        val client = StalkerApiClient()
        val session = client.authenticate(StalkerCredentials("$baseUrl/catalog-pages", "00:1A:79:AA:BB:CC"))

        val items = client.getCatalog(session, "vod")

        assertEquals(listOf(51, 52, 53), items.map { it.id })
    }

    @Test
    fun `recognizes direct http radio commands without treating portal commands as streams`() {
        assertTrue(StalkerRequestBuilder.isDirectHttpStream("https://radio.example/live.aac"))
        assertTrue(StalkerRequestBuilder.isDirectHttpStream("http://radio.example/live"))
        assertTrue(!StalkerRequestBuilder.isDirectHttpStream("ffrt4://radio/40001/index.mp3"))
    }

    @Test
    fun `trusts explicit static catalog commands but keeps unknown flags conservative`() {
        assertEquals(
            "https://cdn.example/movie.mp4",
            StalkerRequestBuilder.resolveStaticPlaybackUrl(false, false, "ffmpeg https://cdn.example/movie.mp4"),
        )
        assertEquals(
            null,
            StalkerRequestBuilder.resolveStaticPlaybackUrl(null, null, "https://cdn.example/movie.mp4"),
        )
        assertEquals(
            null,
            StalkerRequestBuilder.resolveStaticPlaybackUrl(true, false, "https://cdn.example/movie.mp4"),
        )
    }

    @Test
    fun `uses vod contract when creating a legacy vod series episode link`() {
        val client = StalkerApiClient()
        val session = client.authenticate(StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"))

        val link = client.createSeriesEpisodeLink(session, "ffrt4://series/42", 3, contentType = "vod")

        assertTrue(link.endsWith("/media/episode-vod-3.mp4"))
    }

    @Test
    fun `merges legacy series returned by the vod catalog and prefers dedicated rows`() {
        val legacy = StalkerCatalogItem(7, "Legacy", "legacy-cmd", "vod", null, null, null, true)
        val dedicated = StalkerCatalogItem(7, "Dedicated", "series-cmd", "series", null, null, null, true)
        val regularMovie = StalkerCatalogItem(8, "Movie", "movie-cmd", "vod", null, null, null, false)

        val merged = mergeStalkerSeriesCatalog(listOf(legacy, regularMovie), listOf(dedicated))

        assertEquals(listOf("Dedicated"), merged.map { it.name })
    }

    @Test
    fun `extracts provider season markers instead of trusting response order`() {
        assertEquals(2, stalkerSeasonNumber("s02", 1))
        assertEquals(2, stalkerSeasonNumber("Season 2", 1))
        assertEquals(3, stalkerSeasonNumber("3 сезон", 1))
        assertEquals(4, stalkerSeasonNumber("Especial", 4))
    }

    @Test
    fun `does not forward portal credentials to a cross-origin stream`() {
        val credentials = StalkerCredentials("https://portal.example/c", "00:1A:79:AA:BB:CC")
        val headers = StalkerRequestBuilder.playbackHeaders(
            credentials,
            "portal-token",
            "https://cdn.example/live/stream.m3u8",
        )

        assertEquals("KSPlayer", headers["User-Agent"])
        assertEquals("*/*", headers["Accept"])
        assertTrue("Cookie" !in headers)
        assertTrue("Authorization" !in headers)
    }

    @Test
    fun `keeps portal credentials for a same-origin stream including a port change`() {
        val credentials = StalkerCredentials("https://portal.example/c", "00:1A:79:AA:BB:CC")
        val headers = StalkerRequestBuilder.playbackHeaders(
            credentials,
            "portal-token",
            "https://portal.example:8080/live/stream.m3u8",
        )

        assertTrue(headers["Cookie"].orEmpty().contains("mac=00:1A:79:AA:BB:CC"))
        assertEquals("Bearer portal-token", headers["Authorization"])
        assertEquals("https://portal.example", headers["Origin"])
        assertEquals("https://portal.example", headers["Referer"])
    }

    private fun parseQuery(uri: URI): Map<String, String> = uri.rawQuery.orEmpty()
        .split('&')
        .filter { it.isNotBlank() }
        .associate { part ->
            val pieces = part.split('=', limit = 2)
            URLDecoder.decode(pieces[0], "UTF-8") to URLDecoder.decode(pieces.getOrElse(1) { "" }, "UTF-8")
        }
}
