package com.iptvnator.googletv.net

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertEquals
import org.junit.Test

class TvHttpTest {
    private val xml = "<tv><programme>Morning</programme></tv>"

    @Test
    fun `decodes a gzip file payload without relying on its url or headers`() {
        val decoded = decodeHttpResponseBody(gzip(xml.toByteArray()), contentEncoding = null)
            .use { it.readBytes().toString(StandardCharsets.UTF_8) }

        assertEquals(xml, decoded)
    }

    @Test
    fun `decodes http gzip and a separately gzipped xmltv file`() {
        val gzippedFile = gzip(xml.toByteArray()).readBytes()
        val httpCompressed = gzip(gzippedFile)
        val decoded = decodeHttpResponseBody(httpCompressed, contentEncoding = "gzip")
            .use { it.readBytes().toString(StandardCharsets.UTF_8) }

        assertEquals(xml, decoded)
    }

    @Test
    fun `does not decode http gzip twice when its body is plain xml`() {
        val decoded = decodeHttpResponseBody(gzip(xml.toByteArray()), contentEncoding = "gzip")
            .use { it.readBytes().toString(StandardCharsets.UTF_8) }

        assertEquals(xml, decoded)
    }

    private fun gzip(bytes: ByteArray): ByteArrayInputStream = ByteArrayInputStream(
        ByteArrayOutputStream().also { output ->
            GZIPOutputStream(output).use { it.write(bytes) }
        }.toByteArray(),
    )
}
