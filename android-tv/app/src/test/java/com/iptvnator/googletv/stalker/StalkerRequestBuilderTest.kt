package com.iptvnator.googletv.stalker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StalkerRequestBuilderTest {
    private val credentials = StalkerCredentials(
        portalUrl = "https://portal.example:8080/c/",
        macAddress = "00:1A:79:AA:BB:CC",
    )

    @Test
    fun `normalizes copied c landing page to the server api endpoint`() {
        assertEquals(
            "https://portal.example:8080/server/load.php",
            StalkerRequestBuilder.normalizeEndpoint(credentials.portalUrl),
        )
    }

    @Test
    fun `builds protocol query and identity headers`() {
        val endpoint = StalkerRequestBuilder.normalizeEndpoint(credentials.portalUrl)
        val url = StalkerRequestBuilder.requestUrl(endpoint, mapOf("type" to "itv", "action" to "get_genres", "q" to "news sports"))
        assertTrue(url.contains("action=get_genres"))
        assertTrue(url.contains("q=news%20sports"))
        assertEquals("mac=00:1A:79:AA:BB:CC; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin", StalkerRequestBuilder.headers(credentials)["Cookie"])
        assertEquals(StalkerRequestBuilder.MagUserAgent, StalkerRequestBuilder.headers(credentials)["X-User-Agent"])
    }

    @Test
    fun `matches the MAG prehash contract`() {
        assertEquals(
            "C7501DA00F79DFB9DC499C43834BAC5A10DB7445",
            StalkerRequestBuilder.prehash("00:1A:79:AA:BB:CC"),
        )
    }

    @Test
    fun `normalizes common mac address formats`() {
        assertEquals("00:1A:79:AA:BB:CC", StalkerRequestBuilder.normalizeMac("001a79aabbcc"))
        assertEquals("00:1A:79:AA:BB:CC", StalkerRequestBuilder.normalizeMac("00-1a-79-aa-bb-cc"))
        assertTrue(StalkerRequestBuilder.isValidMac("00:1A:79:AA:BB:CC"))
        assertFalse(StalkerRequestBuilder.isValidMac("00:1A:79:AA:BB"))
    }
}
