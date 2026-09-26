package com.iptvnator.googletv.playback

import android.net.Uri
import androidx.media3.datasource.DataSpec
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

@androidx.media3.common.util.UnstableApi
class TvPlaybackRequestHeadersIntegrationTest {
    @Test
    fun requestHeadersStayBoundToTheirMediaItemFactories() {
        val server = ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))
        val requests = ConcurrentHashMap<String, Map<String, String>>()
        val serverFailure = AtomicReference<Throwable?>(null)
        val serverThread = thread(name = "iptvnator-per-source-headers-fixture", isDaemon = true) {
            try {
                repeat(2) {
                    server.accept().use { socket ->
                        socket.soTimeout = 5_000
                        val input = socket.getInputStream()
                        val requestTarget = readHttpLine(input).split(' ').getOrNull(1)
                            ?: error("The fixture received a malformed HTTP request line")
                        val headers = linkedMapOf<String, String>()
                        while (true) {
                            val line = readHttpLine(input)
                            if (line.isEmpty()) break
                            val separator = line.indexOf(':')
                            if (separator > 0) {
                                headers[line.substring(0, separator).trim().lowercase()] =
                                    line.substring(separator + 1).trim()
                            }
                        }
                        requests[requestTarget] = headers
                        socket.getOutputStream().write(
                            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                                .toByteArray(Charsets.US_ASCII),
                        )
                    }
                }
            } catch (failure: Throwable) {
                serverFailure.set(failure)
            }
        }

        try {
            val client = OkHttpClient()
            // Construct both source factories before opening either request.
            // Creating the next channel must not mutate headers for the first.
            val alphaFactory = createTvPlaybackHttpDataSourceFactory(
                client,
                mapOf("Authorization" to "Bearer alpha", "X-Playlist" to "alpha"),
                "IPTVnator-alpha",
            )
            val betaFactory = createTvPlaybackHttpDataSourceFactory(
                client,
                mapOf("Authorization" to "Bearer beta", "X-Playlist" to "beta"),
                "IPTVnator-beta",
            )
            listOf(alphaFactory to "/alpha", betaFactory to "/beta").forEach { (factory, path) ->
                val source = factory.createDataSource()
                try {
                    source.open(DataSpec(Uri.parse("http://127.0.0.1:${server.localPort}$path")))
                } finally {
                    source.close()
                }
            }
            serverThread.join(5_000)

            serverFailure.get()?.let { throw AssertionError("The local stream fixture failed", it) }
            assertEquals("Both channel requests should reach the local fixture", 2, requests.size)
            val alpha = requests["/alpha"] ?: throw AssertionError("The first channel request should be recorded")
            val beta = requests["/beta"] ?: throw AssertionError("The second channel request should be recorded")
            assertEquals("Bearer alpha", alpha["authorization"])
            assertEquals("alpha", alpha["x-playlist"])
            assertEquals("IPTVnator-alpha", alpha["user-agent"])
            assertEquals("Bearer beta", beta["authorization"])
            assertEquals("beta", beta["x-playlist"])
            assertEquals("IPTVnator-beta", beta["user-agent"])
        } finally {
            server.close()
            serverThread.join(1_000)
        }
    }

    private fun readHttpLine(input: java.io.InputStream): String {
        val bytes = ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value < 0 || value == '\n'.code) break
            if (value != '\r'.code) bytes.write(value)
        }
        return bytes.toByteArray().toString(Charsets.UTF_8)
    }
}
