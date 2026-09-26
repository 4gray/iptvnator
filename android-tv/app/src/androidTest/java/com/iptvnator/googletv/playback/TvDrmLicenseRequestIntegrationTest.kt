package com.iptvnator.googletv.playback

import androidx.media3.common.C
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.drm.ExoMediaDrm
import okhttp3.OkHttpClient
import com.iptvnator.googletv.parseTvDrmProperties
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

@androidx.media3.common.util.UnstableApi
class TvDrmLicenseRequestIntegrationTest {
    @Test
    fun manifestLicenseUrlAndKodiHeadersReachTheMedia3LicenseRequest() {
        val drm = parseTvDrmProperties(
            mapOf(
                "inputstream.adaptive.license_type" to "com.widevine.alpha",
                "inputstream.adaptive.license_key" to "|Authorization=Bearer%20test-token&X-Client=Google%20TV|R{SSM}|R",
            ),
        ) ?: throw AssertionError("Expected the supported Widevine KODIPROP block to parse")
        assertTrue("The standard raw challenge/response mode should be supported", drm.supported)
        val drmConfiguration = createTvNetworkDrmConfiguration(drm)
            ?: throw AssertionError("The manifest-license DRM configuration should be created")
        assertEquals(C.WIDEVINE_UUID, drmConfiguration.scheme)
        assertNull("The license URL should be supplied by the manifest", drmConfiguration.licenseUri)
        assertEquals(drm.licenseHeaders, drmConfiguration.licenseRequestHeaders)

        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val receivedHeaders = AtomicReference<Map<String, String>?>(null)
        val receivedBody = AtomicReference<ByteArray?>(null)
        val serverFailure = AtomicReference<Throwable?>(null)
        val serverThread = thread(name = "iptvnator-drm-license-header-fixture", isDaemon = true) {
            try {
                server.accept().use { socket ->
                    socket.soTimeout = 5_000
                    val input = socket.getInputStream()
                    readHttpLine(input) // Request line.
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
                    val length = headers["content-length"]?.toIntOrNull() ?: 0
                    val body = ByteArray(length)
                    var offset = 0
                    while (offset < body.size) {
                        val count = input.read(body, offset, body.size - offset)
                        if (count < 0) break
                        offset += count
                    }
                    check(offset == body.size) { "The license request body was truncated" }
                    receivedHeaders.set(headers)
                    receivedBody.set(body)
                    socket.getOutputStream().write(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".toByteArray(),
                    )
                }
            } catch (failure: Throwable) {
                serverFailure.set(failure)
            }
        }
        try {
            val challenge = byteArrayOf(3, 1, 4, 1, 5)
            val client = OkHttpClient()
            OkHttpDataSource.Factory(client)
                .setDefaultRequestProperties(
                    mapOf(
                        "Authorization" to "Bearer stream-secret",
                        "Cookie" to "stream-session=secret",
                        "X-Stream-Only" to "must-not-reach-license-host",
                    ),
                )
                .setUserAgent("IPTVnator-stream-agent")
            val licenseDataSourceFactory = createTvDrmDataSourceFactory(client)
            val callback = createTvLicenseCallback(
                drmConfiguration.licenseUri?.toString(),
                drmConfiguration.licenseRequestHeaders,
                licenseDataSourceFactory,
            )
            callback.executeKeyRequest(
                C.WIDEVINE_UUID,
                ExoMediaDrm.KeyRequest(challenge, "http://127.0.0.1:${server.localPort}/license"),
            )
            serverThread.join(5_000)

            serverFailure.get()?.let { throw AssertionError("The local license fixture failed", it) }
            val headers = receivedHeaders.get() ?: throw AssertionError("The license request did not reach the fixture")
            assertEquals("Bearer test-token", headers["authorization"])
            assertEquals("Google TV", headers["x-client"])
            assertNull("Stream cookies must not be forwarded to the DRM host", headers["cookie"])
            assertNull("Stream-only headers must not be forwarded to the DRM host", headers["x-stream-only"])
            assertTrue(
                "The DRM request must not inherit the stream User-Agent",
                headers["user-agent"] != "IPTVnator-stream-agent",
            )
            assertArrayEquals(challenge, receivedBody.get())
            assertNull("The fixture should have consumed the request", serverFailure.get())
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
