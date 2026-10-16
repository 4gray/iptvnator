package com.iptvnator.googletv.playlist

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.LiveContent
import com.iptvnator.googletv.MainActivity
import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.stalker.StalkerCredentials
import com.iptvnator.googletv.xtream.XtreamCredentials
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StalkerImportIntegrationTest {
    private val databaseName = "iptvnator-stalker-import-test.db"
    private lateinit var context: Context
    private lateinit var store: TvPlaylistStore
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private lateinit var baseUrl: String
    private val failPartialCatalogPageThree = AtomicBoolean(false)
    @Volatile private var profileRequestIdentity: Map<String, String> = emptyMap()
    @Volatile private var stalkerHandshakeCount = 0
    @Volatile private var shortEpgRequestCount = 0
    @Volatile private var lastShortEpgSize: String? = null

    @Before
    fun setUp() {
        assumeFalse("Local fixture sockets are unavailable on Smart TV Pro", Build.MODEL.contains("Smart TV", ignoreCase = true))
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(databaseName)
        store = TvPlaylistStore(context, databaseName)
        server = ServerSocket(0, 50, InetAddress.getByName("0.0.0.0"))
        baseUrl = "http://${activeIpv4Address()}:${server.localPort}"
        serverThread = Thread {
            runCatching {
                while (!server.isClosed) server.accept().use(::respond)
            }
        }.also { it.start() }
    }

    @After
    fun tearDown() {
        if (::server.isInitialized) server.close()
        if (::serverThread.isInitialized) serverThread.join(1_000)
        if (::store.isInitialized) store.close()
        if (::context.isInitialized) context.deleteDatabase(databaseName)
    }

    @Test
    fun importsLiveRadioVodAndSeriesThroughStalkerContract() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importStalker(
            credentials = StalkerCredentials(
                portalUrl = baseUrl,
                macAddress = "00:1A:79:AA:BB:CC",
                serialNumber = "SERIAL-IMPORT",
                deviceId1 = "DEVICE-IMPORT-1",
                deviceId2 = "DEVICE-IMPORT-2",
                signature1 = "SIGNATURE-IMPORT-1",
                signature2 = "SIGNATURE-IMPORT-2",
            ),
            name = "Fixture Stalker",
        )

        assertEquals("Fixture Stalker", imported.name)
        assertEquals(2, imported.channels.size)
        assertEquals("Noticias", imported.channels.first().group)
        assertTrue("channels=${imported.channels.map { it.name to it.radio }}", imported.channels.any { it.radio })
        assertEquals(1, imported.vod.size)
        assertEquals("Película portal", imported.vod.single().name)
        assertEquals(1, imported.series.size)
        assertEquals("Serie portal", imported.series.single().name)
        assertEquals(2, store.getPlaylistCounts(imported.id).channels)
        assertEquals(1, store.getPlaylistCounts(imported.id).vod)
        assertEquals(1, store.getPlaylistCounts(imported.id).series)
        val importedChannel = store.getChannel(imported.id, "stalker:11")!!
        assertEquals(false, importedChannel.useHttpTmpLink)
        assertEquals(false, importedChannel.useLoadBalancing)
        val importedVod = store.getVodItem(imported.id, 201)!!
        assertEquals(true, importedVod.useHttpTmpLink)
        assertEquals(false, importedVod.useLoadBalancing)
        val importedSeries = store.getSeriesItem(imported.id, 301)!!
        assertEquals("Serie portal", importedSeries.name)
        assertEquals("stalker", importedSeries.providerType)
        assertEquals(false, importedSeries.useHttpTmpLink)
        assertEquals(false, importedSeries.useLoadBalancing)
        assertEquals("DEVICE-IMPORT-1", profileRequestIdentity["device_id"])
        assertEquals("DEVICE-IMPORT-2", profileRequestIdentity["device_id2"])
        assertEquals("SIGNATURE-IMPORT-1", profileRequestIdentity["signature"])
        assertEquals("SIGNATURE-IMPORT-2", profileRequestIdentity["signature2"])
        assertEquals("DEVICE-IMPORT-1", repository.loadProviderAccount(imported.id).stalker?.deviceId1)
    }

    @Test
    fun importsStalkerThroughVisibleTvFormAndDpad() {
        val preferences = context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
        val previousSelected = preferences.getString("selected_playlist_id", null)
        val previousStartup = preferences.getString("startup_section", null)
        val previousDashboard = if (preferences.contains("show_dashboard")) {
            preferences.getBoolean("show_dashboard", true)
        } else {
            null
        }
        preferences.edit().putString("startup_section", "Home").putBoolean("show_dashboard", true).apply()

        var scenario: ActivityScenario<MainActivity>? = null
        try {
            scenario = ActivityScenario.launch(
                Intent(context, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_DEBUG_DATABASE_NAME, databaseName),
            )
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val addSource = device.wait(Until.findObject(By.text("+")), 10_000)
                ?: throw AssertionError("Home should expose its add-source action")
            addSource.click()
            assertTrue("The add-playlist source chooser should open", device.wait(
                Until.hasObject(By.text("Añadir playlist")), 5_000,
            ))
            val stalkerCard = device.wait(Until.findObject(By.text("Portal Stalker")), 5_000)
                ?: throw AssertionError("The source chooser should offer Stalker")
            stalkerCard.click()
            assertTrue("Selecting Stalker should keep its card focused", waitForFocusOn(device, "Portal Stalker"))

            device.pressDPadDown()
            val nameReceivedDpadFocus = waitForImportFieldFocus(
                device,
                "Nombre de playlist",
            )
            if (!nameReceivedDpadFocus) {
                val cache = requireNotNull(context.externalCacheDir)
                device.takeScreenshot(java.io.File(cache, "stalker-form-focus-debug.png"))
                device.dumpWindowHierarchy(java.io.File(cache, "stalker-form-focus-debug.xml"))
            }
            assertTrue(
                "DPAD_DOWN from the Stalker card should focus the playlist name; " +
                    "focused=${runCatching { device.findObject(By.focused(true))?.visibleBounds }.getOrNull()}",
                nameReceivedDpadFocus,
            )
            enterStalkerImportField(device, "Nombre de playlist", "UI Stalker fixture")
            enterStalkerImportField(device, "Portal o URL /c", baseUrl)
            enterStalkerImportField(device, "MAC (00:1A:79:AA:BB:CC)", "00:1A:79:AA:BB:CC")

            val connect = device.wait(Until.findObject(By.text("Conectar Stalker")), 5_000)
                ?: run {
                    val cache = requireNotNull(context.externalCacheDir)
                    device.takeScreenshot(java.io.File(cache, "stalker-connect-missing-debug.png"))
                    device.dumpWindowHierarchy(java.io.File(cache, "stalker-connect-missing-debug.xml"))
                    throw AssertionError("The Stalker connection action should be reachable")
                }
            assertTrue("The portal and normalized MAC should enable connection", connect.isEnabled)
            assertTrue(
                "The pinned Stalker action must have a usable visible target without scrolling the form: ${connect.visibleBounds}",
                connect.visibleBounds.height() >= 40,
            )
            val passwordLabel = device.wait(
                Until.findObject(By.text("Contraseña (si el portal la pide)")),
                5_000,
            ) ?: throw AssertionError("The optional Stalker password field should remain available")
            val passwordLabelBounds = passwordLabel.visibleBounds
            val passwordField = device.findObjects(By.clazz("android.widget.EditText")).firstOrNull {
                it.visibleBounds.contains(passwordLabelBounds.centerX(), passwordLabelBounds.centerY())
            } ?: throw AssertionError("The optional Stalker password field should be editable")
            assertTrue(
                "The pinned connection action must not cover the password field: " +
                    "password=${passwordField.visibleBounds}, action=${connect.visibleBounds}",
                passwordField.visibleBounds.bottom <= connect.visibleBounds.top,
            )
            device.takeScreenshot(java.io.File(requireNotNull(context.externalCacheDir), "stalker-form-action-pinned.png"))
            connect.click()

            val importDialogClosed = device.wait(Until.gone(By.text("Portal o URL /c")), 30_000)
            if (!importDialogClosed) {
                val cache = requireNotNull(context.externalCacheDir)
                device.takeScreenshot(java.io.File(cache, "stalker-import-not-finished-debug.png"))
                device.dumpWindowHierarchy(java.io.File(cache, "stalker-import-not-finished-debug.xml"))
            }
            assertTrue("A successful portal import should close its form and return to Home", importDialogClosed)
            assertTrue("The imported source should be visible on Home", device.wait(
                Until.hasObject(By.text("UI Stalker fixture")), 5_000,
            ))

            val imported = store.getPlaylists().singleOrNull { it.name == "UI Stalker fixture" }
                ?: throw AssertionError("The visible Stalker form should persist its source")
            val counts = store.getPlaylistCounts(imported.id)
            assertEquals(2, counts.channels)
            assertEquals(1, counts.vod)
            assertEquals(1, counts.series)
            val importedRepository = TvPlaylistRepository(store, credentialVault = TvCredentialVault(context))
            val credentials = importedRepository.loadProviderAccount(imported.id).stalker
                ?: throw AssertionError("The imported Stalker account should be recoverable")
            assertEquals("$baseUrl/server/load.php", credentials.portalUrl)
            assertEquals("00:1A:79:AA:BB:CC", credentials.macAddress)
            assertEquals("TV portal", store.getChannel(imported.id, "stalker:11")?.name)
            assertTrue("The portal fixture should import radio alongside TV", store.getChannel(imported.id, "stalker:12")?.radio == true)
            assertEquals("Película portal", store.getVodItem(imported.id, 201)?.name)
            assertEquals("Serie portal", store.getSeriesItem(imported.id, 301)?.name)
        } finally {
            scenario?.close()
            runCatching {
                val cleanupRepository = TvPlaylistRepository(store, credentialVault = TvCredentialVault(context))
                store.getPlaylists().forEach { cleanupRepository.deletePlaylist(it.id) }
            }
            preferences.edit().apply {
                if (previousSelected == null) remove("selected_playlist_id") else putString("selected_playlist_id", previousSelected)
                if (previousStartup == null) remove("startup_section") else putString("startup_section", previousStartup)
                if (previousDashboard == null) remove("show_dashboard") else putBoolean("show_dashboard", previousDashboard)
            }.apply()
        }
    }

    @Test
    fun loadsVisibleStalkerShortEpgAndReusesTheAuthenticatedSession() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importStalker(
            StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"),
            "Fixture Stalker EPG",
        )
        val handshakesBeforePreview = stalkerHandshakeCount

        val first = repository.loadStalkerShortEpg(imported.id, "stalker:11")
        val second = repository.loadStalkerShortEpg(imported.id, "stalker:11")

        assertEquals(1, first.size)
        assertEquals("stalker:11", first.single().channelId)
        assertEquals("En antena", first.single().title)
        assertTrue(first.single().startMs < first.single().endMs)
        assertEquals(first, second)
        assertEquals("Each explicit repository request reaches the portal; row-level caching is owned by the visible-preview queue", 2, shortEpgRequestCount)
        assertEquals("The preview reuses its short-lived authenticated portal session", 1, stalkerHandshakeCount - handshakesBeforePreview)
    }

    @Test
    fun liveListFillsMissingCurrentStalkerProgramFromShortEpg() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importStalker(
            StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"),
            "Fixture Stalker live guide",
        )
        val now = System.currentTimeMillis()
        val currentTimeMissingBulk = mapOf(
            "${imported.id}:stalker:11" to listOf(
                TvEpgEntry("stalker:11", now + 3_600_000, now + 7_200_000, "Solo programa futuro"),
            ),
        )
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        LiveContent(
                            playlists = listOf(imported),
                            repository = repository,
                            sortPreferences = context.getSharedPreferences("stalker-short-epg-ui", Context.MODE_PRIVATE),
                            epgOffsetMinutes = -15,
                            epgByChannel = currentTimeMissingBulk,
                            favorites = emptyList(),
                            history = emptyList(),
                            onToggleFavorite = { _, _ -> },
                            onEditEpg = { _, _ -> },
                            onSaveHiddenGroups = { _, _ -> },
                            onPlay = { _, _, _, _ -> },
                        )
                    }
                }
            }
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val shortEpgProgrammeVisible = device.wait(Until.hasObject(By.text("En antena")), 10_000)
            assertTrue(
                "The currently airing programme should come from get_short_epg when bulk Stalker EPG has only a future entry " +
                    "(requests=$shortEpgRequestCount, size=$lastShortEpgSize)",
                shortEpgProgrammeVisible,
            )
            assertEquals(1, shortEpgRequestCount)
            assertEquals("4", lastShortEpgSize)
        } finally {
            scenario.close()
        }
    }

    @Test
    fun exportsImportedStalkerAsEncryptedProviderConnection() {
        val vault = TvCredentialVault(context)
        val repository = TvPlaylistRepository(store, credentialVault = vault)
        val imported = repository.importStalker(
            credentials = StalkerCredentials(
                portalUrl = baseUrl,
                macAddress = "00:1A:79:AA:BB:CC",
                serialNumber = "SERIAL-FIXTURE",
                username = "portal-user",
                password = "portal-pass",
                deviceId1 = "DEVICE-1",
                deviceId2 = "DEVICE-2",
                signature1 = "SIGNATURE-1",
                signature2 = "SIGNATURE-2",
            ),
            name = "Fixture Stalker backup",
        )

        val backup = TvPlaylistBackup.export(
            playlists = repository.loadStoredForBackup(),
            credentials = vault,
        )
        val entry = org.json.JSONObject(backup).getJSONArray("playlists").getJSONObject(0)
        val connection = entry.getJSONObject("connection")

        assertEquals(imported.name, entry.getString("title"))
        assertEquals("stalker", entry.getString("portalType"))
        assertEquals(baseUrl + "/server/load.php", connection.getString("portalUrl"))
        assertEquals("00:1A:79:AA:BB:CC", connection.getString("macAddress"))
        assertEquals("SERIAL-FIXTURE", connection.getString("stalkerSerialNumber"))
        assertEquals("portal-user", connection.getString("username"))
        assertEquals("portal-pass", connection.getString("password"))
        assertEquals("DEVICE-1", connection.getString("stalkerDeviceId1"))
        assertEquals("DEVICE-2", connection.getString("stalkerDeviceId2"))
        assertEquals("SIGNATURE-1", connection.getString("stalkerSignature1"))
        assertEquals("SIGNATURE-2", connection.getString("stalkerSignature2"))
        assertEquals("DEVICE-1", vault.loadStalker(imported.id)?.deviceId1)
        assertEquals("SIGNATURE-2", vault.loadStalker(imported.id)?.signature2)

        val restored = TvPlaylistBackup.import(backup, repository)
        assertEquals(1, restored.imported)
        assertEquals(0, restored.failed)
        assertEquals("DEVICE-1", repository.loadProviderAccount(imported.id).stalker?.deviceId1)
        assertEquals("DEVICE-2", repository.loadProviderAccount(imported.id).stalker?.deviceId2)
        assertEquals("SIGNATURE-1", repository.loadProviderAccount(imported.id).stalker?.signature1)
        assertEquals("SIGNATURE-2", repository.loadProviderAccount(imported.id).stalker?.signature2)
    }

    @Test
    fun importsMagIdentityFromOriginalDesktopBackup() {
        val repository = TvPlaylistRepository(store, credentialVault = TvCredentialVault(context))
        val backup = """
            {
              "kind":"iptvnator-playlist-backup",
              "version":1,
              "exportedAt":"2026-09-23T00:00:00.000Z",
              "includeSecrets":true,
              "playlists":[{
                "portalType":"stalker",
                "exportedId":"desktop-stalker",
                "title":"Desktop portal identity",
                "connection":{
                  "portalUrl":"$baseUrl",
                  "macAddress":"00:1A:79:AA:BB:CC",
                  "username":"portal-user",
                  "password":"portal-pass",
                  "stalkerSerialNumber":"SERIAL-DESKTOP",
                  "stalkerDeviceId1":"DEVICE-DESKTOP-1",
                  "stalkerDeviceId2":"DEVICE-DESKTOP-2",
                  "stalkerSignature1":"SIGNATURE-DESKTOP-1",
                  "stalkerSignature2":"SIGNATURE-DESKTOP-2"
                },
                "userState":{"favorites":[],"recentlyViewed":[]}
              }]
            }
        """.trimIndent()

        val summary = TvPlaylistBackup.import(backup, repository)

        assertEquals(1, summary.imported)
        assertEquals(0, summary.failed)
        assertEquals("DEVICE-DESKTOP-1", profileRequestIdentity["device_id"])
        val restored = repository.loadProviderAccount(summary.importedPlaylistIds.single()).stalker!!
        assertEquals("SERIAL-DESKTOP", restored.serialNumber)
        assertEquals("DEVICE-DESKTOP-1", restored.deviceId1)
        assertEquals("DEVICE-DESKTOP-2", restored.deviceId2)
        assertEquals("SIGNATURE-DESKTOP-1", restored.signature1)
        assertEquals("SIGNATURE-DESKTOP-2", restored.signature2)
    }

    @Test
    fun failedStalkerRefreshKeepsTheLastCompletePlaylist() {
        val repository = TvPlaylistRepository(store)
        val credentials = StalkerCredentials("$baseUrl/partial-catalog", "00:1A:79:AA:BB:CC")
        val imported = repository.importStalker(credentials, "Working fixture")
        val originalChannelNames = store.getChannelPage(imported.id, 0, 20, radioOnly = false).map { it.name }
        assertEquals(listOf("Canal parcial 1", "Canal parcial 2", "Canal parcial 3"), originalChannelNames)
        failPartialCatalogPageThree.set(true)

        val failure = runCatching {
            repository.importStalker(credentials, "Incomplete fixture")
        }.exceptionOrNull()

        assertTrue("Expected the failed third page to abort import, got $failure", failure?.message.orEmpty().contains("page 3"))
        assertEquals("Working fixture", repository.loadStored().single().name)
        assertEquals(originalChannelNames, store.getChannelPage(imported.id, 0, 20, radioOnly = false).map { it.name })
    }

    @Test
    fun importsPagedStalkerVodWithoutBuildingAFullCatalogList() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importStalker(
            StalkerCredentials("$baseUrl/paged-catalog", "00:1A:79:AA:BB:CC"),
            "Paged Stalker fixture",
        )

        assertEquals(6_400, store.getPlaylistCounts(imported.id).vod)
        assertEquals("Película 6400", store.getVodItem(imported.id, 6_400)?.name)
        assertEquals("stalker://${imported.id}/vod/6400", store.getVodItem(imported.id, 6_400)?.url)
    }

    @Test
    fun editingStalkerConnectionKeepsPlaylistStateAndReplacesOldProviderCache() {
        val xtreamCache = mutableMapOf<String, XtreamCredentials>()
        val repository = TvPlaylistRepository(store, xtreamCredentials = xtreamCache)
        val previous = repository.importStalker(
            StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CC"),
            "Before edit",
        )
        val channel = store.getChannelPage(previous.id, offset = 0, limit = 10).first()
        val saved = TvSavedItem(
            playlistId = previous.id,
            itemType = TvSavedItemType.CHANNEL,
            itemKey = channel.id,
            title = channel.name,
            uri = channel.url,
            coverUrl = channel.logoUrl,
            savedAt = 1L,
            lastPlayedAt = null,
        )
        store.setFavorite(saved, true)
        store.setHiddenGroupTitles(previous.id, listOf("Noticias"))
        xtreamCache[previous.id] = XtreamCredentials("https://old.example", "stale", "cache")

        val edited = repository.importStalker(
            StalkerCredentials(baseUrl, "00:1A:79:AA:BB:CD"),
            "After edit",
            playlistIdOverride = previous.id,
        )

        assertEquals(previous.id, edited.id)
        assertEquals("After edit", edited.name)
        assertEquals(listOf("Noticias"), edited.hiddenGroupTitles)
        assertEquals(listOf(saved.itemKey), repository.loadFavorites().map(TvSavedItem::itemKey))
        assertEquals("Stalker credentials should replace the old Xtream cache", null, repository.loadProviderAccount(edited.id).xtream)
        assertEquals("00:1A:79:AA:BB:CD", repository.loadProviderAccount(edited.id).stalker?.macAddress)
        assertEquals(1, repository.loadStored().size)
    }

    private fun waitForFocusOn(device: UiDevice, label: String): Boolean {
        val deadline = SystemClock.elapsedRealtime() + 2_000L
        while (SystemClock.elapsedRealtime() < deadline) {
            val labelBounds = device.findObject(By.text(label))?.visibleBounds
            if (labelBounds != null && device.findObjects(By.focused(true)).any { focused ->
                    runCatching {
                        focused.visibleBounds.contains(labelBounds.centerX(), labelBounds.centerY())
                    }.getOrDefault(false)
                }
            ) {
                return true
            }
            Thread.sleep(40)
        }
        return false
    }

    private fun waitForImportFieldFocus(device: UiDevice, label: String): Boolean {
        val deadline = SystemClock.elapsedRealtime() + 2_000L
        while (SystemClock.elapsedRealtime() < deadline) {
            val labelBounds = device.findObject(By.text(label))?.visibleBounds
            if (labelBounds != null && device.findObjects(By.clazz("android.widget.EditText")).any { field ->
                    field.isFocused && field.visibleBounds.contains(labelBounds.centerX(), labelBounds.centerY())
                }
            ) {
                return true
            }
            Thread.sleep(40)
        }
        return false
    }

    private fun enterStalkerImportField(device: UiDevice, label: String, value: String) {
        val fieldLabel = device.wait(Until.findObject(By.text(label)), 5_000)
            ?: throw AssertionError("The Stalker field '$label' should be visible")
        val labelBounds = fieldLabel.visibleBounds
        val field = device.findObjects(By.clazz("android.widget.EditText")).firstOrNull {
            it.visibleBounds.contains(labelBounds.centerX(), labelBounds.centerY())
        } ?: throw AssertionError("The editable Stalker field '$label' should contain its label")
        field.click()
        field.setText(value)
        val enteredValue = waitForImportFieldValue(device, value)
        if (!enteredValue) {
            val cache = requireNotNull(context.externalCacheDir)
            device.takeScreenshot(java.io.File(cache, "stalker-field-entry-debug.png"))
            device.dumpWindowHierarchy(java.io.File(cache, "stalker-field-entry-debug.xml"))
        }
        assertTrue(
            "The Stalker field '$label' should retain the entered value in the refreshed Compose hierarchy",
            enteredValue,
        )
        dismissStalkerKeyboard(device)
        assertTrue(
            "The Stalker field '$label' should keep its value when the TV keyboard closes",
            waitForImportFieldValue(device, value),
        )
    }

    private fun dismissStalkerKeyboard(device: UiDevice) {
        val imePackage = device.executeShellCommand("settings get secure default_input_method")
            .trim()
            .substringBefore('/')
            .takeIf(String::isNotBlank)
            ?: return
        val keyboard = By.pkg(imePackage)
        if (!device.wait(Until.hasObject(keyboard), 1_500L)) return
        device.pressBack()
        assertTrue(
            "Pressing Back should close the TV keyboard without closing the playlist form",
            device.wait(Until.gone(keyboard), 2_000L),
        )
        device.waitForIdle()
    }

    private fun waitForImportFieldValue(device: UiDevice, value: String): Boolean {
        val deadline = SystemClock.elapsedRealtime() + 3_000L
        while (SystemClock.elapsedRealtime() < deadline) {
            val hasValue = runCatching {
                device.findObjects(By.clazz("android.widget.EditText")).any { field ->
                    field.text?.toString() == value
                }
            }.getOrDefault(false)
            if (hasValue) return true
            Thread.sleep(40)
        }
        return false
    }

    private fun respond(socket: Socket) {
        val reader = socket.getInputStream().bufferedReader()
        val requestLine = reader.readLine().orEmpty()
        while (reader.readLine() != "") Unit
        val query = requestLine.substringAfter(' ', "")
            .substringBefore(' ', "")
            .substringAfter('?', "")
            .split('&')
            .filter { it.contains('=') }
            .associate { part ->
                val pieces = part.split('=', limit = 2)
                URLDecoder.decode(pieces[0], "UTF-8") to URLDecoder.decode(pieces[1], "UTF-8")
            }
        if (query["action"] == "get_profile") profileRequestIdentity = query
        if (query["action"] == "handshake") stalkerHandshakeCount += 1
        if (failPartialCatalogPageThree.get() && requestLine.contains("partial-catalog") && query["action"] == "get_ordered_list" &&
            query["type"] == "itv" && query["p"] == "3"
        ) {
            socket.getOutputStream().use { output ->
                output.write("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.UTF_8))
                output.flush()
            }
            return
        }
        val body = when (query["action"]) {
            "handshake" -> """{"js":{"token":"fixture-token-$stalkerHandshakeCount","random":"fixture-random"}}"""
            "get_profile" -> """{"js":{"status":"0","account_info":{"login":"fixture-user","tariff_plan_name":"Premium","expire_date":"4102444800"}}}"""
            "get_genres" -> """{"js":[{"id":"7","title":"Noticias"}]}"""
            "get_short_epg" -> {
                shortEpgRequestCount += 1
                lastShortEpgSize = query["size"]
                val now = System.currentTimeMillis() / 1_000
                """{"js":{"data":[{"id":"preview-1","name":"En antena","start_timestamp":${now - 60},"stop_timestamp":${now + 1_800},"descr":"Programa actual"}]}}"""
            }
            "get_all_channels" -> if (requestLine.contains("partial-catalog") && query["type"] == "itv") {
                """{"js":{"data":[]}}"""
            } else if (query["type"] == "radio") {
                """{"js":{"data":[{"id":"12","name":"Radio portal","cmd":"http://media.test/radio.aac","tv_genre_id":"7","radio":1}]}}"""
            } else {
                """{"js":{"data":[{"id":"11","name":"TV portal","cmd":"ffrt http://media.test/live.m3u8","tv_genre_id":"7","use_http_tmp_link":"0","use_load_balancing":"0"}]}}"""
            }
            "get_ordered_list" -> if (requestLine.contains("partial-catalog") && query["type"] == "itv") {
                when (query["p"]) {
                    "1" -> """{"js":{"data":[{"id":"301","name":"Canal parcial 1","cmd":"ffrt http://media.test/1.m3u8"}],"total_items":"3","max_page_items":"1"}}"""
                    "2" -> """{"js":{"data":[{"id":"302","name":"Canal parcial 2","cmd":"ffrt http://media.test/2.m3u8"}],"total_items":"3","max_page_items":"1"}}"""
                    else -> """{"js":{"data":[{"id":"303","name":"Canal parcial 3","cmd":"ffrt http://media.test/3.m3u8"}],"total_items":"3","max_page_items":"1"}}"""
                }
            } else if (requestLine.contains("paged-catalog") && query["type"] == "vod") {
                val page = query["p"]?.toIntOrNull() ?: 1
                val firstId = (page - 1) * 100 + 1
                val items = (firstId until firstId + 100).joinToString(",") { id ->
                    """{"id":"$id","name":"Película $id","cmd":"ffrt http://media.test/$id.mp4","category_name":"Películas"}"""
                }
                """{"js":{"data":[$items],"total_items":"6400","max_page_items":"100","total_pages":"64"}}"""
            } else if (query["type"] == "series") {
                """{"js":[{"id":"301","name":"Serie portal","cmd":"ffrt http://media.test/series","category_name":"Series","is_series":1,"use_http_tmp_link":"0","use_load_balancing":"0"}]}"""
            } else {
                """{"js":[{"id":"201","name":"Película portal","cmd":"ffrt http://media.test/movie.mp4","category_name":"Películas","added":"1700000000","use_http_tmp_link":"1","use_load_balancing":"0"},{"id":"301","name":"Serie heredada","cmd":"ffrt http://media.test/legacy-series","category_name":"Series","is_series":1,"use_http_tmp_link":"1","use_load_balancing":"1"}]}"""
            }
            else -> """{"js":[]}"""
        }
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val headers = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().use { output ->
            output.write(headers.toByteArray(StandardCharsets.UTF_8))
            output.write(bytes)
            output.flush()
        }
    }

    private fun activeIpv4Address(): String {
        val interfaces = NetworkInterface.getNetworkInterfaces()
        while (interfaces.hasMoreElements()) {
            val networkInterface = interfaces.nextElement()
            if (!networkInterface.isUp || networkInterface.isLoopback) continue
            val addresses = networkInterface.inetAddresses
            while (addresses.hasMoreElements()) {
                val address = addresses.nextElement()
                if (address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress) {
                    return address.hostAddress ?: continue
                }
            }
        }
        return "127.0.0.1"
    }
}
