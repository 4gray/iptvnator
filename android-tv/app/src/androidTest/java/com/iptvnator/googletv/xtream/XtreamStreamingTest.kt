package com.iptvnator.googletv.xtream

import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.Assume.assumeFalse
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.net.Socket
import java.net.InetAddress
import java.net.Inet4Address
import java.net.NetworkInterface
import java.nio.charset.StandardCharsets
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

@RunWith(AndroidJUnit4::class)
class XtreamStreamingTest {
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private lateinit var baseUrl: String

    @Before
    fun setUp() {
        assumeFalse("Local fixture sockets are unavailable on Smart TV Pro", Build.MODEL.contains("Smart TV", ignoreCase = true))
        // Bind all interfaces because some physical TV images isolate
        // instrumentation from loopback; connect through active IPv4.
        server = ServerSocket(0, 50, InetAddress.getByName("0.0.0.0"))
        serverThread = Thread {
                runCatching {
                server.accept().use { socket ->
                    val request = socket.getInputStream().bufferedReader()
                    request.readLine()
                    while (request.readLine() != "") {
                        // Consume the request headers before responding.
                    }
                    val body = """
                        [{"stream_id":101,"name":"Canal prueba","category_id":"1","category_name":"Noticias","stream_icon":"https://img.example/logo.png","epg_channel_id":"news.tv","tv_archive":1,"tv_archive_duration":72},
                         {"stream_id":102,"name":"Radio prueba","category_id":"2","category_name":"Radio","stream_icon":null,"epg_channel_id":null,"tv_archive":0,"tv_archive_duration":0}]
                    """.trimIndent().replace("\n", "")
                    val compressed = ByteArrayOutputStream().also { output ->
                        GZIPOutputStream(output).use { gzip ->
                            gzip.write(body.toByteArray(StandardCharsets.UTF_8))
                        }
                    }.toByteArray()
                    val response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Encoding: gzip\r\nContent-Length: ${compressed.size}\r\nConnection: close\r\n\r\n"
                    socket.getOutputStream().apply {
                        write(response.toByteArray(StandardCharsets.UTF_8))
                        write(compressed)
                        flush()
                    }
                }
            }
        }.also { it.start() }
        baseUrl = "http://${activeIpv4Address()}:${server.localPort}"
    }

    @After
    fun tearDown() {
        if (::server.isInitialized) server.close()
        if (::serverThread.isInitialized) serverThread.join(1_000)
    }

    @Test
    fun streamsLiveRowsWithProviderMetadata() {
        val rows = mutableListOf<XtreamLiveStream>()
        XtreamApiClient().forEachLiveStream(XtreamCredentials(baseUrl, "demo", "secret")) {
            rows += it
        }

        assertEquals(2, rows.size)
        assertEquals(101, rows[0].id)
        assertEquals("Noticias", rows[0].categoryName)
        assertEquals("news.tv", rows[0].epgChannelId)
        assertTrue(rows[0].tvArchive)
        assertEquals(72, rows[0].tvArchiveDuration)
        assertEquals(null, rows[1].iconUrl)
        assertEquals(null, rows[1].epgChannelId)
    }

    private fun activeIpv4Address(): String {
        val interfaces = NetworkInterface.getNetworkInterfaces()
        while (interfaces.hasMoreElements()) {
            val networkInterface = interfaces.nextElement()
            if (!networkInterface.isUp || networkInterface.isLoopback) continue
            val addresses = networkInterface.inetAddresses
            while (addresses.hasMoreElements()) {
                val address = addresses.nextElement()
                if (address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress) {
                    return address.hostAddress ?: continue
                }
            }
        }
        return "127.0.0.1"
    }
}
