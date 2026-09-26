package com.iptvnator.googletv.recording

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.iptvnator.googletv.playback.TvPlaybackRequest
import com.iptvnator.googletv.playback.TvPlaybackController
import com.iptvnator.googletv.playback.TvPlaybackPhase
import java.net.ServerSocket
import java.net.Socket
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvLiveRecordingManagerTest {
    @Test
    fun copiesLiveBytesAndFinishesARecordingOnExplicitStop() {
        val accepted = CountDownLatch(1)
        val server = ServerSocket(0)
        val serverThread = Thread {
            server.accept().use { socket ->
                accepted.countDown()
                socket.getOutputStream().bufferedWriter().use { writer ->
                    writer.write("HTTP/1.1 200 OK\r\n")
                    writer.write("Content-Type: video/mp2t\r\n")
                    writer.write("Connection: keep-alive\r\n\r\n")
                    writer.flush()
                    socket.getOutputStream().write(byteArrayOf(0x47, 0x00, 0x10, 0x00, 0x47, 0x01))
                    socket.getOutputStream().flush()
                    Thread.sleep(5_000)
                }
            }
        }.apply { start() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = TvLiveRecordingManager(context)
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live.ts",
                        title = "Emulator live test",
                        isLive = true,
                    ),
                ),
            )
            assertTrue(accepted.await(2, TimeUnit.SECONDS))
            Thread.sleep(300)
            val finished = kotlinx.coroutines.runBlocking { manager.stop() }
            assertEquals(TvRecordingStatus.COMPLETED, finished?.status)
            assertTrue((finished?.bytes ?: 0L) >= 6L)
            assertTrue(finished?.file?.isFile == true)
            finished?.file?.delete()
        } finally {
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun recordsDirectMp4AsMp4AndReopensItInMedia3() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val accepted = CountDownLatch(1)
        val server = ServerSocket(0)
        val serverThread = Thread {
            try {
                server.accept().use { socket ->
                    val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                    while (reader.readLine()?.isNotEmpty() == true) Unit
                    val output = socket.getOutputStream()
                    output.write(
                        ("HTTP/1.1 200 OK\r\n" +
                            "Content-Type: video/mp4\r\n" +
                            "Connection: keep-alive\r\n\r\n").toByteArray(Charsets.US_ASCII),
                    )
                    output.write(mp4)
                    output.flush()
                    accepted.countDown()
                    Thread.sleep(5_000L)
                }
            } catch (_: Exception) {
                // Explicit recording stop cancels the HTTP request.
            }
        }.apply { start() }
        val manager = TvLiveRecordingManager(context)
        var controller: TvPlaybackController? = null
        var recording: TvRecording? = null
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live/channel.mp4",
                        title = "Emulator direct MP4 test",
                        isLive = true,
                    ),
                ),
            )
            assertTrue(accepted.await(2, TimeUnit.SECONDS))
            val captureDeadline = android.os.SystemClock.elapsedRealtime() + 5_000L
            while ((manager.active.value?.file?.length() ?: 0L) < mp4.size &&
                android.os.SystemClock.elapsedRealtime() < captureDeadline
            ) {
                Thread.sleep(25)
            }
            recording = kotlinx.coroutines.runBlocking { manager.stop() }
            assertEquals(TvRecordingStatus.COMPLETED, recording?.status)
            assertEquals("mp4", recording?.file?.extension)
            assertEquals(mp4.size.toLong(), recording?.bytes)
            assertTrue(recording?.file?.readBytes()?.contentEquals(mp4) == true)

            instrumentation.runOnMainSync {
                controller = TvPlaybackController(context)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = requireNotNull(recording).file.toURI().toString(),
                        title = "Recorded direct MP4 test",
                        isLive = false,
                    ),
                )
            }
            val deadline = android.os.SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                android.os.SystemClock.elapsedRealtime() < deadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "The direct MP4 recording should reopen through Media3: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            recording?.file?.delete()
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun recordsClearStaticDashAsOfflineManifestWithAudioAndVideoResources() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val testAssets = instrumentation.context.assets
        val files = mapOf(
            "/clear.mpd" to "clear.mpd",
            "/clear-video.mp4" to "clear-video.mp4",
            "/clear-audio.mp4" to "clear-audio.mp4",
        )
        val payloads = files.mapValues { (_, asset) -> testAssets.open(asset).use { it.readBytes() } }
        val requested = CountDownLatch(files.size)
        val server = ServerSocket(0)
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val path = reader.readLine().orEmpty().substringAfter(' ').substringBefore(' ')
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val body = payloads[path]
                        val output = socket.getOutputStream()
                        output.write(
                            ("HTTP/1.1 ${if (body == null) "404 Not Found" else "200 OK"}\r\n" +
                                "Content-Type: ${if (path.endsWith(".mpd")) "application/dash+xml" else "video/mp4"}\r\n" +
                                "Content-Length: ${body?.size ?: 0}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
                        )
                        body?.let(output::write)
                        output.flush()
                        requested.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the fixture server is the normal shutdown path.
            }
        }.apply { start() }
        val manager = TvLiveRecordingManager(instrumentation.targetContext)
        var controller: TvPlaybackController? = null
        var recording: TvRecording? = null
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/clear.mpd",
                        title = "Emulator clear DASH test",
                        isLive = true,
                        mimeType = "application/dash+xml",
                    ),
                ),
            )
            assertTrue("DASH manifest and both tracks should be fetched", requested.await(5, TimeUnit.SECONDS))
            val finishDeadline = android.os.SystemClock.elapsedRealtime() + 5_000L
            while (manager.active.value?.status == TvRecordingStatus.RECORDING &&
                android.os.SystemClock.elapsedRealtime() < finishDeadline
            ) {
                Thread.sleep(25)
            }
            recording = manager.active.value
            assertEquals(TvRecordingStatus.COMPLETED, recording?.status)
            val localManifest = requireNotNull(recording).file.readText()
            assertTrue(localManifest.contains(".dash/clear-video.mp4"))
            assertTrue(localManifest.contains(".dash/clear-audio.mp4"))
            assertEquals(
                payloads.filterKeys { it != "/clear.mpd" }.values.sumOf { it.size.toLong() } +
                    localManifest.toByteArray().size,
                requireNotNull(recording).bytes,
            )
            assertTrue(File(recording.file.parentFile, "${recording.file.nameWithoutExtension}.dash/clear-video.mp4").isFile)
            assertTrue(File(recording.file.parentFile, "${recording.file.nameWithoutExtension}.dash/clear-audio.mp4").isFile)

            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = requireNotNull(recording).file.toURI().toString(),
                        title = "Recorded clear DASH test",
                        isLive = false,
                        mimeType = "application/dash+xml",
                    ),
                )
            }
            val playbackDeadline = android.os.SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                android.os.SystemClock.elapsedRealtime() < playbackDeadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "The DASH recording should reopen through Media3: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            recording?.let { TvRecordingHistory.deleteFiles(it.file) }
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun recordsClearDashSegmentListWithByteRangesAndReopensItOffline() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val testAssets = instrumentation.context.assets
        val video = testAssets.open("clear-video.mp4").use { it.readBytes() }
        val audio = testAssets.open("clear-audio.mp4").use { it.readBytes() }
        val manifest = """
            <?xml version="1.0" encoding="UTF-8"?>
            <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S">
              <Period id="0">
                <AdaptationSet contentType="video">
                  <Representation id="video" bandwidth="146192" codecs="vp09.00.11.08.01.02.02.02.00" mimeType="video/mp4" width="320" height="180">
                    <BaseURL>clear-video.mp4</BaseURL>
                    <SegmentList timescale="1000000"><Initialization range="0-806"/><SegmentTimeline><S t="0" d="4000000"/></SegmentTimeline><SegmentURL mediaRange="851-${video.lastIndex}"/></SegmentList>
                  </Representation>
                </AdaptationSet>
                <AdaptationSet contentType="audio">
                  <Representation id="audio" bandwidth="61348" codecs="opus" mimeType="audio/mp4" audioSamplingRate="48000">
                    <BaseURL>clear-audio.mp4</BaseURL>
                    <SegmentList timescale="1000000"><Initialization range="0-809"/><SegmentTimeline><S t="0" d="4000000"/></SegmentTimeline><SegmentURL mediaRange="854-${audio.lastIndex}"/></SegmentList>
                  </Representation>
                </AdaptationSet>
              </Period>
            </MPD>
        """.trimIndent()
        val payloads = mapOf(
            "/clear-segment-list.mpd" to manifest.toByteArray(),
            "/clear-video.mp4" to video,
            "/clear-audio.mp4" to audio,
        )
        val requested = CountDownLatch(5)
        val server = ServerSocket(0)
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val path = reader.readLine().orEmpty().substringAfter(' ').substringBefore(' ')
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val body = payloads[path]
                        val output = socket.getOutputStream()
                        output.write(
                            ("HTTP/1.1 ${if (body == null) "404 Not Found" else "200 OK"}\r\n" +
                                "Content-Type: ${if (path.endsWith(".mpd")) "application/dash+xml" else "video/mp4"}\r\n" +
                                "Content-Length: ${body?.size ?: 0}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
                        )
                        body?.let(output::write)
                        output.flush()
                        requested.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the test server ends this fixture.
            }
        }.apply { start() }
        val manager = TvLiveRecordingManager(instrumentation.targetContext)
        var controller: TvPlaybackController? = null
        var recording: TvRecording? = null
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/clear-segment-list.mpd",
                        title = "Emulator DASH SegmentList test",
                        isLive = true,
                        mimeType = "application/dash+xml",
                    ),
                ),
            )
            assertTrue("DASH manifest, both init sections and both media ranges should be fetched", requested.await(5, TimeUnit.SECONDS))
            val finishDeadline = android.os.SystemClock.elapsedRealtime() + 5_000L
            while (manager.active.value?.status == TvRecordingStatus.RECORDING &&
                android.os.SystemClock.elapsedRealtime() < finishDeadline
            ) {
                Thread.sleep(25)
            }
            recording = manager.active.value
            assertEquals(TvRecordingStatus.COMPLETED, recording?.status)
            val localManifest = requireNotNull(recording).file.readText()
            assertTrue(localManifest.contains("<SegmentList"))
            assertTrue(localManifest.contains("track-0-init.mp4"))
            assertTrue(localManifest.contains("track-0-segment-0.m4s"))
            assertTrue(localManifest.contains("track-1-init.mp4"))
            assertTrue(localManifest.contains("track-1-segment-0.m4s"))
            val directory = File(recording.file.parentFile, "${recording.file.nameWithoutExtension}.dash")
            assertEquals(807L, File(directory, "track-0-init.mp4").length())
            assertEquals(video.size.toLong() - 851L, File(directory, "track-0-segment-0.m4s").length())
            assertEquals(810L, File(directory, "track-1-init.mp4").length())
            assertEquals(audio.size.toLong() - 854L, File(directory, "track-1-segment-0.m4s").length())

            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = requireNotNull(recording).file.toURI().toString(),
                        title = "Recorded DASH SegmentList test",
                        isLive = false,
                        mimeType = "application/dash+xml",
                    ),
                )
            }
            val playbackDeadline = android.os.SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                android.os.SystemClock.elapsedRealtime() < playbackDeadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "The segmented DASH recording should reopen through Media3: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            recording?.let { TvRecordingHistory.deleteFiles(it.file) }
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun recordsClearDashSegmentTemplateAndReopensItOffline() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val testAssets = instrumentation.context.assets
        val video = testAssets.open("clear-video.mp4").use { it.readBytes() }
        val audio = testAssets.open("clear-audio.mp4").use { it.readBytes() }
        val manifest = """
            <?xml version="1.0" encoding="UTF-8"?>
            <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S">
              <BaseURL>./</BaseURL>
              <Period id="0">
                <AdaptationSet contentType="video">
                  <Representation id="video" bandwidth="146192" codecs="vp09.00.11.08.01.02.02.02.00" mimeType="video/mp4" width="320" height="180">
                    <SegmentTemplate timescale="1000000" startNumber="1" initialization="clear-video-init.mp4" media="clear-video-segment-${'$'}Number${'$'}.m4s"><SegmentTimeline><S t="0" d="4000000"/></SegmentTimeline></SegmentTemplate>
                  </Representation>
                </AdaptationSet>
                <AdaptationSet contentType="audio">
                  <Representation id="audio" bandwidth="61348" codecs="opus" mimeType="audio/mp4" audioSamplingRate="48000">
                    <SegmentTemplate timescale="1000000" startNumber="1" initialization="clear-audio-init.mp4" media="clear-audio-segment-${'$'}Number${'$'}.m4s"><SegmentTimeline><S t="0" d="4000000"/></SegmentTimeline></SegmentTemplate>
                  </Representation>
                </AdaptationSet>
              </Period>
            </MPD>
        """.trimIndent()
        val payloads = mapOf(
            "/clear-template.mpd" to manifest.toByteArray(),
            "/clear-video-init.mp4" to video.copyOfRange(0, 807),
            "/clear-video-segment-1.m4s" to video.copyOfRange(851, video.size),
            "/clear-audio-init.mp4" to audio.copyOfRange(0, 810),
            "/clear-audio-segment-1.m4s" to audio.copyOfRange(854, audio.size),
        )
        val requested = CountDownLatch(payloads.size)
        val server = ServerSocket(0)
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val path = reader.readLine().orEmpty().substringAfter(' ').substringBefore(' ')
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val body = payloads[path]
                        val output = socket.getOutputStream()
                        output.write(
                            ("HTTP/1.1 ${if (body == null) "404 Not Found" else "200 OK"}\r\n" +
                                "Content-Type: ${if (path.endsWith(".mpd")) "application/dash+xml" else "video/mp4"}\r\n" +
                                "Content-Length: ${body?.size ?: 0}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
                        )
                        body?.let(output::write)
                        output.flush()
                        requested.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the test server ends this fixture.
            }
        }.apply { start() }
        val manager = TvLiveRecordingManager(instrumentation.targetContext)
        var controller: TvPlaybackController? = null
        var recording: TvRecording? = null
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/clear-template.mpd",
                        title = "Emulator DASH SegmentTemplate test",
                        isLive = true,
                        mimeType = "application/dash+xml",
                    ),
                ),
            )
            assertTrue("DASH template should expand and fetch both init sections and media segments", requested.await(5, TimeUnit.SECONDS))
            val finishDeadline = android.os.SystemClock.elapsedRealtime() + 5_000L
            while (manager.active.value?.status == TvRecordingStatus.RECORDING &&
                android.os.SystemClock.elapsedRealtime() < finishDeadline
            ) {
                Thread.sleep(25)
            }
            recording = manager.active.value
            assertEquals(TvRecordingStatus.COMPLETED, recording?.status)
            val localManifest = requireNotNull(recording).file.readText()
            assertTrue(localManifest.contains("<SegmentList"))
            assertTrue(localManifest.contains("track-0-segment-0.m4s"))
            assertTrue(localManifest.contains("track-1-segment-0.m4s"))
            val directory = File(recording.file.parentFile, "${recording.file.nameWithoutExtension}.dash")
            assertEquals(807L, File(directory, "track-0-init.mp4").length())
            assertEquals(video.size.toLong() - 851L, File(directory, "track-0-segment-0.m4s").length())
            assertEquals(810L, File(directory, "track-1-init.mp4").length())
            assertEquals(audio.size.toLong() - 854L, File(directory, "track-1-segment-0.m4s").length())

            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = requireNotNull(recording).file.toURI().toString(),
                        title = "Recorded DASH SegmentTemplate test",
                        isLive = false,
                        mimeType = "application/dash+xml",
                    ),
                )
            }
            val playbackDeadline = android.os.SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                android.os.SystemClock.elapsedRealtime() < playbackDeadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "The DASH SegmentTemplate recording should reopen through Media3: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            recording?.let { TvRecordingHistory.deleteFiles(it.file) }
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun recordsDynamicDashWindowAndFinalizesAnOfflineManifestOnStop() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val video = instrumentation.context.assets.open("clear-video.mp4").use { it.readBytes() }
        val audio = instrumentation.context.assets.open("clear-audio.mp4").use { it.readBytes() }
        val availabilityStartTime = java.time.Instant.now().minusSeconds(40)
        fun manifest(segmentRepeat: Int) = """
            <?xml version="1.0" encoding="UTF-8"?>
            <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" availabilityStartTime="$availabilityStartTime" minimumUpdatePeriod="PT0.5S" timeShiftBufferDepth="PT60S" minBufferTime="PT1S">
              <BaseURL>./</BaseURL>
              <Period id="0" start="PT0S">
                <AdaptationSet id="0" contentType="video">
                  <Representation id="video" bandwidth="146192" codecs="vp09.00.11.08.01.02.02.02.02.00" mimeType="video/mp4" width="320" height="180">
                    <SegmentTemplate timescale="1000000" startNumber="1" initialization="video-init.mp4" media="video-${'$'}Time${'$'}.m4s"><SegmentTimeline><S t="16000000" d="4000000" r="$segmentRepeat"/></SegmentTimeline></SegmentTemplate>
                  </Representation>
                </AdaptationSet>
                <AdaptationSet id="1" contentType="audio">
                  <Representation id="audio" bandwidth="61348" codecs="opus" mimeType="audio/mp4" audioSamplingRate="48000">
                    <SegmentTemplate timescale="1000000" startNumber="1" initialization="audio-init.mp4" media="audio-${'$'}Time${'$'}.m4s"><SegmentTimeline><S t="16000000" d="4000000" r="$segmentRepeat"/></SegmentTimeline></SegmentTemplate>
                  </Representation>
                </AdaptationSet>
              </Period>
            </MPD>
        """.trimIndent().toByteArray()
        val mediaByPath = mapOf(
            "/video-init.mp4" to video.copyOfRange(0, 807),
            "/video-16000000.m4s" to video.copyOfRange(851, video.size),
            "/video-20000000.m4s" to video.copyOfRange(851, video.size),
            "/audio-init.mp4" to audio.copyOfRange(0, 810),
            "/audio-16000000.m4s" to audio.copyOfRange(854, audio.size),
            "/audio-20000000.m4s" to audio.copyOfRange(854, audio.size),
        )
        val manifestRequests = java.util.concurrent.atomic.AtomicInteger()
        val secondSegmentsRequested = CountDownLatch(2)
        val server = ServerSocket(0)
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val path = reader.readLine().orEmpty().substringAfter(' ').substringBefore(' ')
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val body = if (path == "/dynamic.mpd") {
                            manifest(if (manifestRequests.getAndIncrement() == 0) 0 else 1)
                        } else {
                            mediaByPath[path]
                        }
                        val output = socket.getOutputStream()
                        output.write(
                            ("HTTP/1.1 ${if (body == null) "404 Not Found" else "200 OK"}\r\n" +
                                "Content-Type: ${if (path.endsWith(".mpd")) "application/dash+xml" else "video/mp4"}\r\n" +
                                "Content-Length: ${body?.size ?: 0}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
                        )
                        body?.let(output::write)
                        output.flush()
                        if (path.endsWith("20000000.m4s")) secondSegmentsRequested.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the fixture server is the normal shutdown path.
            }
        }.apply { start() }
        val manager = TvLiveRecordingManager(instrumentation.targetContext)
        var controller: TvPlaybackController? = null
        var recording: TvRecording? = null
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/dynamic.mpd",
                        title = "Emulator dynamic DASH test",
                        isLive = true,
                        mimeType = "application/dash+xml",
                    ),
                ),
            )
            assertTrue("The second video and audio segments should be fetched", secondSegmentsRequested.await(8, TimeUnit.SECONDS))
            val assetsDirectory = manager.active.value?.file?.let { file ->
                File(file.parentFile, "${file.nameWithoutExtension}.dash")
            }
            val segmentDeadline = android.os.SystemClock.elapsedRealtime() + 2_000L
            while (assetsDirectory?.let { File(it, "track-0-segment-000001.m4s").isFile &&
                    File(it, "track-1-segment-000001.m4s").isFile
                } != true && android.os.SystemClock.elapsedRealtime() < segmentDeadline
            ) {
                Thread.sleep(25)
            }
            assertTrue(File(requireNotNull(assetsDirectory), "track-0-segment-000001.m4s").isFile)
            assertTrue(File(requireNotNull(assetsDirectory), "track-1-segment-000001.m4s").isFile)
            assertTrue("Active DASH recording should publish captured bytes", requireNotNull(manager.active.value).bytes > 0L)

            recording = kotlinx.coroutines.runBlocking { manager.stop() }
            assertEquals(TvRecordingStatus.COMPLETED, recording?.status)
            val offlineManifestText = requireNotNull(recording).file.readText()
            assertTrue(offlineManifestText.contains("type=\"static\""))
            assertTrue(offlineManifestText.contains("track-0-segment-000001.m4s"))
            assertTrue(offlineManifestText.contains("track-1-segment-000001.m4s"))
            assertTrue(offlineManifestText.contains("<S t=\"0\" d=\"4000000\""))
            assertTrue(offlineManifestText.contains("<S t=\"4000000\" d=\"4000000\""))

            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = requireNotNull(recording).file.toURI().toString(),
                        title = "Recorded dynamic DASH test",
                        isLive = false,
                        mimeType = "application/dash+xml",
                    ),
                )
            }
            val playbackDeadline = android.os.SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                android.os.SystemClock.elapsedRealtime() < playbackDeadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "The recorded dynamic MPD should reopen through Media3: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            recording?.let { TvRecordingHistory.deleteFiles(it.file) }
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun followsLiveHlsPlaylistAndStoresSegmentsInsteadOfManifestText() {
        val accepted = CountDownLatch(1)
        val server = ServerSocket(0)
        val playlist = """
            #EXTM3U
            #EXT-X-TARGETDURATION:1
            #EXT-X-MEDIA-SEQUENCE:0
            #EXTINF:1,
            segment-0.ts
        """.trimIndent().replace("\n", "\r\n")
        val segment = byteArrayOf(0x47, 0x10, 0x00, 0x00, 0x47, 0x11, 0x00, 0x00)
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val request = reader.readLine().orEmpty()
                        while (reader.readLine()?.isNotEmpty() == true) {
                            // Consume request headers before writing the response.
                        }
                        val body = if (request.contains("segment-0.ts")) segment else playlist.toByteArray()
                        val contentType = if (request.contains("segment-0.ts")) "video/mp2t" else "application/vnd.apple.mpegurl"
                        socket.getOutputStream().bufferedWriter().use { writer ->
                            writer.write("HTTP/1.1 200 OK\r\n")
                            writer.write("Content-Type: $contentType\r\n")
                            writer.write("Content-Length: ${body.size}\r\n")
                            writer.write("Connection: close\r\n\r\n")
                            writer.flush()
                            socket.getOutputStream().write(body)
                            socket.getOutputStream().flush()
                        }
                        accepted.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the ServerSocket is the normal test shutdown path.
            }
        }.apply { start() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = TvLiveRecordingManager(context)
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live.m3u8",
                        title = "Emulator HLS test",
                        isLive = true,
                    ),
                ),
            )
            assertTrue(accepted.await(2, TimeUnit.SECONDS))
            Thread.sleep(500)
            val finished = kotlinx.coroutines.runBlocking { manager.stop() }
            assertEquals(TvRecordingStatus.COMPLETED, finished?.status)
            assertEquals("ts", finished?.file?.extension)
            assertTrue((finished?.bytes ?: 0L) >= segment.size.toLong())
            assertTrue(finished?.file?.readBytes()?.contentEquals(segment) == true)
            finished?.file?.delete()
        } finally {
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun recordsFragmentedMp4HlsWithAnMp4ExtensionAndReopensTheCapture() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val testAssets = instrumentation.context.assets
        val assetNames = listOf(
            "hls/index.m3u8",
            "hls/init.mp4",
            "hls/segment00.m4s",
            "hls/segment01.m4s",
            "hls/segment02.m4s",
            "hls/segment03.m4s",
        )
        val expectedBytes = assetNames.drop(1).sumOf { name ->
            testAssets.open(name).use { it.readBytes().size.toLong() }
        }
        val finalFragmentRequested = CountDownLatch(1)
        val server = ServerSocket(0)
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val path = reader.readLine().orEmpty().substringAfter(' ').substringBefore(' ')
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val assetName = "hls/${path.substringAfterLast('/')}"
                        val body = runCatching { testAssets.open(assetName).use { it.readBytes() } }
                            .getOrDefault(byteArrayOf())
                        val contentType = when {
                            assetName.endsWith(".m3u8") -> "application/vnd.apple.mpegurl"
                            assetName.endsWith(".m4s") || assetName.endsWith(".mp4") -> "video/mp4"
                            else -> "application/octet-stream"
                        }
                        val output = socket.getOutputStream()
                        output.write(
                            ("HTTP/1.1 ${if (body.isEmpty()) "404 Not Found" else "200 OK"}\r\n" +
                                "Content-Type: $contentType\r\n" +
                                "Content-Length: ${body.size}\r\n" +
                                "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
                        )
                        output.write(body)
                        output.flush()
                        if (assetName.endsWith("segment03.m4s")) finalFragmentRequested.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the server is the normal test shutdown path.
            }
        }.apply { start() }
        val manager = TvLiveRecordingManager(context)
        var controller: TvPlaybackController? = null
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/hls/index.m3u8",
                        title = "Emulator fMP4 HLS test",
                        isLive = true,
                    ),
                ),
            )
            assertTrue("Recorder should fetch the final media fragment", finalFragmentRequested.await(5, TimeUnit.SECONDS))
            val captureDeadline = android.os.SystemClock.elapsedRealtime() + 5_000L
            while ((manager.active.value?.file?.length() ?: 0L) < expectedBytes &&
                android.os.SystemClock.elapsedRealtime() < captureDeadline
            ) {
                Thread.sleep(25)
            }
            val finished = kotlinx.coroutines.runBlocking { manager.stop() }
            assertEquals(TvRecordingStatus.COMPLETED, finished?.status)
            assertEquals("mp4", finished?.file?.extension)
            assertEquals(expectedBytes, finished?.bytes)

            instrumentation.runOnMainSync {
                controller = TvPlaybackController(context)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = requireNotNull(finished).file.toURI().toString(),
                        title = "Recorded fMP4 HLS test",
                        isLive = false,
                    ),
                )
            }
            val deadline = android.os.SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                android.os.SystemClock.elapsedRealtime() < deadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "The fMP4 HLS recording should reopen through Media3: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
            requireNotNull(finished).file.delete()
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun decryptsAes128SegmentsUsingMediaSequenceIvAndHonorsMethodNone() {
        val key = ByteArray(16) { index -> index.toByte() }
        val rotatedKey = ByteArray(16) { index -> (15 - index).toByte() }
        val clearInitMap = byteArrayOf(0x00, 0x00, 0x00, 0x08, 0x66, 0x74, 0x79, 0x70)
        val mapIv = ByteArray(16).apply { this[15] = 2 }
        val encryptedInitMap = Cipher.getInstance("AES/CBC/PKCS5Padding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(mapIv))
            doFinal(clearInitMap)
        }
        val clearEncryptedSegment = byteArrayOf(0x47, 0x00, 0x10, 0x00, 0x47, 0x01)
        val sequenceIv = ByteArray(16).apply { this[15] = 7 }
        val encryptedSegment = Cipher.getInstance("AES/CBC/PKCS5Padding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(sequenceIv))
            doFinal(clearEncryptedSegment)
        }
        val clearRotatedSegment = byteArrayOf(0x47, 0x03, 0x10, 0x00, 0x47, 0x04)
        val explicitIv = ByteArray(16).apply { this[15] = 1 }
        val encryptedRotatedSegment = Cipher.getInstance("AES/CBC/PKCS5Padding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(rotatedKey, "AES"), IvParameterSpec(explicitIv))
            doFinal(clearRotatedSegment)
        }
        val clearSegment = byteArrayOf(0x47, 0x02, 0x10, 0x00)
        val playlist = """
            #EXTM3U
            #EXT-X-TARGETDURATION:1
            #EXT-X-MEDIA-SEQUENCE:7
            #EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin",IV=0x2
            #EXT-X-MAP:URI="init.mp4"
            #EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"
            #EXTINF:1,
            segments/encrypted.ts
            #EXT-X-KEY:METHOD=AES-128,URI="keys/rotation.bin",IV=0x1
            #EXTINF:1,
            segments/encrypted-rotation.ts
            #EXT-X-KEY:METHOD=NONE
            #EXTINF:1,
            clear.ts
        """.trimIndent().replace("\n", "\r\n").toByteArray()
        val requested = CountDownLatch(7)
        val server = ServerSocket(0)
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val request = reader.readLine().orEmpty()
                        val path = request.substringAfter(' ').substringBefore(' ')
                        while (reader.readLine()?.isNotEmpty() == true) {
                            // Consume request headers before writing the response.
                        }
                        val (status, body, contentType) = when (path) {
                            "/live/live.m3u8" -> Triple("200 OK", playlist, "application/vnd.apple.mpegurl")
                            "/live/keys/key.bin" -> Triple("200 OK", key, "application/octet-stream")
                            "/live/keys/rotation.bin" -> Triple("200 OK", rotatedKey, "application/octet-stream")
                            "/live/init.mp4" -> Triple("200 OK", encryptedInitMap, "video/mp4")
                            "/live/segments/encrypted.ts" -> Triple("200 OK", encryptedSegment, "video/mp2t")
                            "/live/segments/encrypted-rotation.ts" -> Triple("200 OK", encryptedRotatedSegment, "video/mp2t")
                            "/live/clear.ts" -> Triple("200 OK", clearSegment, "video/mp2t")
                            else -> Triple("404 Not Found", byteArrayOf(), "text/plain")
                        }
                        socket.getOutputStream().bufferedWriter().use { writer ->
                            writer.write("HTTP/1.1 $status\r\n")
                            writer.write("Content-Type: $contentType\r\n")
                            writer.write("Content-Length: ${body.size}\r\n")
                            writer.write("Connection: close\r\n\r\n")
                            writer.flush()
                            socket.getOutputStream().write(body)
                            socket.getOutputStream().flush()
                        }
                        requested.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the ServerSocket is the normal test shutdown path.
            }
        }.apply { start() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = TvLiveRecordingManager(context)
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live/live.m3u8",
                        title = "Emulator encrypted HLS test",
                        isLive = true,
                    ),
                ),
            )
            assertTrue(requested.await(3, TimeUnit.SECONDS))
            Thread.sleep(250)
            val finished = kotlinx.coroutines.runBlocking { manager.stop() }
            assertEquals(TvRecordingStatus.COMPLETED, finished?.status)
            assertTrue(
                finished?.file?.readBytes()
                    ?.contentEquals(clearInitMap + clearEncryptedSegment + clearRotatedSegment + clearSegment) == true,
            )
            finished?.file?.delete()
        } finally {
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun capturesHlsByteRangesAndImplicitOffsetsFromSharedResource() {
        val sourceBytes = "abcdefghijklmnop".toByteArray()
        val playlist = """
            #EXTM3U
            #EXT-X-TARGETDURATION:1
            #EXT-X-MAP:URI="packed.mp4",BYTERANGE="4@0"
            #EXT-X-BYTERANGE:4@4
            packed.mp4
            #EXT-X-BYTERANGE:4
            packed.mp4
        """.trimIndent().replace("\n", "\r\n").toByteArray()
        val requested = CountDownLatch(4)
        val server = ServerSocket(0)
        val seenRanges = java.util.Collections.synchronizedList(mutableListOf<String>())
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val request = reader.readLine().orEmpty()
                        var rangeHeader: String? = null
                        while (true) {
                            val header = reader.readLine() ?: break
                            if (header.isEmpty()) break
                            if (header.startsWith("Range:", ignoreCase = true)) rangeHeader = header.substringAfter(':').trim()
                        }
                        val path = request.substringAfter(' ').substringBefore(' ')
                        val body: ByteArray
                        val status: String
                        val contentRange: String?
                        if (path == "/live.m3u8") {
                            body = playlist
                            status = "200 OK"
                            contentRange = null
                        } else {
                            val match = rangeHeader?.let { Regex("bytes=(\\d+)-(\\d+)").matchEntire(it) }
                            if (path != "/packed.mp4" || match == null) {
                                body = byteArrayOf()
                                status = "400 Bad Request"
                                contentRange = null
                            } else {
                                val start = match.groupValues[1].toInt()
                                val end = match.groupValues[2].toInt()
                                seenRanges += rangeHeader
                                if (start == 8) {
                                    // Some IPTV origins ignore Range and return the whole resource.
                                    body = sourceBytes
                                    status = "200 OK"
                                    contentRange = null
                                } else {
                                    body = sourceBytes.copyOfRange(start, end + 1)
                                    status = "206 Partial Content"
                                    contentRange = "bytes $start-$end/${sourceBytes.size}"
                                }
                            }
                        }
                        socket.getOutputStream().bufferedWriter().use { writer ->
                            writer.write("HTTP/1.1 $status\r\n")
                            writer.write("Content-Length: ${body.size}\r\n")
                            contentRange?.let { writer.write("Content-Range: $it\r\n") }
                            writer.write("Connection: close\r\n\r\n")
                            writer.flush()
                            socket.getOutputStream().write(body)
                            socket.getOutputStream().flush()
                        }
                        requested.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the ServerSocket is the normal test shutdown path.
            }
        }.apply { start() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = TvLiveRecordingManager(context)
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live.m3u8",
                        title = "Emulator HLS byte range test",
                        isLive = true,
                    ),
                ),
            )
            assertTrue(requested.await(3, TimeUnit.SECONDS))
            Thread.sleep(200)
            val finished = kotlinx.coroutines.runBlocking { manager.stop() }
            assertEquals(TvRecordingStatus.COMPLETED, finished?.status)
            assertEquals(listOf("bytes=0-3", "bytes=4-7", "bytes=8-11"), seenRanges.toList())
            assertTrue(finished?.file?.readBytes()?.contentEquals("abcdefghijkl".toByteArray()) == true)
            finished?.file?.delete()
        } finally {
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }

    @Test
    fun decryptsAes128EncryptedMapAndSegmentsLoadedAsByteRanges() {
        val key = ByteArray(16) { it.toByte() }
        fun encrypt(clear: ByteArray, ivByte: Int): ByteArray {
            val iv = ByteArray(16).apply { this[15] = ivByte.toByte() }
            return Cipher.getInstance("AES/CBC/PKCS5Padding").run {
                init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
                doFinal(clear)
            }
        }
        val clearMap = "INITMAP".toByteArray()
        val clearSegment1 = "SEGMENT1".toByteArray()
        val clearSegment2 = "SEGMENT2".toByteArray()
        val encryptedMap = encrypt(clearMap, 10)
        val encryptedSegment1 = encrypt(clearSegment1, 11)
        val encryptedSegment2 = encrypt(clearSegment2, 12)
        val sharedResource = encryptedMap + encryptedSegment1 + encryptedSegment2
        val playlist = """
            #EXTM3U
            #EXT-X-TARGETDURATION:1
            #EXT-X-MEDIA-SEQUENCE:4
            #EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0xa
            #EXT-X-MAP:URI="packed.bin",BYTERANGE="${encryptedMap.size}@0"
            #EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0xb
            #EXT-X-BYTERANGE:${encryptedSegment1.size}@${encryptedMap.size}
            packed.bin
            #EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0xc
            #EXT-X-BYTERANGE:${encryptedSegment2.size}@${encryptedMap.size + encryptedSegment1.size}
            packed.bin
        """.trimIndent().replace("\n", "\r\n").toByteArray()
        val requested = CountDownLatch(5)
        val seenRanges = java.util.Collections.synchronizedList(mutableListOf<String>())
        val server = ServerSocket(0)
        val serverThread = Thread {
            try {
                while (!server.isClosed) {
                    server.accept().use { socket ->
                        val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                        val requestLine = reader.readLine().orEmpty()
                        val path = requestLine.substringAfter(' ').substringBefore(' ')
                        var rangeHeader: String? = null
                        while (true) {
                            val header = reader.readLine() ?: break
                            if (header.isEmpty()) break
                            if (header.startsWith("Range:", ignoreCase = true)) rangeHeader = header.substringAfter(':').trim()
                        }
                        val body: ByteArray
                        val status: String
                        val contentRange: String?
                        when (path) {
                            "/live.m3u8" -> {
                                body = playlist
                                status = "200 OK"
                                contentRange = null
                            }
                            "/key.bin" -> {
                                body = key
                                status = "200 OK"
                                contentRange = null
                            }
                            "/packed.bin" -> {
                                val match = rangeHeader?.let { Regex("bytes=(\\d+)-(\\d+)").matchEntire(it) }
                                if (match == null) {
                                    body = byteArrayOf()
                                    status = "400 Bad Request"
                                    contentRange = null
                                } else {
                                    val start = match.groupValues[1].toInt()
                                    val end = match.groupValues[2].toInt()
                                    seenRanges += rangeHeader
                                    body = sharedResource.copyOfRange(start, end + 1)
                                    status = "206 Partial Content"
                                    contentRange = "bytes $start-$end/${sharedResource.size}"
                                }
                            }
                            else -> {
                                body = byteArrayOf()
                                status = "404 Not Found"
                                contentRange = null
                            }
                        }
                        socket.getOutputStream().bufferedWriter().use { writer ->
                            writer.write("HTTP/1.1 $status\r\n")
                            writer.write("Content-Length: ${body.size}\r\n")
                            contentRange?.let { writer.write("Content-Range: $it\r\n") }
                            writer.write("Connection: close\r\n\r\n")
                            writer.flush()
                            socket.getOutputStream().write(body)
                            socket.getOutputStream().flush()
                        }
                        requested.countDown()
                    }
                }
            } catch (_: Exception) {
                // Closing the ServerSocket is the normal test shutdown path.
            }
        }.apply { start() }

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = TvLiveRecordingManager(context)
        try {
            assertTrue(
                manager.start(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live.m3u8",
                        title = "Emulator encrypted HLS ranges",
                        isLive = true,
                    ),
                ),
            )
            assertTrue(requested.await(3, TimeUnit.SECONDS))
            Thread.sleep(200)
            val finished = kotlinx.coroutines.runBlocking { manager.stop() }
            assertEquals(TvRecordingStatus.COMPLETED, finished?.status)
            assertEquals(
                listOf("bytes=0-15", "bytes=16-31", "bytes=32-47"),
                seenRanges.toList(),
            )
            assertTrue(
                finished?.file?.readBytes()?.contentEquals(clearMap + clearSegment1 + clearSegment2) == true,
            )
            finished?.file?.delete()
        } finally {
            manager.close()
            server.close()
            serverThread.join(2_000)
        }
    }
}
