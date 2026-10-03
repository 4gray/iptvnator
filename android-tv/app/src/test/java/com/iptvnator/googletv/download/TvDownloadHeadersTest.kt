package com.iptvnator.googletv.download

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class TvDownloadHeadersTest {
    @Test
    fun `dedicated user agent wins and blank headers are discarded`() {
        val result = normalizedDownloadHeaders(
            userAgent = "  Provider/1.0  ",
            headers = mapOf(
                " User-Agent " to "spoofed",
                " Referer " to " https://provider.example/ ",
                "Origin" to " ",
                "" to "ignored",
            ),
        )

        assertEquals("Provider/1.0", result["User-Agent"])
        assertEquals("https://provider.example/", result["Referer"])
        assertFalse(result.containsKey("Origin"))
        assertFalse(result.containsKey(""))
    }

    @Test
    fun `keeps authenticated portal headers for same-origin downloads`() {
        val result = normalizedDownloadHeaders(
            userAgent = "KSPlayer",
            headers = mapOf(
                "Cookie" to "mac=00:1A:79:AA:BB:CC",
                "Authorization" to "Bearer portal-token",
                "Origin" to "https://portal.example",
                "Referer" to "https://portal.example",
            ),
        )

        assertEquals("KSPlayer", result["User-Agent"])
        assertEquals("mac=00:1A:79:AA:BB:CC", result["Cookie"])
        assertEquals("Bearer portal-token", result["Authorization"])
        assertEquals("https://portal.example", result["Origin"])
    }
}
