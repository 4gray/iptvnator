package com.iptvnator.googletv.playlist

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class M3uRemoteImportUiTest {
    @Test
    fun importsRemoteM3uThroughTheVisibleTvForm() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val arguments = InstrumentationRegistry.getArguments()
        val databaseName = DATABASE_NAME
        val preserveCatalog = arguments.getString(ARG_PRESERVE_CATALOG) == "true"
        val externalUrl = arguments.getString(ARG_M3U_URL)?.takeIf(String::isNotBlank)
        val fixture = """#EXTM3U
#EXTINF:-1 tvg-id="ui-fixture-1" group-title="News",M3U UI fixture channel
https://example.invalid/live/fixture.m3u8
""".trimIndent()
        val server = if (externalUrl == null) ServerSocket(0, 8, InetAddress.getByName("127.0.0.1")) else null
        val serving = AtomicBoolean(true)
        val serverThread = server?.let { listener ->
            thread(name = "iptvnator-m3u-ui-fixture", isDaemon = true) {
                while (serving.get()) {
                    runCatching { listener.accept().use { serveM3u(it, fixture) } }
                }
            }
        }
        val sourceUrl = externalUrl ?: "http://127.0.0.1:${server!!.localPort}/playlist.m3u"
        val expectedRows = arguments.getString(ARG_EXPECTED_ROWS)?.toIntOrNull()
            ?: fixture.lineSequence().count { it.startsWith("#EXTINF:") }
        val preferences = context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
        val previousSelected = preferences.getString("selected_playlist_id", null)
        val previousStartup = preferences.getString("startup_section", null)
        val previousDashboard = preferences.takeBoolean("show_dashboard")
        context.deleteDatabase(databaseName)
        preferences.edit().putString("startup_section", "Home").putBoolean("show_dashboard", true).apply()

        var scenario: ActivityScenario<MainActivity>? = null
        try {
            scenario = ActivityScenario.launch(
                Intent(context, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_DEBUG_DATABASE_NAME, databaseName),
            )
            val device = UiDevice.getInstance(instrumentation)
            val addSource = device.wait(Until.findObject(By.text("+")), 10_000)
                ?: throw AssertionError("Home should expose its add-source action")
            addSource.click()
            assertTrue("The localized add-playlist dialog should open", device.wait(
                Until.hasObject(By.text("Añadir playlist")), 5_000,
            ))
            assertTrue("M3U URL should be the initial source choice", device.wait(
                Until.hasObject(By.text("URL M3U")), 5_000,
            ))
            val importViewport = device.findObjects(By.clazz("android.widget.ScrollView"))
                .maxByOrNull { it.visibleBounds.height() }
                ?: throw AssertionError("The playlist form should expose its content viewport")
            val initialAddAction = device.wait(Until.findObject(By.desc("Añadir playlist")), 5_000)
                ?: throw AssertionError("The disabled add action should remain accessible before editing the form")
            val unusedPanelTail = importViewport.visibleBounds.bottom - initialAddAction.visibleBounds.bottom
            val actionBounds = initialAddAction.visibleBounds
            val minimumActionHeightPx = (40 * context.resources.displayMetrics.density).toInt()
            val actionIsVisibleWithoutScrolling = actionBounds.top >= importViewport.visibleBounds.top &&
                actionBounds.bottom <= importViewport.visibleBounds.bottom &&
                actionBounds.height() >= minimumActionHeightPx
            if (!actionIsVisibleWithoutScrolling || unusedPanelTail >= device.displayHeight / 6) {
                device.takeScreenshot(java.io.File(
                    instrumentation.targetContext.externalCacheDir,
                    "m3u-compact-form-debug.png",
                ))
                device.dumpWindowHierarchy(java.io.File(
                    instrumentation.targetContext.externalCacheDir,
                    "m3u-compact-form-debug.xml",
                ))
            }
            assertTrue(
                "The initial playlist form should show its add action without scrolling and avoid a large blank tail: " +
                    "tail=$unusedPanelTail px, viewport=${importViewport.visibleBounds}, " +
                    "action=$actionBounds, minimumHeight=$minimumActionHeightPx px",
                actionIsVisibleWithoutScrolling && unusedPanelTail in 0 until (device.displayHeight / 6),
            )
            setImportField(device, "URL de playlist (m3u, m3u8)*", sourceUrl)
            setImportField(device, "Nombre de playlist", IMPORT_NAME)
            val customHeadersEntered = externalUrl == null
            if (customHeadersEntered) {
                val advancedOptions = device.wait(Until.findObject(By.text("Opciones avanzadas")), 5_000)
                    ?: throw AssertionError("A new M3U import should expose collapsed advanced options")
                advancedOptions.click()
                setImportField(device, "Agente de usuario (opcional)", TEST_USER_AGENT)
                setImportField(device, "Referer (opcional)", TEST_REFERRER)
                setImportField(device, "Origin (opcional)", TEST_ORIGIN)
            }

            val submit = device.wait(Until.findObject(By.text("Añadir playlist")), 5_000)
                ?: throw AssertionError("The M3U submit action should be visible")
            val visibleSubmit = device.findObjects(By.text("Añadir playlist"))
                .firstOrNull { it.visibleBounds.centerY() > device.displayHeight / 2 }
                ?: submit
            assertTrue("The M3U URL should enable the add action", visibleSubmit.isEnabled)
            if (customHeadersEntered) {
                device.pressDPadDown()
                device.waitForIdle()
                device.pressDPadCenter()
            } else {
                visibleSubmit.click()
            }

            val importedSource = device.wait(Until.findObject(By.text(IMPORT_NAME)), 30_000)
            assertTrue("The imported source should return to Home", importedSource != null)
            assertTrue("The import dialog should close after the source is saved", device.wait(
                Until.gone(By.text("URL de playlist (m3u, m3u8)*")), 10_000,
            ))
            scenario.close()
            scenario = null

            TvPlaylistStore(context, databaseName).use { store ->
                val playlist = store.getPlaylists().singleOrNull { it.name == IMPORT_NAME }
                    ?: throw AssertionError("The M3U source should be persisted in the selected database")
                assertEquals(expectedRows, store.getPlaylistCounts(playlist.id).channels)
                assertEquals(sourceUrl, playlist.sourceUrl)
                assertEquals(expectedRows.coerceAtMost(500), playlist.channels.size)
                if (customHeadersEntered) {
                    assertEquals(TEST_USER_AGENT, playlist.sourceUserAgent)
                    assertEquals(TEST_REFERRER, playlist.sourceReferrer)
                    assertEquals(TEST_ORIGIN, playlist.sourceOrigin)
                    val channel = store.getChannelPage(playlist.id, 0, 1, radioOnly = false).single()
                    assertEquals(TEST_USER_AGENT, channel.userAgent)
                    assertEquals(TEST_REFERRER, channel.headers["Referer"])
                    assertEquals(TEST_ORIGIN, channel.headers["Origin"])
                }
            }
        } finally {
            scenario?.close()
            serving.set(false)
            server?.close()
            serverThread?.join(1_000L)
            if (!preserveCatalog) context.deleteDatabase(databaseName)
            if (!preserveCatalog) {
                preferences.edit().apply {
                    if (previousSelected == null) remove("selected_playlist_id") else putString("selected_playlist_id", previousSelected)
                    if (previousStartup == null) remove("startup_section") else putString("startup_section", previousStartup)
                    if (previousDashboard == null) remove("show_dashboard") else putBoolean("show_dashboard", previousDashboard)
                }.apply()
            }
        }
    }

    private fun setImportField(device: UiDevice, label: String, value: String) {
        // Expanding advanced options re-lays out and scrolls the form; wait for
        // it to settle and retry if a node is replaced while it is resolved.
        device.waitForIdle(1_000)
        var found: androidx.test.uiautomator.UiObject2? = null
        repeat(5) {
            if (found != null) return@repeat
            found = runCatching {
                val labelObject = device.wait(Until.findObject(By.text(label)), 5_000)
                    ?: throw AssertionError("The M3U field '$label' should be visible")
                val labelBounds = labelObject.visibleBounds
                device.findObjects(By.clazz("android.widget.EditText")).firstOrNull {
                    it.visibleBounds.contains(labelBounds.centerX(), labelBounds.centerY())
                }
            }.getOrElse { failure ->
                if (failure is AssertionError) throw failure
                Thread.sleep(200)
                null
            }
        }
        val field = found ?: throw AssertionError("The editable M3U field '$label' should contain its label")
        field.click()
        field.setText(value)
        // Compose publishes the new text on the next frame; poll briefly.
        val valueDeadline = android.os.SystemClock.elapsedRealtime() + 3_000L
        while (field.text != value && android.os.SystemClock.elapsedRealtime() < valueDeadline) {
            Thread.sleep(50)
        }
        assertEquals("The M3U field '$label' should retain its value", value, field.text)
        if (device.executeShellCommand("dumpsys input_method").contains("mIsInputViewShown=true")) {
            device.pressBack()
        }
    }

    private fun serveM3u(socket: Socket, payload: String) {
        socket.soTimeout = 3_000
        val input = socket.getInputStream().bufferedReader(StandardCharsets.US_ASCII)
        while (!input.readLine().isNullOrEmpty()) Unit
        val body = payload.toByteArray(StandardCharsets.UTF_8)
        socket.getOutputStream().apply {
            write("HTTP/1.1 200 OK\r\nContent-Type: audio/x-mpegurl; charset=utf-8\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
            write(body)
            flush()
        }
    }

    private fun android.content.SharedPreferences.takeBoolean(key: String): Boolean? =
        if (contains(key)) getBoolean(key, true) else null

    private companion object {
        const val DATABASE_NAME = "iptvnator-m3u-ui-import-test.db"
        const val IMPORT_NAME = "M3U UI import fixture"
        const val TEST_USER_AGENT = "IPTVnator-TV-Test/1.0"
        const val TEST_REFERRER = "https://provider.example/watch"
        const val TEST_ORIGIN = "https://provider.example"
        const val ARG_M3U_URL = "m3u_url"
        const val ARG_EXPECTED_ROWS = "expected_rows"
        const val ARG_PRESERVE_CATALOG = "preserve_catalog"
    }
}
