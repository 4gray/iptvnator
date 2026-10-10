package com.iptvnator.googletv.xtream

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

class XtreamApiClientTest {
    @Test
    fun `converts Xtream archive days to stored minutes without overflow`() {
        assertEquals(4_320, xtreamArchiveDurationMinutes(3))
        assertEquals(0, xtreamArchiveDurationMinutes(-1))
        assertEquals(Int.MAX_VALUE, xtreamArchiveDurationMinutes(Int.MAX_VALUE))
    }

    @Test
    fun `chooses automatic live format from provider capabilities`() {
        val client = XtreamApiClient()
        assertEquals("m3u8", client.autoLiveStreamExtension(listOf("ts", "m3u8")))
        assertEquals("ts", client.autoLiveStreamExtension(listOf("ts")))
        assertEquals("m3u8", client.autoLiveStreamExtension(emptyList()))
    }

    @Test
    fun `does not treat expired auth flag as an active account`() {
        assertTrue(!isXtreamAccountAuthenticated(true, "Expired", 2_000, nowEpochSeconds = 1_000))
        assertTrue(!isXtreamAccountAuthenticated(true, "Active", 900, nowEpochSeconds = 1_000))
        assertTrue(isXtreamAccountAuthenticated(true, "Active", 2_000, nowEpochSeconds = 1_000))
    }
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private lateinit var baseUrl: String

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
        val query = parseQuery(URI(target))
        val response = when (query["action"]) {
                "get_account_info" -> if (query["username"] == "profile-only") {
                    "{}"
                } else if (query["username"] == "unlimited") {
                    """{"user_info":{"auth":1,"status":"Active","username":"unlimited","exp_date":"0"}}"""
                } else """{"user_info":{"auth":1,"status":"Active","username":"demo","exp_date":"4102444800","active_cons":"1","max_connections":"2","allowed_output_formats":["m3u8","ts"]},"server_info":{"url":"mock.xtream.local","timezone":"Europe/Madrid"}}"""
                null -> if (query["username"] == "profile-only") {
                    "{}"
                } else """{"user_info":{"auth":1,"status":"Active","username":"demo","exp_date":"4102444800"}}"""
                "get_profile" -> if (query["username"] == "profile-only") {
                    """{"user_info":{"auth":1,"status":"Active","username":"profile-only","exp_date":"4102444800"}}"""
                } else "[]"
                "get_live_categories" -> """[{"category_id":"1","category_name":"Noticias"}]"""
                "get_vod_categories" -> """[{"category_id":"2","category_name":"Películas"}]"""
                "get_series_categories" -> """[{"category_id":"3","category_name":"Series"}]"""
                "get_live_streams" -> """[{"stream_id":101,"name":"Canal prueba","category_id":"1","category_name":"Noticias","stream_icon":"","epg_channel_id":"test","tv_archive":0,"tv_archive_duration":0}]"""
                "get_vod_streams" -> """[{"stream_id":201,"name":"Película prueba","category_id":"2","category_name":"Películas","stream_icon":"","container_extension":"mp4","rating":"8.1","added":"1700000000"}]"""
                "get_series" -> """[{"series_id":301,"name":"Serie prueba","category_id":"3","category_name":"Series","cover":"","plot":"Descripción","rating":"7.4","added":1700003600}]"""
                "get_series_info" -> """{"info":{"name":"Serie prueba","plot":"Descripción de la serie"},"episodes":{"1":[{"id":401,"title":"Episodio prueba","season":1,"episode_num":1,"container_extension":"mp4","info":"{\"video\":{\"codec_name\":\"h264\",\"duration\":\"3600\"}}"}]}}"""
                else -> "[]"
            }.trimIndent().replace("\n", "")
        val responseBytes = response.toByteArray(StandardCharsets.UTF_8)
        val encoding = query["username"]?.takeIf { it == "gzip" || it == "deflate" }
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
    fun `loads account and all catalog types through Xtream API`() {
        val client = XtreamApiClient()
        val credentials = XtreamCredentials(baseUrl, "demo", "secret")

        val account = client.getAccountInfo(credentials)
        val live = client.getLiveStreams(credentials)
        val vod = client.getVodStreams(credentials)
        val series = client.getSeries(credentials)
        val categories = client.getCategories(credentials, XtreamCatalogType.VOD)

        assertTrue("account=$account", account.authenticated)
        assertEquals("demo", account.username)
        assertEquals("mock.xtream.local", account.serverUrl)
        assertEquals(1, account.activeConnections)
        assertEquals(2, account.maxConnections)
        assertEquals(listOf("m3u8", "ts"), account.allowedOutputFormats)
        assertEquals("Canal prueba", live.single().name)
        assertEquals("Noticias", live.single().categoryName)
        assertEquals(201, vod.single().id)
        assertEquals("Películas", vod.single().categoryName)
        assertEquals(1_700_000_000_000L, vod.single().addedAtMs)
        assertEquals(301, series.single().id)
        assertEquals("Series", series.single().categoryName)
        assertEquals(1_700_003_600_000L, series.single().addedAtMs)
        assertEquals("Películas", categories.single().name)
    }

    @Test
    fun `treats zero expiration as an unlimited active account`() {
        val account = XtreamApiClient().getAccountInfo(
            XtreamCredentials(baseUrl, "unlimited", "secret"),
        )

        assertTrue(account.authenticated)
        assertEquals(null, account.expirationEpochSeconds)
    }

    @Test
    fun `streams gzip and deflate catalogues`() {
        val client = XtreamApiClient()
        val gzip = client.getLiveStreams(XtreamCredentials(baseUrl, "gzip", "secret"))
        val deflate = client.getLiveStreams(XtreamCredentials(baseUrl, "deflate", "secret"))

        assertEquals("Canal prueba", gzip.single().name)
        assertEquals("Canal prueba", deflate.single().name)
    }

    @Test
    fun `falls back from unreachable https listener to http`() {
        val client = XtreamApiClient()
        val httpsUrl = baseUrl.replaceFirst("http://", "https://")

        val resolved = client.resolveWorkingCredentials(XtreamCredentials(httpsUrl, "demo", "secret"))

        assertTrue(resolved.second.authenticated)
        assertEquals("demo", resolved.second.username)
        assertEquals(baseUrl, resolved.first.serverUrl)
    }

    @Test
    fun `tries account action variants until user info is present`() {
        val resolved = XtreamApiClient().resolveWorkingCredentials(
            XtreamCredentials(baseUrl, "profile-only", "secret"),
        )

        assertTrue(resolved.second.authenticated)
        assertEquals("profile-only", resolved.second.username)
    }

    @Test
    fun `does not expose provider media json as episode synopsis`() {
        val client = XtreamApiClient()
        val details = client.getSeriesInfo(XtreamCredentials(baseUrl, "demo", "secret"), 301)

        assertEquals(1, details.episodes.size)
        assertEquals(null, details.episodes.single().plot)
    }

    private fun parseQuery(uri: URI): Map<String, String> = uri.rawQuery.orEmpty()
        .split('&')
        .filter { it.isNotBlank() }
        .associate { part ->
            val pieces = part.split('=', limit = 2)
            URLDecoder.decode(pieces[0], "UTF-8") to URLDecoder.decode(pieces.getOrElse(1) { "" }, "UTF-8")
        }
}
