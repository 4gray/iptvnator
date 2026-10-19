package com.iptvnator.googletv.download

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

class TvResumableTransferTest {
    @get:Rule val temp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private val transfer = TvResumableTransfer()

    @Before fun startServer() {
        server = MockWebServer().apply { start() }
    }

    @After fun stopServer() {
        server.shutdown()
    }

    @Test fun resumesUsingRangeAndIfRangeThenAppendsOnlyRemainingBytes() {
        val partial = partialFile("hello ".toByteArray())
        server.enqueue(
            MockResponse().setResponseCode(206)
                .setHeader("Content-Range", "bytes 6-10/11")
                .setHeader("ETag", "\"entity-1\"")
                .setBody("world"),
        )

        val result = transfer.transfer(server.url("/movie.mp4").toString(), emptyMap(), partial, "\"entity-1\"")

        val request = server.takeRequest()
        assertEquals("bytes=6-", request.getHeader("Range"))
        assertEquals("\"entity-1\"", request.getHeader("If-Range"))
        assertEquals("hello world", partial.readText())
        assertEquals(11L, result.bytesDownloaded)
        assertEquals(11L, result.totalBytes)
        assertEquals("\"entity-1\"", result.validator)
    }

    @Test fun resumesWithoutValidatorOnlyAfterVerifyingOverlapBytes() {
        val prefix = ByteArray(400_000) { (it % 251).toByte() }
        val tail = ByteArray(30_000) { ((it + 31) % 251).toByte() }
        val partial = partialFile(prefix)
        val overlap = TvResumableTransfer.OVERLAP_VERIFICATION_BYTES.toInt()
        val responseStart = prefix.size - overlap
        val response = prefix.copyOfRange(responseStart, prefix.size) + tail
        server.enqueue(
            MockResponse().setResponseCode(206)
                .setHeader("Content-Range", "bytes $responseStart-${prefix.size + tail.size - 1}/${prefix.size + tail.size}")
                .setBody(okio.Buffer().write(response)),
        )

        val result = transfer.transfer(server.url("/movie.ts").toString(), emptyMap(), partial, null)

        assertEquals("bytes=$responseStart-", server.takeRequest().getHeader("Range"))
        assertTrue(partial.readBytes().contentEquals(prefix + tail))
        assertEquals((prefix.size + tail.size).toLong(), result.bytesDownloaded)
        assertNull(result.validator)
    }

    @Test fun ignoredRangeRestartsThePartialFromAFullResponse() {
        val partial = partialFile("stale partial data".toByteArray())
        server.enqueue(MockResponse().setResponseCode(200).setBody("new complete file"))

        transfer.transfer(server.url("/movie.mkv").toString(), emptyMap(), partial, "\"old\"")

        assertEquals("bytes=18-", server.takeRequest().getHeader("Range"))
        assertEquals("new complete file", partial.readText())
    }

    @Test fun rejectsA206ThatStartsAtTheWrongOffsetWithoutTouchingThePartial() {
        val partial = partialFile("original bytes retained".toByteArray())
        server.enqueue(
            MockResponse().setResponseCode(206)
                .setHeader("Content-Range", "bytes 3-5/6")
                .setBody("bad"),
        )

        assertThrows(IOException::class.java) {
            transfer.transfer(server.url("/movie.mp4").toString(), emptyMap(), partial, "\"v1\"")
        }

        assertEquals("original bytes retained", partial.readText())
    }

    private fun partialFile(bytes: ByteArray): File = File(temp.root, "video.part").apply { writeBytes(bytes) }
}
