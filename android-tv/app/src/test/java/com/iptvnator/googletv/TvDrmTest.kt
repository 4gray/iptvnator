package com.iptvnator.googletv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvDrmTest {
    @Test
    fun `accepts widevine license urls for native Media3 playback`() {
        val drm = parseTvDrmProperties(
            mapOf(
                "inputstream.adaptive.license_type" to "com.widevine.alpha",
                "inputstream.adaptive.license_key" to "https://license.example.test/widevine|Content-Type=application/octet-stream",
            ),
        )

        assertTrue(drm?.supported == true)
        assertEquals("com.widevine.alpha", drm?.licenseType)
        assertEquals("https://license.example.test/widevine", drm?.licenseUrl)
        assertEquals("application/octet-stream", drm?.licenseHeaders?.get("Content-Type"))
    }

    @Test
    fun `accepts encoded license headers and raw challenge when manifest supplies license url`() {
        val drm = parseTvDrmProperties(
            mapOf(
                "inputstream.adaptive.license_type" to "com.widevine.alpha",
                "inputstream.adaptive.license_key" to "|Authorization=Bearer%20token&User-Agent=TV%2BPlayer|R%7BSSM%7D|R",
            ),
        )

        assertTrue(drm?.supported == true)
        assertEquals(null, drm?.licenseUrl)
        assertEquals("Bearer token", drm?.licenseHeaders?.get("Authorization"))
        assertEquals("TV+Player", drm?.licenseHeaders?.get("User-Agent"))
        assertEquals("R%7BSSM%7D", drm?.licenseRequestData)
        assertEquals("R", drm?.licenseResponseData)
    }

    @Test
    fun `uses manifest license url when no license key override is present`() {
        val drm = parseTvDrmProperties(
            mapOf("inputstream.adaptive.license_type" to "com.widevine.alpha"),
        )

        assertTrue(drm?.supported == true)
        assertEquals(null, drm?.licenseUrl)
    }

    @Test
    fun `accepts Kodi split license URL properties and rejects URL challenge placeholders`() {
        val splitUrl = parseTvDrmProperties(
            mapOf(
                "inputstream.adaptive.license_type" to "com.widevine.alpha",
                "inputstream.adaptive.license_url" to "https://license.example.test/",
                "inputstream.adaptive.license_url_append" to "widevine",
                "inputstream.adaptive.license_key" to "|Authorization=Bearer%20token",
            ),
        )
        val templatedUrl = parseTvDrmProperties(
            mapOf(
                "inputstream.adaptive.license_type" to "com.widevine.alpha",
                "inputstream.adaptive.license_key" to "https://license.example.test/{HASH}",
            ),
        )

        assertTrue(splitUrl?.supported == true)
        assertEquals("https://license.example.test/widevine", splitUrl?.licenseUrl)
        assertFalse(templatedUrl?.supported == true)
    }

    @Test
    fun `does not claim unsupported license wrappers while retaining their values`() {
        val drm = parseTvDrmProperties(
            mapOf(
                "inputstream.adaptive.license_type" to "com.widevine.alpha",
                "inputstream.adaptive.license_key" to "https://license.example.test/widevine|Authorization=Bearer%20token|B{SSM}|Jlicense",
                "inputstream.adaptive.license_data" to "custom-pssh",
            ),
        )

        assertFalse(drm?.supported == true)
        assertEquals("https://license.example.test/widevine", drm?.licenseUrl)
        assertEquals("Bearer token", drm?.licenseHeaders?.get("Authorization"))
        assertEquals("B{SSM}", drm?.licenseRequestData)
        assertEquals("Jlicense", drm?.licenseResponseData)
        assertEquals("custom-pssh", drm?.additionalProperties?.get("inputstream.adaptive.license_data"))
    }

    @Test
    fun `accepts playready license urls and rejects non network licenses`() {
        val playReady = parseTvDrmProperties(
            mapOf(
                "inputstream.adaptive.license_type" to "playready",
                "inputstream.adaptive.license_key" to "http://license.example.test/playready",
            ),
        )
        val unsupported = parseTvDrmProperties(
            mapOf(
                "inputstream.adaptive.license_type" to "com.widevine.alpha",
                "inputstream.adaptive.license_key" to "widevine-secret-token",
            ),
        )

        assertTrue(playReady?.supported == true)
        assertEquals("http://license.example.test/playready", playReady?.licenseUrl)
        assertFalse(unsupported?.supported == true)
    }
}
