package com.iptvnator.googletv.playback

import org.junit.Assert.assertEquals
import org.junit.Test
import javax.net.ssl.HostnameVerifier

class TvStreamingHttpClientTest {
    @Test
    fun `keeps IPTV stream reads unbounded but connection setup bounded`() {
        val client = createTvStreamingHttpClient(HostnameVerifier { _, _ -> true })

        assertEquals(15_000, client.connectTimeoutMillis)
        assertEquals(0, client.readTimeoutMillis)
        assertEquals(0, client.callTimeoutMillis)
    }
}
