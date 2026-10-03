package com.iptvnator.googletv.playback

import android.view.KeyEvent
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.graphics.Rect
import android.os.Build
import android.util.Rational
import androidx.media3.ui.PlayerView
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.delay
import kotlin.concurrent.thread
import com.iptvnator.googletv.MainActivity
import com.iptvnator.googletv.createTvPictureInPictureParams
import com.iptvnator.googletv.recording.TvLiveRecordingManager
import com.iptvnator.googletv.TvDrmConfig
import com.iptvnator.googletv.parseTvDrmProperties
import com.iptvnator.googletv.epg.TvEpgEntry

@RunWith(AndroidJUnit4::class)
class TvPlaybackControllerIntegrationTest {
    @Test
    fun vodSpeedActionCyclesAllOriginalPresetsWithRemote() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-speed-cycle-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveMp4(it, mp4) } }
            }
        }
        val appliedSpeed = AtomicReference(1f)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        TvPlaybackScreen(
                            request = TvPlaybackRequest(
                                uri = "http://127.0.0.1:${server.localPort}/vod/speed-cycle.mp4",
                                title = "VOD speed cycle test",
                                isLive = false,
                            ),
                            recordingManager = TvLiveRecordingManager(activity.applicationContext),
                            onExit = {},
                            onPlaybackSpeedChange = appliedSpeed::set,
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(instrumentation)
            val expectedSpeeds = listOf(1.25f, 1.5f, 2f, 0.5f, 0.75f, 1f)
            // The activity may have hidden Media3's controller before the
            // action row is inspected; CHANNEL_UP wakes it without seeking.
            device.pressKeyCode(KeyEvent.KEYCODE_CHANNEL_UP)
            assertTrue("The VOD speed action should be visible", device.wait(
                Until.hasObject(By.text("1×")), 5_000,
            ))
            scenario.onActivity { activity ->
                fun findPlayer(view: View): PlayerView? {
                    if (view is PlayerView) return view
                    if (view is ViewGroup) {
                        for (index in 0 until view.childCount) {
                            findPlayer(view.getChildAt(index))?.let { return it }
                        }
                    }
                    return null
                }
                val player = findPlayer(activity.findViewById(android.R.id.content))?.player
                    ?: throw AssertionError("The VOD player should be attached")
                player.repeatMode = androidx.media3.common.Player.REPEAT_MODE_ONE
            }
            repeat(5) {
                device.pressDPadRight()
                device.waitForIdle()
            }
            expectedSpeeds.forEach { expectedSpeed ->
                device.pressDPadCenter()
                val deadline = SystemClock.elapsedRealtime() + 2_000L
                while (kotlin.math.abs(appliedSpeed.get() - expectedSpeed) > 0.001f &&
                    SystemClock.elapsedRealtime() < deadline
                ) {
                    Thread.sleep(20L)
                }
                assertEquals("Remote OK should apply ${expectedSpeed}×", expectedSpeed, appliedSpeed.get(), 0.001f)
            }
        } finally {
            scenario.close()
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun pictureInPictureParamsFollowVideoBoundsAndAutoEnterState() {
        assumeTrue("PiP source bounds require Android O or newer", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        val sourceBounds = Rect(12, 24, 1908, 1056)

        val enabled = createTvPictureInPictureParams(sourceBounds, autoEnterEnabled = true)
        assertEquals(Rational(16, 9), enabled.aspectRatio)
        assertEquals(sourceBounds, enabled.sourceRectHint)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            assertTrue("Active video playback should support automatic PiP entry", enabled.isAutoEnterEnabled)
        }

        val disabled = createTvPictureInPictureParams(null, autoEnterEnabled = false)
        assertEquals(null, disabled.sourceRectHint)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            assertFalse("PiP auto-entry must be disabled after playback leaves the screen", disabled.isAutoEnterEnabled)
        }
    }

    @Test
    fun playerVolumeIsRestoredAcrossControllerSessionsIncludingMute() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val preferences = context.getSharedPreferences("iptvnator-playback", android.content.Context.MODE_PRIVATE)
        val hadStoredVolume = preferences.contains(TV_PLAYER_VOLUME_PREFERENCE_KEY)
        val previousVolume = runCatching {
            preferences.getFloat(TV_PLAYER_VOLUME_PREFERENCE_KEY, 1f)
        }.getOrDefault(1f)
        var controller: TvPlaybackController? = null

        try {
            preferences.edit().remove(TV_PLAYER_VOLUME_PREFERENCE_KEY).commit()
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(context)
                assertEquals(1f, controller!!.player().volume, 0f)
                controller!!.setVolume(0.37f)
                controller!!.close()
                controller = null

                controller = TvPlaybackController(context)
                assertEquals("A new playback session should restore the previous level", 0.37f, controller!!.player().volume, 0.001f)
                controller!!.toggleMute()
                assertEquals("Mute should persist as zero", 0f, controller!!.player().volume, 0f)
                controller!!.close()
                controller = null

                controller = TvPlaybackController(context)
                assertEquals("A muted session should reopen muted", 0f, controller!!.player().volume, 0f)
                controller!!.toggleMute()
                assertEquals("Unmute after recreation should use the default audible level", 1f, controller!!.player().volume, 0f)
            }
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            preferences.edit().apply {
                if (hadStoredVolume) putFloat(TV_PLAYER_VOLUME_PREFERENCE_KEY, previousVolume)
                else remove(TV_PLAYER_VOLUME_PREFERENCE_KEY)
            }.commit()
        }
    }

    @Test
    fun media3FetchesAndPlaysLocalLiveStream() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-playback-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveMp4(it, mp4) } }
            }
        }
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live/sample.mp4",
                        title = "Local live playback test",
                        isLive = true,
                    ),
                )
            }

            val deadline = SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                SystemClock.elapsedRealtime() < deadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "Media3 should reach READY for a real HTTP stream: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )

            var startPosition = 0L
            instrumentation.runOnMainSync { startPosition = controller!!.currentPositionMs() }
            Thread.sleep(500)
            var laterPosition = 0L
            instrumentation.runOnMainSync { laterPosition = controller!!.currentPositionMs() }
            assertTrue("Live playback position should advance", laterPosition > startPosition)

            instrumentation.runOnMainSync {
                controller!!.togglePlayPause()
                assertEquals("Remote pause should clear playWhenReady", false, controller!!.player().playWhenReady)
                controller!!.togglePlayPause()
                assertEquals("Remote resume should restore playWhenReady", true, controller!!.player().playWhenReady)
            }
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun media3AppliesProviderHeadersAndUserAgentToThePlaybackSource() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val receivedHeaders = AtomicReference<Map<String, String>?>(null)
        val serverThread = thread(name = "iptvnator-playback-request-headers-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching {
                    server.accept().use { socket ->
                        serveMp4(socket, mp4) { receivedHeaders.set(it) }
                    }
                }
            }
        }
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live/headers.mp4",
                        title = "Local playback request headers test",
                        userAgent = "IPTVnator-provider-agent",
                        headers = mapOf(
                            "Authorization" to "Bearer provider-session",
                            "Referer" to "https://provider.example/",
                            "X-Playlist" to "provider-one",
                        ),
                        isLive = true,
                    ),
                )
            }

            val deadline = SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                SystemClock.elapsedRealtime() < deadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "Media3 should play a provider-authenticated stream: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
            val headers = receivedHeaders.get() ?: throw AssertionError("The local stream request was not observed")
            assertEquals("Bearer provider-session", headers["authorization"])
            assertEquals("https://provider.example/", headers["referer"])
            assertEquals("provider-one", headers["x-playlist"])
            assertEquals("IPTVnator-provider-agent", headers["user-agent"])
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun media3ReconnectsAfterAPlayingLiveStreamLosesItsConnection() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val requests = AtomicInteger()
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-live-reconnect-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching {
                    server.accept().use {
                        requests.incrementAndGet()
                        serveMp4(it, mp4)
                    }
                }
            }
        }
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live/reconnect-after-playing.mp4",
                        title = "Live reconnect after playback test",
                        isLive = true,
                    ),
                )
            }

            val playbackDeadline = SystemClock.elapsedRealtime() + 10_000L
            var started = false
            while (!started && SystemClock.elapsedRealtime() < playbackDeadline) {
                instrumentation.runOnMainSync {
                    started = controller!!.state.value.phase == TvPlaybackPhase.PLAYING &&
                        controller!!.player().isPlaying
                }
                if (!started) Thread.sleep(50)
            }
            assertTrue("The live stream must actually play before simulating a network loss", started)
            val requestsBeforeDrop = requests.get()
            assertTrue("The local server should have received the initial stream request", requestsBeforeDrop > 0)

            instrumentation.runOnMainSync {
                // Stop the native renderer to reproduce a dead connection, then
                // deliver the same transient network-timeout callback Media3
                // sends when a live response disappears mid-playback.
                controller!!.player().stop()
                controller!!.onPlayerError(
                    androidx.media3.exoplayer.ExoPlaybackException.createForSource(
                        java.io.IOException("simulated live connection loss"),
                        androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
                    ),
                )
                assertEquals(TvPlaybackPhase.BUFFERING, controller!!.state.value.phase)
                assertTrue(
                    "The player should expose the automatic reconnect attempt",
                    controller!!.state.value.message?.contains("Reconectando (1/6)") == true,
                )
            }

            val reconnectDeadline = SystemClock.elapsedRealtime() + 10_000L
            while (requests.get() <= requestsBeforeDrop && SystemClock.elapsedRealtime() < reconnectDeadline) {
                Thread.sleep(50)
            }
            assertTrue(
                "The controller should reload the live URL after its backoff",
                requests.get() > requestsBeforeDrop,
            )
            val recoveryDeadline = SystemClock.elapsedRealtime() + 5_000L
            while (controller!!.state.value.phase != TvPlaybackPhase.PLAYING &&
                SystemClock.elapsedRealtime() < recoveryDeadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "Playback should recover after the controller reloads the live stream",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun liveReconnectPreferenceCanDisableAutomaticRetries() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:1/live/reconnect-disabled.mp4",
                        title = "Disabled live reconnect test",
                        isLive = true,
                    ),
                    autoReconnectLive = false,
                )
                // Feed the listener the same already-playing transition the
                // controller receives from Media3 before injecting a timeout.
                controller!!.onIsPlayingChanged(true)
                controller!!.onPlayerError(
                    androidx.media3.exoplayer.ExoPlaybackException.createForSource(
                        java.io.IOException("simulated live connection loss"),
                        androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
                    ),
                )
                assertEquals(TvPlaybackPhase.ERROR, controller!!.state.value.phase)
                assertTrue(controller!!.state.value.message?.contains("Reconectando") != true)
            }
            Thread.sleep(2_500L)
            instrumentation.runOnMainSync {
                assertEquals("Disabled auto-reconnect must remain a manual error", TvPlaybackPhase.ERROR, controller!!.state.value.phase)
                assertTrue(controller!!.state.value.message?.contains("Reconectando") != true)
            }
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
        }
    }

    @Test
    fun pausingALiveStreamCancelsItsPendingReconnect() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val requests = AtomicInteger()
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-live-reconnect-pause-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching {
                    server.accept().use {
                        requests.incrementAndGet()
                        serveMp4(it, mp4)
                    }
                }
            }
        }
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live/reconnect-pause.mp4",
                        title = "Paused live reconnect test",
                        isLive = true,
                    ),
                )
            }
            val playbackDeadline = SystemClock.elapsedRealtime() + 10_000L
            var started = false
            while (!started && SystemClock.elapsedRealtime() < playbackDeadline) {
                instrumentation.runOnMainSync {
                    started = controller!!.state.value.phase == TvPlaybackPhase.PLAYING &&
                        controller!!.player().isPlaying
                }
                if (!started) Thread.sleep(50)
            }
            assertTrue("The stream must be playing before pause-cancellation is tested", started)
            val requestsBeforeDrop = requests.get()
            instrumentation.runOnMainSync {
                controller!!.player().stop()
                controller!!.onPlayerError(
                    androidx.media3.exoplayer.ExoPlaybackException.createForSource(
                        java.io.IOException("simulated live connection loss"),
                        androidx.media3.common.PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
                    ),
                )
                assertTrue(controller!!.state.value.message?.contains("Reconectando (1/6)") == true)
                controller!!.pause()
                assertEquals(TvPlaybackPhase.ERROR, controller!!.state.value.phase)
                assertTrue(controller!!.state.value.message?.contains("cancelada") == true)
            }

            Thread.sleep(2_500L)
            assertEquals(
                "A user pause must cancel the queued reload instead of resuming playback behind the viewer",
                requestsBeforeDrop,
                requests.get(),
            )
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun media3KeepsStartupHttpFailuresAsManualRetryErrors() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val requests = AtomicInteger()
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-startup-playback-failure-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching {
                    server.accept().use { socket ->
                        requests.incrementAndGet()
                        serveNotFound(socket)
                    }
                }
            }
        }
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/live/missing.mp4",
                        title = "Startup failure manual retry test",
                        isLive = true,
                    ),
                )
            }

            val deadline = SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase != TvPlaybackPhase.ERROR && SystemClock.elapsedRealtime() < deadline) {
                Thread.sleep(50)
            }
            assertEquals(
                "An HTTP 404 before playback starts should stay an actionable error: ${controller!!.state.value.message}",
                TvPlaybackPhase.ERROR,
                controller!!.state.value.phase,
            )
            assertTrue("The server should receive the failed startup request", requests.get() > 0)
            assertTrue("The provider's not-found diagnosis should remain visible", controller!!.state.value.message?.contains("404") == true)
            val failedStartupRequests = requests.get()
            Thread.sleep(2_500L)
            assertEquals("The application must not automatically hammer a URL that never played", failedStartupRequests, requests.get())
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun media3PlaysAnAudioOnlyLiveRadioStream() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val wav = createRadioWav(seconds = 20)
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-radio-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveWav(it, wav) } }
            }
        }
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}/radio/live.wav",
                        title = "Local live radio playback test",
                        isLive = true,
                        isAudio = true,
                    ),
                )
            }

            val deadline = SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                SystemClock.elapsedRealtime() < deadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "Media3 should decode and play an audio-only live source: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
            var audioFormat: androidx.media3.common.Format? = null
            var videoFormat: androidx.media3.common.Format? = null
            var startPosition = 0L
            instrumentation.runOnMainSync {
                audioFormat = controller!!.player().audioFormat
                videoFormat = controller!!.player().videoFormat
                startPosition = controller!!.currentPositionMs()
            }
            Thread.sleep(500)
            var laterPosition = 0L
            instrumentation.runOnMainSync { laterPosition = controller!!.currentPositionMs() }

            assertTrue("The audio renderer should receive a decoded audio format", audioFormat != null)
            assertEquals("Radio playback must not expose a video track", null, videoFormat)
            assertTrue("Radio playback position should advance", laterPosition > startPosition)
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun livePlayerRoutesChannelUpAndDownRemoteKeysToZapping() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-zap-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveMp4(it, mp4) } }
            }
        }
        val receivedDeltas = java.util.concurrent.CopyOnWriteArrayList<Int>()
        val zapReceived = CountDownLatch(2)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        TvPlaybackScreen(
                            request = TvPlaybackRequest(
                                uri = "http://127.0.0.1:${server.localPort}/live/zap-test.mp4",
                                title = "Local live zapping test",
                                isLive = true,
                            ),
                            recordingManager = TvLiveRecordingManager(activity.applicationContext),
                            onExit = {},
                            playbackNotice = "Cambiando de canal…",
                            onChannelChange = { delta ->
                                receivedDeltas += delta
                                zapReceived.countDown()
                            },
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(instrumentation)
            assertTrue(
                "A pending channel change should be visible while the provider resolves the stream",
                device.wait(Until.hasObject(By.text("Cambiando de canal…")), 2_000),
            )
            device.pressKeyCode(KeyEvent.KEYCODE_CHANNEL_UP)
            device.pressKeyCode(KeyEvent.KEYCODE_CHANNEL_DOWN)

            assertTrue("The player should route both channel keys", zapReceived.await(5, TimeUnit.SECONDS))
            assertEquals("Channel up should select the previous provider item", -1, receivedDeltas[0])
            assertEquals("Channel down should select the next provider item", 1, receivedDeltas[1])
        } finally {
            scenario.close()
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun dpadUpOnFocusedLivePlaybackControlNavigatesInsteadOfChangingVolume() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-overlay-navigation-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveMp4(it, mp4) } }
            }
        }
        val playerView = AtomicReference<PlayerView?>(null)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        TvPlaybackScreen(
                            request = TvPlaybackRequest(
                                uri = "http://127.0.0.1:${server.localPort}/live/overlay-navigation.mp4",
                                title = "Overlay navigation test",
                                isLive = true,
                            ),
                            recordingManager = TvLiveRecordingManager(activity.applicationContext),
                            onExit = {},
                            onChannelOptionSelected = {},
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(instrumentation)
            device.pressDPadLeft()
            assertTrue("The live-channel action should request initial focus", device.wait(
                Until.hasObject(By.text("Canales")), 5_000,
            ))
            Thread.sleep(500)
            scenario.onActivity { activity ->
                fun findPlayer(view: View): PlayerView? {
                    if (view is PlayerView) return view
                    if (view is ViewGroup) {
                        for (index in 0 until view.childCount) {
                            findPlayer(view.getChildAt(index))?.let { return it }
                        }
                    }
                    return null
                }
                playerView.set(findPlayer(activity.findViewById(android.R.id.content)))
            }
            val view = playerView.get() ?: throw AssertionError("The TV PlayerView should be composed")
            val before = AtomicReference<Float>()
            scenario.onActivity {
                before.set(view.player?.volume ?: throw AssertionError("The player should be attached"))
            }

            device.pressDPadUp()

            val after = AtomicReference<Float>()
            scenario.onActivity { after.set(view.player?.volume ?: -1f) }
            assertEquals("DPAD_UP should reach Compose navigation, not Media3 volume", before.get(), after.get(), 0.0001f)
        } finally {
            scenario.close()
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun livePlayerActionsHideAndReturnWithMedia3Controller() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val nowMs = System.currentTimeMillis()
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-overlay-autohide-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveMp4(it, mp4) } }
            }
        }
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        val playerView = AtomicReference<PlayerView?>(null)
        val media3Controller = AtomicReference<View?>(null)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        TvPlaybackScreen(
                            request = TvPlaybackRequest(
                                uri = "http://127.0.0.1:${server.localPort}/live/overlay-autohide.mp4",
                                title = "Playback overlay auto-hide test",
                                isLive = true,
                            ),
                            recordingManager = TvLiveRecordingManager(activity.applicationContext),
                            guide = TvPlaybackGuide(
                                channelName = "Fixture channel",
                                current = TvEpgEntry("fixture", nowMs - 60_000, nowMs + 60_000, "Current fixture programme"),
                                next = TvEpgEntry("fixture", nowMs + 60_000, nowMs + 120_000, "Next fixture programme"),
                            ),
                            onExit = {},
                            onChannelOptionSelected = {},
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(instrumentation)
            val channelAction = By.text("Canales")
            val channelTitle = By.text("Playback overlay auto-hide test")
            val currentProgramme = By.textContains("Current fixture programme")
            val liveActionLabels = listOf(
                By.text("Canales"),
                By.text("Subtítulos"),
                By.text("Audio"),
                By.text("Calidad"),
                By.textContains("Formato:"),
                By.text("Info"),
                By.text("● Grabar"),
            )
            device.pressDPadLeft()
            assertTrue("The channel action should be visible with Media3 controls", device.wait(
                Until.hasObject(channelAction), 5_000,
            ))
            liveActionLabels.forEach { label ->
                assertTrue("Live-player action $label should be visible with the controller", device.wait(
                    Until.hasObject(label), 1_000,
                ))
            }
            assertTrue("The channel title should be visible with Media3 controls", device.wait(
                Until.hasObject(channelTitle), 1_000,
            ))
            assertTrue("The current programme panel should be visible with Media3 controls", device.wait(
                Until.hasObject(currentProgramme), 1_000,
            ))
            scenario.onActivity { activity ->
                fun findPlayer(view: View): PlayerView? {
                    if (view is PlayerView) return view
                    if (view is ViewGroup) {
                        for (index in 0 until view.childCount) {
                            findPlayer(view.getChildAt(index))?.let { return it }
                        }
                    }
                    return null
                }
                playerView.set(findPlayer(activity.findViewById(android.R.id.content)))
                val attachedPlayer = playerView.get()
                val controllerId = activity.resources.getIdentifier(
                    "exo_controller", "id", activity.packageName,
                )
                media3Controller.set(
                    if (controllerId != 0) attachedPlayer?.findViewById(controllerId) else null,
                )
            }
            val attachedPlayer = playerView.get() ?: throw AssertionError("The TV PlayerView should be composed")
            val nativeController = media3Controller.get()
                ?: throw AssertionError("Media3's native controller view should be composed")
            scenario.onActivity {
                attachedPlayer.player?.let { player ->
                    player.repeatMode = androidx.media3.common.Player.REPEAT_MODE_ONE
                    if (player.playbackState == androidx.media3.common.Player.STATE_ENDED) {
                        player.seekToDefaultPosition()
                        player.play()
                    }
                }
            }
            val playbackDeadline = SystemClock.elapsedRealtime() + 5_000L
            var isPlaying = false
            while (!isPlaying && SystemClock.elapsedRealtime() < playbackDeadline) {
                scenario.onActivity { isPlaying = attachedPlayer.player?.isPlaying == true }
                if (!isPlaying) Thread.sleep(100)
            }
            assertTrue("The local stream should be playing before testing the controller timeout", isPlaying)
            var nativeControllerVisible = false
            scenario.onActivity {
                // Reproduce a controller whose own timeout does not advance
                // while a Compose action holds TV focus. Our shared idle clock
                // must still hide both surfaces.
                attachedPlayer.controllerShowTimeoutMs = 30_000
                nativeControllerVisible = nativeController.visibility == View.VISIBLE
            }
            assertTrue("Media3's native pause/timeline controller should be visible", nativeControllerVisible)
            val actionsHidden = device.wait(Until.gone(channelAction), 7_000)
            var playbackStateForFailure = "unavailable"
            var nativeControllerHidden = false
            scenario.onActivity {
                nativeControllerHidden = nativeController.visibility != View.VISIBLE
                attachedPlayer.player?.let { player ->
                    playbackStateForFailure = "playing=${player.isPlaying}, " +
                        "playWhenReady=${player.playWhenReady}, playbackState=${player.playbackState}"
                }
            }
            assertTrue(
                "The Compose player actions should hide when Media3's controller times out; $playbackStateForFailure",
                actionsHidden,
            )
            liveActionLabels.forEach { label ->
                assertTrue(
                    "Every top-row player button must disappear with the pause/timeline controls: $label",
                    device.wait(Until.gone(label), 1_000),
                )
            }
            assertTrue("Media3's native pause/timeline controller should hide with the player actions", nativeControllerHidden)
            assertTrue("The channel title should fade with Media3's controller", device.wait(
                Until.gone(channelTitle), 1_000,
            ))
            assertTrue("The current programme panel should fade with Media3's controller", device.wait(
                Until.gone(currentProgramme), 1_000,
            ))

            // An ordinary DPAD navigation key wakes the common overlay without
            // pausing playback or triggering a live-player shortcut. Compare
            // screenshots promptly: accessibility polling can outlast the
            // four-second overlay and report the next hidden state instead.
            val hiddenCapture = java.io.File(instrumentation.targetContext.externalCacheDir, "overlay-hidden-test.png")
            val wakeCapture = java.io.File(instrumentation.targetContext.externalCacheDir, "overlay-wake-test.png")
            assertTrue("Capture hidden player", device.takeScreenshot(hiddenCapture))
            device.pressDPadLeft()
            Thread.sleep(500)
            assertTrue("Capture woken player", device.takeScreenshot(wakeCapture))
            val hiddenBitmap = android.graphics.BitmapFactory.decodeFile(hiddenCapture.absolutePath)
            val wakeBitmap = android.graphics.BitmapFactory.decodeFile(wakeCapture.absolutePath)
            var changedSamples = 0
            for (y in hiddenBitmap.height / 20 until hiddenBitmap.height / 7 step 4) {
                for (x in hiddenBitmap.width / 5 until hiddenBitmap.width * 3 / 4 step 4) {
                    val before = hiddenBitmap.getPixel(x, y)
                    val after = wakeBitmap.getPixel(x, y)
                    val colorDelta = kotlin.math.abs(android.graphics.Color.red(before) - android.graphics.Color.red(after)) +
                        kotlin.math.abs(android.graphics.Color.green(before) - android.graphics.Color.green(after)) +
                        kotlin.math.abs(android.graphics.Color.blue(before) - android.graphics.Color.blue(after))
                    if (colorDelta > 80) changedSamples++
                }
            }
            hiddenBitmap.recycle()
            wakeBitmap.recycle()
            assertTrue("The top player actions must visually return with the remote; changed=$changedSamples", changedSamples > 1_000)
            scenario.onActivity { nativeControllerVisible = nativeController.visibility == View.VISIBLE }
            assertTrue("Media3's native pause/timeline controller should return with the player actions", nativeControllerVisible)
            hiddenCapture.delete()
            wakeCapture.delete()
        } finally {
            scenario.close()
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun livePlayerCommitsNumericChannelEntryAfterRemoteDebounce() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-numeric-zap-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveMp4(it, mp4) } }
            }
        }
        val receivedNumber = AtomicInteger(0)
        val numberReceived = CountDownLatch(1)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        TvPlaybackScreen(
                            request = TvPlaybackRequest(
                                uri = "http://127.0.0.1:${server.localPort}/live/numeric-zap.mp4",
                                title = "Local numeric zapping test",
                                isLive = true,
                            ),
                            recordingManager = TvLiveRecordingManager(activity.applicationContext),
                            onExit = {},
                            onChannelNumber = { number ->
                                receivedNumber.set(number)
                                numberReceived.countDown()
                            },
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(instrumentation)
            device.pressDPadLeft()
            device.pressKeyCode(KeyEvent.KEYCODE_7)
            assertTrue(
                "The entered channel number should be visible while the remote debounce is pending",
                device.wait(Until.hasObject(By.text("7")), 1_000),
            )
            val numberOverlay = device.findObject(By.text("7"))
            val recordingBounds = checkNotNull(
                device.wait(Until.findObject(By.textContains("Grabar")), 1_000),
            ) { "The live-player recording action should be visible" }.visibleBounds
            assertTrue(
                "Numeric channel feedback must not overlap the top-row recording action: " +
                    "number=${numberOverlay.visibleBounds}, recording=$recordingBounds",
                numberOverlay.visibleBounds.top >= recordingBounds.bottom,
            )
            assertTrue(
                "The player should commit the numeric remote entry after its original debounce",
                numberReceived.await(4, TimeUnit.SECONDS),
            )
            assertEquals(7, receivedNumber.get())
        } finally {
            scenario.close()
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun livePlayerChannelPickerSelectsFocusedChannelWithDpad() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-channel-picker-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveMp4(it, mp4) } }
            }
        }
        val selectedChannel = AtomicReference<String?>(null)
        val groupedModeSelected = AtomicReference<Boolean?>(null)
        val selectionReceived = CountDownLatch(1)
        val groupingChangeReceived = CountDownLatch(1)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        var channelOptions by remember { mutableStateOf(emptyList<TvPlaybackChannelOption>()) }
                        var channelPickerOpened by remember { mutableStateOf(false) }
                        LaunchedEffect(channelPickerOpened) {
                            if (!channelPickerOpened) return@LaunchedEffect
                            delay(700)
                            channelOptions = listOf(
                                TvPlaybackChannelOption("one", "First remote channel", group = "News"),
                                TvPlaybackChannelOption("two", "Second remote channel", group = "Sports"),
                            )
                        }
                        TvPlaybackScreen(
                            request = TvPlaybackRequest(
                                uri = "http://127.0.0.1:${server.localPort}/live/channel-picker.mp4",
                                title = "Channel picker D-pad test",
                                isLive = true,
                            ),
                            recordingManager = TvLiveRecordingManager(activity.applicationContext),
                            onExit = {},
                            onChannelPickerOpened = { channelPickerOpened = true },
                            channelOptions = channelOptions,
                            channelPickerLoading = channelOptions.isEmpty(),
                            onChannelOptionSelected = { option ->
                                selectedChannel.set(option.key)
                                selectionReceived.countDown()
                            },
                            onChannelPickerGroupingChanged = { grouped ->
                                groupedModeSelected.set(grouped)
                                groupingChangeReceived.countDown()
                            },
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(instrumentation)
            device.pressDPadLeft()
            assertTrue("The player should show the channel picker control", device.wait(Until.hasObject(By.text("Canales")), 5_000))
            device.pressDPadCenter()
            // The dialog opens before its first database page arrives. Initial
            // focus should stay on the tabs, not invoke the on-screen keyboard.
            Thread.sleep(350)
            device.pressDPadRight()
            device.pressDPadCenter()
            assertTrue(
                "Selecting Grupos should notify the paged catalogue; focused=${device.findObjects(By.focused(true)).map { it.text }}",
                groupingChangeReceived.await(5, TimeUnit.SECONDS),
            )
            assertEquals(true, groupedModeSelected.get())
            assertTrue("The channel list should remain available after changing picker mode", device.wait(Until.hasObject(By.text("First remote channel")), 5_000))
            device.pressDPadDown()
            device.pressDPadDown()
            device.pressDPadCenter()

            assertTrue("A focused picker row should activate with OK", selectionReceived.await(5, TimeUnit.SECONDS))
            assertEquals("two", selectedChannel.get())
        } finally {
            scenario.close()
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun livePlayerChannelPickerFiltersAndSelectsFavoritesWithDpad() {
        livePlayerChannelPickerSelectsCollection(
            viewIndex = 2,
            title = "Favorite remote channel",
            key = "favorite-channel",
        )
    }

    @Test
    fun livePlayerChannelPickerFiltersAndSelectsRecentChannelsWithDpad() {
        livePlayerChannelPickerSelectsCollection(
            viewIndex = 3,
            title = "Recent remote channel",
            key = "recent-channel",
        )
    }

    private fun livePlayerChannelPickerSelectsCollection(viewIndex: Int, title: String, key: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val mp4 = instrumentation.context.assets.open("sample.mp4").use { it.readBytes() }
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-picker-collection-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveMp4(it, mp4) } }
            }
        }
        val selectedChannel = AtomicReference<String?>(null)
        val selectionReceived = CountDownLatch(1)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        TvPlaybackScreen(
                            request = TvPlaybackRequest(
                                uri = "http://127.0.0.1:${server.localPort}/live/picker-collection.mp4",
                                title = "Channel picker collection test",
                                isLive = true,
                            ),
                            recordingManager = TvLiveRecordingManager(activity.applicationContext),
                            onExit = {},
                            channelOptions = listOf(
                                TvPlaybackChannelOption("all-channel", "All remote channel", group = "News"),
                            ),
                            favoriteChannelOptions = listOf(
                                TvPlaybackChannelOption("favorite-channel", "Favorite remote channel", group = "News"),
                            ),
                            recentChannelOptions = listOf(
                                TvPlaybackChannelOption("recent-channel", "Recent remote channel", group = "Sports"),
                            ),
                            onChannelOptionSelected = { option ->
                                selectedChannel.set(option.key)
                                selectionReceived.countDown()
                            },
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(instrumentation)
            device.pressDPadLeft()
            assertTrue("The live player should expose its channel picker", device.wait(
                Until.hasObject(By.text("Canales")), 5_000,
            ))
            device.pressDPadCenter()
            assertTrue("The initial all-channels row should appear", device.wait(
                Until.hasObject(By.text("All remote channel")), 5_000,
            ))
            device.waitForIdle()
            Thread.sleep(300)
            device.pressDPadUp() // first tab (Todos)
            repeat(viewIndex) {
                device.waitForIdle()
                device.pressDPadRight()
            }
            device.waitForIdle()
            device.pressDPadCenter()

            val selectedViewRendered = device.wait(Until.hasObject(By.text(title)), 5_000)
            if (!selectedViewRendered) {
                device.takeScreenshot(java.io.File(
                    instrumentation.targetContext.externalCacheDir,
                    "picker-selected-view-debug.png",
                ))
                device.dumpWindowHierarchy(java.io.File(
                    instrumentation.targetContext.externalCacheDir,
                    "picker-selected-view-debug.xml",
                ))
            }
            assertTrue(
                "The selected picker view should render only its own catalogue: $title",
                selectedViewRendered,
            )
            device.pressDPadDown()
            device.pressDPadCenter()

            assertTrue("OK should select the focused item from view $viewIndex", selectionReceived.await(5, TimeUnit.SECONDS))
            assertEquals(key, selectedChannel.get())
        } finally {
            scenario.close()
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun media3FetchesAndPlaysLocalHlsLiveStream() {
        assertHlsLiveStreamPlays("/live/index.m3u8", "HLS fMP4")
    }

    @Test
    fun media3FetchesAndPlaysLocalMpegTsHlsLiveStream() {
        assertHlsLiveStreamPlays("/live-ts/index.m3u8", "HLS MPEG-TS")
    }

    @Test
    fun media3FetchesAndPlaysLocalDashManifestWithByteRanges() {
        assertDashManifestPlays("/dash/clear.mpd", "clear DASH")
    }

    @Test
    fun media3DecryptsAndPlaysClearKeyDashManifest() {
        val drm = requireNotNull(
            parseTvDrmProperties(
                mapOf(
                    "inputstream.adaptive.license_type" to "org.w3.clearkey",
                    "inputstream.adaptive.license_key" to "00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100",
                ),
            ),
        )
        assertDashManifestPlays(
            path = "/dash/clearkey.mpd",
            format = "ClearKey DASH",
            drm = drm,
        )
    }

    private fun assertDashManifestPlays(path: String, format: String, drm: TvDrmConfig? = null) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-dash-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveDashAsset(it, instrumentation) } }
            }
        }
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}$path",
                        title = "Local $format playback test",
                        isLive = false,
                        drm = drm,
                    ),
                )
            }

            val deadline = SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                SystemClock.elapsedRealtime() < deadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "Media3 should fetch and play $format manifest and byte-range segments: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )
            var selectedVideoTrack = false
            var durationMs = 0L
            instrumentation.runOnMainSync {
                selectedVideoTrack = controller!!.player().currentTracks.groups.any {
                    it.type == androidx.media3.common.C.TRACK_TYPE_VIDEO && it.isSelected
                }
                durationMs = controller!!.player().duration
            }
            assertTrue("$format should expose a selected video representation", selectedVideoTrack)
            assertTrue("$format should expose its static timeline duration", durationMs > 0L)
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            server.close()
            serverThread.join(1_000L)
        }
    }

    private fun assertHlsLiveStreamPlays(path: String, format: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val server = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-hls-fixture", isDaemon = true) {
            while (!server.isClosed) {
                runCatching { server.accept().use { serveHlsAsset(it, instrumentation) } }
            }
        }
        var controller: TvPlaybackController? = null
        try {
            instrumentation.runOnMainSync {
                controller = TvPlaybackController(instrumentation.targetContext)
                controller!!.play(
                    TvPlaybackRequest(
                        uri = "http://127.0.0.1:${server.localPort}$path",
                        title = "Local $format live playback test",
                        isLive = true,
                    ),
                )
            }

            val deadline = SystemClock.elapsedRealtime() + 10_000L
            while (controller!!.state.value.phase !in setOf(TvPlaybackPhase.PLAYING, TvPlaybackPhase.ERROR) &&
                SystemClock.elapsedRealtime() < deadline
            ) {
                Thread.sleep(50)
            }
            assertEquals(
                "Media3 should fetch the $format manifest and segments: ${controller!!.state.value.message}",
                TvPlaybackPhase.PLAYING,
                controller!!.state.value.phase,
            )

            var startPosition = 0L
            instrumentation.runOnMainSync { startPosition = controller!!.currentPositionMs() }
            Thread.sleep(500)
            var laterPosition = 0L
            instrumentation.runOnMainSync { laterPosition = controller!!.currentPositionMs() }
            assertTrue("$format live playback position should advance", laterPosition > startPosition)
        } finally {
            instrumentation.runOnMainSync { controller?.close() }
            server.close()
            serverThread.join(1_000L)
        }
    }

    private fun serveHlsAsset(socket: Socket, instrumentation: android.app.Instrumentation) {
        socket.soTimeout = 3_000
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.US_ASCII))
        val requestPath = reader.readLine()?.split(' ')?.getOrNull(1).orEmpty()
        while (reader.readLine()?.isNotEmpty() == true) Unit
        val fixtureDirectory = if (requestPath.startsWith("/live-ts/")) "hls-ts" else "hls"
        val fileName = requestPath.substringAfterLast('/')
        val assetPath = when {
            requestPath.substringBefore('?') == "/live/index.m3u8" -> "hls/index.m3u8"
            requestPath.substringBefore('?') == "/live/init.mp4" -> "hls/init.mp4"
            requestPath.substringBefore('?').startsWith("/live/segment") && fileName.endsWith(".m4s") -> "hls/$fileName"
            requestPath.substringBefore('?') == "/live-ts/index.m3u8" -> "hls-ts/index.m3u8"
            requestPath.substringBefore('?').startsWith("/live-ts/segment") && fileName.endsWith(".ts") -> "$fixtureDirectory/$fileName"
            else -> null
        }
        val body = assetPath?.let { instrumentation.context.assets.open(it).use { input -> input.readBytes() } }
        val status = if (body == null) "404 Not Found" else "200 OK"
        val contentType = when {
            requestPath.endsWith(".m3u8") -> "application/vnd.apple.mpegurl"
            requestPath.endsWith(".mp4") -> "video/mp4"
            requestPath.endsWith(".ts") -> "video/mp2t"
            else -> "video/iso.segment"
        }
        val output = socket.getOutputStream()
        output.write(
            ("HTTP/1.1 $status\r\n" +
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${body?.size ?: 0}\r\n" +
                "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
        )
        body?.let(output::write)
        output.flush()
    }

    private fun serveDashAsset(socket: Socket, instrumentation: android.app.Instrumentation) {
        socket.soTimeout = 3_000
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.US_ASCII))
        val requestPath = reader.readLine()?.split(' ')?.getOrNull(1).orEmpty().substringBefore('?')
        var rangeHeader: String? = null
        while (true) {
            val line = reader.readLine() ?: break
            if (line.isEmpty()) break
            if (line.startsWith("Range:", ignoreCase = true)) rangeHeader = line.substringAfter(':').trim()
        }
        val assetPath = when (requestPath) {
            "/dash/clear.mpd" -> "clear.mpd"
            "/dash/clear-video.mp4" -> "clear-video.mp4"
            "/dash/clear-audio.mp4" -> "clear-audio.mp4"
            "/dash/clearkey.mpd" -> "clearkey.mpd"
            "/dash/clearkey-video.mp4" -> "clearkey-video.mp4"
            "/dash/clearkey-audio.mp4" -> "clearkey-audio.mp4"
            else -> null
        }
        val body = assetPath?.let { instrumentation.context.assets.open(it).use { input -> input.readBytes() } }
        val requestedRange = Regex("bytes=(\\d+)-(\\d*)").matchEntire(rangeHeader.orEmpty())
        val start = requestedRange?.groupValues?.get(1)?.toIntOrNull()?.coerceIn(0, (body?.size ?: 1) - 1) ?: 0
        val end = requestedRange?.groupValues?.get(2)?.toIntOrNull()?.coerceAtMost((body?.size ?: 1) - 1)
            ?: (body?.size ?: 1) - 1
        val partial = body != null && requestedRange != null
        val responseBody = if (body == null) byteArrayOf() else body.copyOfRange(start, end + 1)
        val status = when {
            body == null -> "404 Not Found"
            partial -> "206 Partial Content"
            else -> "200 OK"
        }
        val contentType = if (requestPath.endsWith(".mpd")) "application/dash+xml" else "video/mp4"
        val output = socket.getOutputStream()
        output.write(
            ("HTTP/1.1 $status\r\n" +
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${responseBody.size}\r\n" +
                (if (partial) "Content-Range: bytes $start-$end/${body!!.size}\r\n" else "") +
                "Accept-Ranges: bytes\r\n" +
                "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
        )
        output.write(responseBody)
        output.flush()
    }

    private fun serveMp4(socket: Socket, body: ByteArray, onHeaders: ((Map<String, String>) -> Unit)? = null) {
        socket.soTimeout = 3_000
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.US_ASCII))
        reader.readLine() // Request line.
        val headers = linkedMapOf<String, String>()
        while (true) {
            val line = reader.readLine()?.takeIf(String::isNotEmpty) ?: break
            val separator = line.indexOf(':')
            if (separator > 0) {
                headers[line.substring(0, separator).trim().lowercase()] = line.substring(separator + 1).trim()
            }
        }
        onHeaders?.invoke(headers)
        val output = socket.getOutputStream()
        output.write(
            ("HTTP/1.1 200 OK\r\n" +
                "Content-Type: video/mp4\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Accept-Ranges: bytes\r\n" +
                "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
        )
        output.write(body)
        output.flush()
    }

    private fun serveWav(socket: Socket, body: ByteArray) {
        socket.soTimeout = 3_000
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.US_ASCII))
        while (reader.readLine()?.isNotEmpty() == true) Unit
        val output = socket.getOutputStream()
        output.write(
            ("HTTP/1.1 200 OK\r\n" +
                "Content-Type: audio/wav\r\n" +
                "Content-Length: ${body.size}\r\n" +
                "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
        )
        output.write(body)
        output.flush()
    }

    private fun createRadioWav(seconds: Int, sampleRate: Int = 16_000): ByteArray {
        val sampleCount = seconds * sampleRate
        val dataSize = sampleCount * 2
        val wav = ByteBuffer.allocate(44 + dataSize).order(ByteOrder.LITTLE_ENDIAN)
        wav.put("RIFF".toByteArray(Charsets.US_ASCII))
        wav.putInt(36 + dataSize)
        wav.put("WAVEfmt ".toByteArray(Charsets.US_ASCII))
        wav.putInt(16)
        wav.putShort(1)
        wav.putShort(1)
        wav.putInt(sampleRate)
        wav.putInt(sampleRate * 2)
        wav.putShort(2)
        wav.putShort(16)
        wav.put("data".toByteArray(Charsets.US_ASCII))
        wav.putInt(dataSize)
        repeat(sampleCount) { index ->
            val sample = (Short.MAX_VALUE * 0.15 * kotlin.math.sin(2.0 * Math.PI * 440 * index / sampleRate)).toInt()
            wav.putShort(sample.toShort())
        }
        return wav.array()
    }

    private fun serveNotFound(socket: Socket) {
        socket.soTimeout = 3_000
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.US_ASCII))
        while (reader.readLine()?.isNotEmpty() == true) Unit
        val output = socket.getOutputStream()
        output.write(
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .toByteArray(Charsets.US_ASCII),
        )
        output.flush()
    }
}
