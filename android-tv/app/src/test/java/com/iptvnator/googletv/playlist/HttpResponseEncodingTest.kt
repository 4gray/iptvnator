package com.iptvnator.googletv.playlist

import com.iptvnator.googletv.net.decodeHttpResponseBody
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.DeflaterOutputStream
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertEquals
import org.junit.Test

class HttpResponseEncodingTest {
    @Test
    fun `decodes gzip provider responses`() {
        val payload = "#EXTM3U\n#EXTINF:-1,News\nhttps://stream.example/news"
        val compressed = ByteArrayOutputStream().also { output ->
            GZIPOutputStream(output).use { it.write(payload.toByteArray()) }
        }.toByteArray()

        val decoded = decodeHttpResponseBody(ByteArrayInputStream(compressed), "gzip")
            .bufferedReader().use { it.readText() }

        assertEquals(payload, decoded)
    }

    @Test
    fun `decodes deflate provider responses`() {
        val payload = "<tv><programme channel=\"news\"/></tv>"
        val compressed = ByteArrayOutputStream().also { output ->
            DeflaterOutputStream(output).use { it.write(payload.toByteArray()) }
        }.toByteArray()

        val decoded = decodeHttpResponseBody(ByteArrayInputStream(compressed), "deflate")
            .bufferedReader().use { it.readText() }

        assertEquals(payload, decoded)
    }
}
