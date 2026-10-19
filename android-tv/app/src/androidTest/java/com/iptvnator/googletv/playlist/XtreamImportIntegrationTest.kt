package com.iptvnator.googletv.playlist

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.EpgGuideContent
import com.iptvnator.googletv.MainActivity
import com.iptvnator.googletv.LiveContent
import com.iptvnator.googletv.TvXtreamEpgPreview
import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.stalker.StalkerCredentials
import com.iptvnator.googletv.xtream.XtreamCredentials
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.Assume.assumeFalse
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.net.Socket
import java.net.InetAddress
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.net.SocketTimeoutException
import java.util.concurrent.Executors

@RunWith(AndroidJUnit4::class)
class XtreamImportIntegrationTest {
    private val databaseName = "iptvnator-xtream-import-test.db"
    private lateinit var context: Context
    private lateinit var store: TvPlaylistStore
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private lateinit var serverExecutor: java.util.concurrent.ExecutorService
    private lateinit var baseUrl: String
    private val accountInfoRequests = AtomicInteger()
    private val receivedActions = java.util.Collections.synchronizedList(mutableListOf<String>())
    private val delayCategoryResponses = AtomicBoolean(false)
    private val categoryRequestReceived = AtomicBoolean(false)
    private val cancelledCategoryConnections = AtomicInteger()
    private val delayLiveStreamResponses = AtomicBoolean(false)
    private val liveStreamRequestReceived = AtomicBoolean(false)
    private val cancelledLiveStreamConnections = AtomicInteger()
    private val shortEpgRequestCount = AtomicInteger()
    private val shortEpgStreamIds = java.util.Collections.synchronizedList(mutableListOf<String>())

    @Before
    fun setUp() {
        // Smart TV Pro isolates/hairpins local instrumentation sockets. The
        // same contract runs fully on emulator and Pixel; the physical TV is
        // covered by the install/launch smoke path instead.
        assumeFalse("Local fixture sockets are unavailable on Smart TV Pro", Build.MODEL.contains("Smart TV", ignoreCase = true))
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(databaseName)
        context.deleteDatabase(UI_TEST_DATABASE_NAME)
        store = TvPlaylistStore(context, databaseName)
        // Some physical TV images isolate instrumentation from loopback.
        // Bind all interfaces and use the device's active IPv4 address so
        // the app and fixture remain reachable in both emulator and hardware.
        server = ServerSocket(0, 50, InetAddress.getByName("0.0.0.0"))
        serverExecutor = Executors.newCachedThreadPool()
        baseUrl = "http://${activeIpv4Address()}:${server.localPort}"
        serverThread = Thread {
            runCatching {
                while (!server.isClosed) {
                    val socket = server.accept()
                    serverExecutor.execute { runCatching { socket.use(::respond) } }
                }
            }
        }.also { it.start() }
    }

    @After
    fun tearDown() {
        if (::server.isInitialized) server.close()
        if (::serverExecutor.isInitialized) serverExecutor.shutdownNow()
        if (::serverThread.isInitialized) serverThread.join(1_000)
        if (::store.isInitialized) store.close()
        if (::context.isInitialized) context.deleteDatabase(databaseName)
    }

    @Test
    fun importsAllXtreamCataloguesThroughBoundedLiveQueue() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "Fixture Xtream",
        )

        assertEquals("Fixture Xtream", imported.name)
        assertEquals(2, imported.channels.size)
        assertEquals("Noticias", imported.channels.first().group)
        assertEquals("1", imported.channels.first().providerCategoryId)
        assertEquals(48 * 24 * 60, imported.channels.first().tvArchiveDurationMinutes)
        assertEquals(1, imported.vod.size)
        assertEquals("Película fixture", imported.vod.single().name)
        assertEquals("2", imported.vod.single().providerCategoryId)
        assertEquals(1, imported.series.size)
        assertEquals("Serie fixture", imported.series.single().name)
        assertEquals("3", imported.series.single().providerCategoryId)
        assertEquals(2, store.getPlaylistCounts(imported.id).channels)
        assertEquals("1", store.getChannel(imported.id, "xtream:101")?.providerCategoryId)
    }

    @Test
    fun guideProgramSearchFindsStoredCategoryBeyondInitialPageAndOpensIt() {
        val repository = TvPlaylistRepository(store)
        val channels = (1..25).map { index ->
            TvChannel(
                id = "guide-search-channel-$index",
                name = "Canal de búsqueda $index",
                url = "https://example.test/live-$index.m3u8",
                group = "Noticias",
                tvgId = "guide-search-xmltv-$index",
            )
        }
        val channel = channels.last()
        val playlistId = "guide-search-fixture"
        store.replacePlaylist(playlistId, TvPlaylist("Guide search fixture", channels))
        val imported = StoredPlaylist(
            id = playlistId,
            name = "Guide search fixture",
            sourceUrl = null,
            channels = channels.take(1),
            catalogCounts = TvPlaylistCounts(channels = channels.size, vod = 0, series = 0),
        )
        val nowMs = System.currentTimeMillis()
        val programme = TvEpgEntry(
            channelId = channel.tvgId!!,
            startMs = nowMs - 60_000,
            endMs = nowMs + 60_000,
            title = "Programa para buscar en toda la lista",
            description = "Texto descriptivo sin el término consultado",
            category = "Especial invisible",
        )
        store.replaceEpg(playlistId, listOf(programme))
        val selected = AtomicReference<TvEpgEntry?>(null)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        EpgGuideContent(
                            playlists = listOf(imported),
                            repository = repository,
                            epgByChannel = emptyMap(),
                            xtreamEpgPreviews = emptyMap(),
                            preferUploadedEpgOverXtream = false,
                            favorites = emptyList(),
                            history = emptyList(),
                            viewMode = "timeline",
                            epgOffsetMinutes = 0,
                            statusMessage = null,
                            refreshing = false,
                            onRefresh = {},
                            onPlay = { _, _, entry -> selected.set(entry) },
                            onDownloadCatchup = { _, _, _ -> },
                            onCopyCatchup = { _, _, _ -> },
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation())
            val search = device.wait(
                Until.findObject(By.clazz("android.widget.EditText")),
                5_000,
            ) ?: throw AssertionError("The TV guide should expose programme search")
            search.click()
            search.setText("invisible")
            // Close the TV IME, then verify one remote-down lands directly on
            // the first result instead of walking through the guide toolbar.
            device.pressBack()
            val queryVisible = device.findObject(By.text("invisible")) != null
            val result = device.wait(
                Until.findObject(By.text("Programa para buscar en toda la lista")),
                5_000,
            ) ?: throw AssertionError("A category-only match beyond the loaded channel page should appear; queryVisible=$queryVisible")
            device.pressDPadDown()
            Thread.sleep(150)
            val screenshotDirectory = androidx.test.platform.app.InstrumentationRegistry
                .getInstrumentation().targetContext.externalCacheDir
                ?: throw AssertionError("The emulator should expose a screenshot cache")
            assertTrue(
                "Capture the visible EPG programme-search result",
                device.takeScreenshot(java.io.File(screenshotDirectory, "iptvnator-epg-program-search.png")),
            )
            device.pressDPadCenter()
            SystemClock.sleep(200)
            assertEquals("Selecting a result should open its channel/programme playback path", programme, selected.get())
        } finally {
            scenario.close()
        }
    }

    @Test
    fun persistedEpgSearchCoversTheFullSourceAndHonorsGuideScopes() {
        val repository = TvPlaylistRepository(store)
        val playlistId = "epg-search-scope-fixture"
        val channels = listOf(
            TvChannel("favorite-news", "Favorite news", "https://example.test/favorite", group = "Noticias", tvgId = "xmltv.favorite"),
            TvChannel("recent-sports", "Recent sports", "https://example.test/recent", group = "Deportes", tvgId = "xmltv.recent"),
            TvChannel("other-news", "Other news", "https://example.test/other", group = "Noticias", tvgId = "xmltv.other"),
        )
        store.replacePlaylist(playlistId, TvPlaylist("EPG search scope fixture", channels))
        val playlist = StoredPlaylist(
            id = playlistId,
            name = "EPG search scope fixture",
            sourceUrl = null,
            channels = channels,
            catalogCounts = TvPlaylistCounts(channels.size, 0, 0),
        )
        val now = System.currentTimeMillis()
        store.replaceEpg(
            playlistId,
            channels.mapIndexed { index, channel ->
                TvEpgEntry(
                    channelId = channel.tvgId!!,
                    startMs = now - 30_000,
                    endMs = now + 30_000,
                    title = "Programa especial $index",
                )
            },
        )
        fun saved(channel: TvChannel) = TvSavedItem(
            playlistId = playlistId,
            itemType = TvSavedItemType.CHANNEL,
            itemKey = channel.id,
            title = channel.name,
            uri = channel.url,
            coverUrl = null,
            savedAt = now,
            lastPlayedAt = null,
        )
        store.setFavorite(saved(channels[0]), true)
        store.recordPlayback(saved(channels[1]))

        assertEquals(3, repository.searchEpgPrograms(listOf(playlist), "especial", "Todos", now).size)
        assertEquals(
            listOf("favorite-news", "other-news"),
            repository.searchEpgPrograms(listOf(playlist), "especial", "Noticias", now)
                .map { it.channel.id }.sorted(),
        )
        assertEquals(
            listOf("favorite-news"),
            repository.searchEpgPrograms(listOf(playlist), "especial", "Favoritos", now)
                .map { it.channel.id },
        )
        assertEquals(
            listOf("recent-sports"),
            repository.searchEpgPrograms(listOf(playlist), "especial", "Recientes", now)
                .map { it.channel.id },
        )
    }

    @Test
    fun xtreamShortEpgLoadsOnlyForVisibleLiveChannels() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "Visible EPG fixture",
        )

        assertEquals("Native Xtream previews must not trigger a catalogue-wide sweep", 0, repository.refreshEpg(listOf(imported)))
        assertEquals(0, shortEpgRequestCount.get())

        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        LiveContent(
                            playlists = listOf(imported),
                            repository = repository,
                            sortPreferences = context.getSharedPreferences("xtream-visible-epg", Context.MODE_PRIVATE),
                            epgByChannel = emptyMap(),
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

            val device = UiDevice.getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation())
            assertTrue("The visible Xtream row should receive its provider short EPG", device.wait(
                Until.hasObject(By.text("Programa Xtream visible")), 10_000,
            ))
            assertEquals("Only the two rows in the current viewport should be requested", 2, shortEpgRequestCount.get())
            assertEquals(listOf("101", "102"), shortEpgStreamIds.toList())
        } finally {
            scenario.close()
        }
    }

    @Test
    fun currentXtreamArchiveProgrammeOffersStartOverFromTheGuide() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "Current archive fixture",
        )
        val channel = imported.channels.first()
        val nowMs = System.currentTimeMillis()
        val programme = TvEpgEntry(
            channelId = channel.id,
            startMs = nowMs - 5 * 60_000L,
            endMs = nowMs + 25 * 60_000L,
            title = "Programa Xtream en curso",
        )
        val selectedForPlayback = AtomicReference<TvEpgEntry?>(null)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme(
                        colorScheme = androidx.compose.material3.darkColorScheme(
                            primary = Color(0xFF6EA7FF),
                            onPrimary = Color(0xFF111827),
                            background = Color(0xFF161A22),
                            onBackground = Color(0xFFD8DCE8),
                            surface = Color(0xFF1A1E27),
                            onSurface = Color(0xFFD8DCE8),
                            surfaceVariant = Color(0xFF202532),
                            onSurfaceVariant = Color(0xFF8891A4),
                        ),
                    ) {
                        Box(Modifier.fillMaxSize().background(Color(0xFF161A22))) {
                            EpgGuideContent(
                                playlists = listOf(imported),
                                repository = repository,
                                epgByChannel = emptyMap(),
                                xtreamEpgPreviews = mapOf(
                                    "${imported.id}:${channel.id}" to TvXtreamEpgPreview(
                                        entries = listOf(programme),
                                        fetchedAtMs = System.currentTimeMillis(),
                                        offsetMinutes = 0,
                                    ),
                                ),
                                preferUploadedEpgOverXtream = false,
                                favorites = emptyList(),
                                history = emptyList(),
                                viewMode = "timeline",
                                epgOffsetMinutes = 0,
                                statusMessage = null,
                                refreshing = false,
                                onRefresh = {},
                                onPlay = { _, _, selected -> selectedForPlayback.set(selected) },
                                onDownloadCatchup = { _, _, _ -> },
                                onCopyCatchup = { _, _, _ -> },
                            )
                        }
                    }
                }
            }

            val device = UiDevice.getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation())
            // The guide card shows the title and its archive state as a
            // separate "Desde el inicio" tag.
            val startOverCard = device.wait(
                Until.findObject(By.text("Programa Xtream en curso")),
                5_000,
            )
            assertTrue(
                "A current provider-archived programme should advertise start-over",
                startOverCard != null && device.findObject(By.text("Desde el inicio")) != null,
            )
            assertTrue("An in-progress programme must not offer a completed-file download", device.findObject(By.text("Descargar")) == null)
            val screenshotDirectory = androidx.test.platform.app.InstrumentationRegistry
                .getInstrumentation().targetContext.externalCacheDir
                ?: throw AssertionError("The instrumentation app should expose a screenshot cache")
            assertTrue(
                "Capture the visible guide start-over affordance",
                device.takeScreenshot(java.io.File(screenshotDirectory, "iptvnator-xtream-start-over.png")),
            )
            startOverCard!!.click()
            assertEquals("The D-pad/click action should select the current programme for archive playback", programme, selectedForPlayback.get())
        } finally {
            scenario.close()
        }
    }

    @Test
    fun xtreamGuideLoadsOnlyItsFirstPageForLargeCatalogues() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "large", "secret"),
            name = "Large Guide EPG fixture",
        )
        assertEquals(28_280, store.getPlaylistCounts(imported.id).channels)
        assertEquals("The guide should receive only the bounded startup snapshot", 500, imported.channels.size)
        assertEquals("Importing a large Xtream source must not request per-channel EPG", 0, shortEpgRequestCount.get())

        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        val previews = androidx.compose.runtime.remember {
                            androidx.compose.runtime.mutableStateOf(emptyMap<String, TvXtreamEpgPreview>())
                        }
                        EpgGuideContent(
                            playlists = listOf(imported),
                            repository = repository,
                            epgByChannel = emptyMap(),
                            xtreamEpgPreviews = previews.value,
                            preferUploadedEpgOverXtream = false,
                            favorites = emptyList(),
                            history = emptyList(),
                            viewMode = "timeline",
                            epgOffsetMinutes = 0,
                            statusMessage = null,
                            refreshing = false,
                            onRefresh = {},
                            onXtreamEpgPreviewLoaded = { key, preview -> previews.value = previews.value + (key to preview) },
                            onPlay = { _, _, _ -> },
                            onDownloadCatchup = { _, _, _ -> },
                            onCopyCatchup = { _, _, _ -> },
                        )
                    }
                }
            }

            val device = UiDevice.getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation())
            val programmeVisible = device.wait(Until.hasObject(By.textContains("Programa Xtream visible")), 10_000)
            val requestDeadline = SystemClock.elapsedRealtime() + 10_000L
            while (shortEpgRequestCount.get() < 20 && SystemClock.elapsedRealtime() < requestDeadline) Thread.sleep(50)
            val visibleText = device.findObjects(By.pkg("com.iptvnator.googletv"))
                .mapNotNull { runCatching { it.text?.toString() }.getOrNull() }
                .filter { it.isNotBlank() }
                .distinct()
            assertTrue(
                "The guide should fetch and show Xtream EPG without first visiting Live TV; " +
                    "requests=${shortEpgRequestCount.get()}, ids=${shortEpgStreamIds.toList()}, ui=$visibleText",
                programmeVisible,
            )
            assertEquals("The first guide page must not sweep all 28,280 Xtream channels", 20, shortEpgRequestCount.get())
            assertEquals((1..20).map { it.toString() }.toSet(), shortEpgStreamIds.toSet())
        } finally {
            scenario.close()
        }
    }

    @Test
    fun refreshEpgImportsConfiguredXmltvWithoutScanningXtreamChannels() {
        val guideFile = java.io.File(context.filesDir, "xtream-manual-guide.xml")
        guideFile.writeText(
            """<tv>
                <channel id="fixture.tv"><display-name>Fixture TV</display-name></channel>
                <programme start="20260101080000 +0000" stop="20260101090000 +0000" channel="fixture.tv">
                    <title>Manual XMLTV fixture</title>
                </programme>
            </tv>""".trimIndent(),
        )
        try {
            val repository = TvPlaylistRepository(store)
            val imported = repository.importXtream(
                credentials = XtreamCredentials(baseUrl, "demo", "secret"),
                name = "Manual EPG fixture",
                epgUrls = listOf(guideFile.toURI().toString()),
            )

            assertEquals(1, repository.refreshEpg(listOf(imported)))
            assertEquals(
                "Manual XMLTV fixture",
                store.getEpg(imported.id, "fixture.tv", 0L, Long.MAX_VALUE).single().title,
            )
            assertEquals("Configured XMLTV refresh must not launch an Xtream-wide sweep", 0, shortEpgRequestCount.get())
        } finally {
            guideFile.delete()
        }
    }

    @Test
    fun editingXtreamConnectionKeepsPlaylistStateAndReplacesOldProviderCache() {
        val xtreamCache = mutableMapOf<String, XtreamCredentials>()
        val stalkerCache = mutableMapOf<String, StalkerCredentials>()
        val repository = TvPlaylistRepository(
            store,
            xtreamCredentials = xtreamCache,
            stalkerCredentials = stalkerCache,
        )
        val previous = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "Before edit",
        )
        val channel = store.getChannel(previous.id, "xtream:101")!!
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
        store.recordPlaybackPosition(saved, positionMs = 42_000L, durationMs = 120_000L)
        store.setHiddenGroupTitles(previous.id, listOf("Noticias"))
        store.setHiddenCategories(previous.id, listOf(TvHiddenCategory("live", "1")))
        stalkerCache[previous.id] = StalkerCredentials("https://old.example", "00:1A:79:AA:BB:CC")

        val edited = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "edited-user", "new-secret"),
            name = "After edit",
            playlistIdOverride = previous.id,
        )

        assertEquals(previous.id, edited.id)
        assertEquals("After edit", edited.name)
        assertEquals(listOf("Noticias"), edited.hiddenGroupTitles)
        assertEquals(listOf(TvHiddenCategory("live", "1")), edited.hiddenCategories)
        assertEquals(listOf(saved.itemKey), repository.loadFavorites().map(TvSavedItem::itemKey))
        assertEquals(42_000L, repository.loadHistory().single().resumePositionMs)
        assertEquals("edited-user", repository.loadProviderAccount(edited.id).xtream?.username)
        assertEquals("Xtream credentials should replace the old Stalker cache", null, repository.loadProviderAccount(edited.id).stalker)
        assertEquals(1, repository.loadStored().size)
    }

    @Test
    fun catchupResolutionReusesTheAccountMetadataLoadedDuringImport() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "Catch-up fixture Xtream",
        )
        val accountInfoCountAfterImport = accountInfoRequests.get()
        val program = TvEpgEntry(
            channelId = "fixture.tv",
            startMs = 1_700_000_000_000L,
            endMs = 1_700_003_600_000L,
            title = "Programa archivado",
        )

        val firstUrl = repository.resolveCatchup(imported.id, imported.channels.first(), program)
        val secondUrl = repository.resolveCatchup(imported.id, imported.channels.first(), program)

        assertTrue(firstUrl.orEmpty().contains("/timeshift/"))
        assertEquals(firstUrl, secondUrl)
        assertEquals(
            "Catch-up should reuse the timezone/formats cached at import instead of requesting account info again",
            accountInfoCountAfterImport,
            accountInfoRequests.get(),
        )
    }

    @Test
    fun currentXtreamCatchupResolutionCapsDurationAtTheProviderClock() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "Current catch-up fixture",
        )
        val channel = imported.channels.first()
        val startMs = System.currentTimeMillis() - 5 * 60_000L
        val nowMs = startMs + 2 * 60_000L
        val programme = TvEpgEntry(
            channelId = channel.id,
            startMs = startMs,
            endMs = startMs + 30 * 60_000L,
            title = "Programa en curso",
        )

        val url = repository.resolveCatchup(imported.id, channel, programme, nowMs = nowMs)

        assertTrue("The archive duration must stop at now, not include unrecorded future minutes", url.orEmpty().contains("/timeshift/demo/secret/2/"))
    }

    @Test
    fun groupedChannelPagesStayGloballyOrderedAcrossBoundaries() {
        val channels = listOf(
            TvChannel("1", "Zeta", "https://example.test/1", group = "Zulu"),
            TvChannel("2", "Alpha", "https://example.test/2", group = "alpha"),
            TvChannel("3", "Zulu", "https://example.test/3", group = "Alpha"),
            TvChannel("4", "Sin grupo", "https://example.test/4"),
            TvChannel("5", "Otro", "https://example.test/5", group = "Beta"),
        )
        store.replacePlaylist("grouped-pages", TvPlaylist("Grouped pages", channels))

        val allPages = (0 until 5).flatMap { offset ->
            store.getGroupedChannelPage("grouped-pages", offset = offset, limit = 1, radioOnly = false)
        }

        assertEquals(listOf("Alpha", "alpha", "Beta", null, "Zulu"), allPages.map { it.group })
        assertEquals(listOf("Zulu", "Alpha", "Otro", "Sin grupo", "Zeta"), allPages.map { it.name })

        val queryPlan = store.readableDatabase.rawQuery(
            """EXPLAIN QUERY PLAN SELECT id FROM channels INDEXED BY channels_grouped_picker_idx
                WHERE playlist_id = ? AND radio = 0
                ORDER BY COALESCE(NULLIF(TRIM(group_name), ''), 'Sin grupo') COLLATE NOCASE,
                         COALESCE(NULLIF(TRIM(group_name), ''), 'Sin grupo') COLLATE BINARY,
                         name COLLATE NOCASE, id LIMIT 200 OFFSET 0""".trimIndent(),
            arrayOf("grouped-pages"),
        ).use { cursor ->
            buildList { while (cursor.moveToNext()) add(cursor.getString(3)) }.joinToString(" ")
        }
        assertTrue("Grouped pages should use the ordering index: $queryPlan", queryPlan.contains("channels_grouped_picker_idx"))
        assertTrue("Grouped pages should not sort into a temporary B-tree: $queryPlan", !queryPlan.contains("TEMP B-TREE"))
    }

    @Test
    fun importsOriginalDesktopXtreamBackupAndRestoresUserState() {
        val backup = """
            {
              "kind": "iptvnator-playlist-backup",
              "version": 1,
              "exportedAt": "2026-09-22T00:00:00.000Z",
              "includeSecrets": true,
              "playlists": [{
                "portalType": "xtream",
                "exportedId": "desktop-xtream",
                "title": "Desktop Xtream fixture",
                "autoRefresh": false,
                "connection": {
                  "serverUrl": "$baseUrl",
                  "username": "demo",
                  "password": "secret"
                },
                "userState": {
                  "hiddenCategories": [
                    {"type":"live","id":"1"},
                    {"type":"movies","id":"2"},
                    {"type":"series","id":"3"}
                  ],
                  "favorites": [{"contentType": "live", "xtreamId": 101, "position": 0}],
                  "recentlyViewed": [{"contentType": "live", "xtreamId": 101, "viewedAt": "2026-09-22T00:00:00.000Z"}],
                  "playbackPositions": [{"contentXtreamId": 1, "contentType": "episode", "seriesXtreamId": 1, "positionSeconds": 42, "durationSeconds": 120, "updatedAt": "2026-09-22T00:00:00.000Z"}]
                }
              }]
            }
        """.trimIndent()

        val repository = TvPlaylistRepository(store)
        val summary = TvPlaylistBackup.import(backup, repository)

        assertEquals(1, summary.imported)
        assertEquals(0, summary.failed)
        assertEquals(1, store.getFavorites().size)
        assertEquals("Canal fixture", store.getFavorites().single().title)
        assertEquals(1, store.getHistory().size)
        assertEquals(42_000L, store.getEpisodeProgress(summary.importedPlaylistIds.single(), 1).getValue(1).positionMs)
        assertEquals(
            listOf(TvHiddenCategory("live", "1"), TvHiddenCategory("movies", "2"), TvHiddenCategory("series", "3")),
            store.getHiddenCategories(summary.importedPlaylistIds.single()),
        )
    }

    @Test
    fun exportsXtreamAsSharedDesktopBackupAndRestoresAndroidState() {
        val vault = TvCredentialVault(context)
        val repository = TvPlaylistRepository(store, credentialVault = vault)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "Shared backup Xtream",
        )
        val channel = store.getChannel(imported.id, "xtream:101")!!
        val favorite = TvSavedItem(
            playlistId = imported.id,
            itemType = TvSavedItemType.CHANNEL,
            itemKey = channel.id,
            title = channel.name,
            uri = channel.url,
            coverUrl = channel.logoUrl,
            savedAt = 1_700_000_000_000L,
            lastPlayedAt = 1_700_000_100_000L,
            isFavorite = true,
        )
        store.setFavorite(favorite, true)
        store.updateFavoriteOrder(listOf(favorite), playlistId = imported.id)
        store.setHiddenCategories(imported.id, listOf(TvHiddenCategory("live", "1")))
        val progress = TvEpisodeProgress(imported.id, 201, 301, 42_000L, 120_000L, false, 1_700_000_200_000L)
        store.restoreEpisodeProgress(progress)
        val epgSources = listOf(TvEpgSourceState("https://guide.example/tv.xml", true, detected = true))
        store.setEpgSourceStates(imported.id, epgSources)

        val backup = TvPlaylistBackup.export(
            playlists = repository.loadStoredForBackup(),
            credentials = vault,
            savedItems = repository.loadFavorites() + repository.loadHistory(),
            episodeProgress = listOf(progress),
            epgSourceStates = mapOf(imported.id to epgSources),
        )
        val manifest = org.json.JSONObject(backup)
        assertEquals("iptvnator-playlist-backup", manifest.getString("kind"))
        val entry = manifest.getJSONArray("playlists").getJSONObject(0)
        assertEquals("xtream", entry.getString("portalType"))
        assertEquals(baseUrl, entry.getJSONObject("connection").getString("serverUrl"))
        assertEquals("demo", entry.getJSONObject("connection").getString("username"))
        assertEquals(1, entry.getJSONObject("userState").getJSONArray("favorites").length())
        assertEquals("live", entry.getJSONObject("userState").getJSONArray("hiddenCategories")
            .getJSONObject(0).getString("categoryType"))
        assertEquals(1, entry.getJSONObject("androidTvState").getJSONArray("epgSources").length())

        val restored = TvPlaylistBackup.import(backup, repository)
        assertEquals(1, restored.imported)
        assertEquals(0, restored.failed)
        assertEquals(listOf(TvHiddenCategory("live", "1")), store.getHiddenCategories(imported.id))
        assertEquals(0, store.getFavorites().single { it.playlistId == imported.id }.playlistFavoriteOrder)
        assertEquals(42_000L, store.getEpisodeProgress(imported.id, 201).getValue(301).positionMs)
        assertEquals(epgSources, store.getEpgSourceStates(imported.id))
    }

    @Test
    fun importsLargeLiveCatalogueThroughStreamingWriter() {
        val repository = TvPlaylistRepository(store)
        val importStartedAt = System.nanoTime()
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "large", "secret"),
            name = "Large fixture Xtream",
        )
        val importElapsedMs = (System.nanoTime() - importStartedAt) / 1_000_000L
        android.util.Log.i("XtreamImportPerf", "live_channels=28280 elapsed_ms=$importElapsedMs")

        // The returned TV snapshot is intentionally bounded; the complete
        // catalogue must still be present in SQLite for paging/search.
        assertEquals(500, imported.channels.size)
        assertEquals("The default storage snapshot must stay bounded for large providers", 500, store.getPlaylists().single().channels.size)
        assertEquals(28_280, store.getPlaylistCounts(imported.id).channels)
        assertEquals(
            "Canal fixture 28280",
            store.getChannel(imported.id, "xtream:28280")?.name,
        )
        assertEquals(mapOf("Noticias" to 28_280), store.getChannelGroupCounts(imported.id))

        // Live TV remains pageable after import without expanding its
        // bounded in-memory snapshot back to the complete provider catalogue.
        val lateGroupPage = repository.loadChannelGroupPage(
            playlistId = imported.id,
            groupName = "Noticias",
            offset = 27_780,
            limit = 500,
            radioOnly = false,
        )
        assertEquals(500, lateGroupPage.size)
        assertEquals("Canal fixture 27781", lateGroupPage.first().name)
        assertEquals("Canal fixture 28280", lateGroupPage.last().name)
        assertEquals(28_280, repository.countMatchingChannels(imported.id, "Noticias", radioOnly = false))
        assertEquals("Canal fixture 28280", repository.loadAdjacentChannel(imported.id, "xtream:28279", 1)?.name)
        assertEquals("Canal fixture 1", repository.loadAdjacentChannel(imported.id, "xtream:28280", 1)?.name)
        assertEquals("Canal fixture 28280", repository.loadAdjacentChannel(imported.id, "xtream:1", -1)?.name)
    }

    @Test
    fun importsHundredThousandRowsAcrossAllXtreamCatalogues() {
        val repository = TvPlaylistRepository(store)
        val importStartedAt = System.nanoTime()
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "performance", "performance"),
            name = "100k performance fixture",
        )
        val importElapsedMs = (System.nanoTime() - importStartedAt) / 1_000_000L
        val counts = store.getPlaylistCounts(imported.id)
        android.util.Log.i(
            "XtreamImportPerf",
            "catalogue_rows=${counts.channels + counts.vod + counts.series} " +
                "live=${counts.channels} vod=${counts.vod} series=${counts.series} " +
                "elapsed_ms=$importElapsedMs",
        )

        assertEquals(60_000, counts.channels)
        assertEquals(20_000, counts.vod)
        assertEquals(20_000, counts.series)
        assertEquals("TV category 60", store.getChannel(imported.id, "xtream:60000")?.group)
        assertEquals("Movie category 20", store.getVodItem(imported.id, 220_000)?.categoryId)
        assertEquals("Series category 20", store.getSeriesItem(imported.id, 320_000)?.categoryId)
        assertContentCatalogIndexesPresent()

        // UI-facing snapshots stay bounded, while every provider catalogue
        // remains accessible through the same paging paths used by TV.
        assertEquals(500, imported.channels.size)
        assertEquals(500, imported.vod.size)
        assertEquals(500, imported.series.size)
        assertEquals(500, repository.loadChannelPage(imported.id, 59_500, 500).size)
        assertEquals(500, repository.loadVodPage(imported.id, 19_500, 500).size)
        assertEquals(500, repository.loadSeriesPage(imported.id, 19_500, 500).size)
        assertEquals(60, repository.loadChannelGroupCounts(imported.id).size)
        assertEquals(20, repository.loadVodCategoryMappings(imported.id).size)
        assertEquals(20, repository.loadSeriesCategoryMappings(imported.id).size)
    }

    @Test
    fun importsHundredThousandRowsThroughTheTvXtreamForm() {
        val fixtureName = "Xtream UI 100k fixture"
        val fixtureUsername = "performance"
        val preferences = context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
        val previousSelectedPlaylistId = preferences.getString("selected_playlist_id", null)
        val scenario = ActivityScenario.launch<MainActivity>(
            Intent(context, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_DEBUG_DATABASE_NAME, UI_TEST_DATABASE_NAME),
        )
        val device = UiDevice.getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation())
        var testFailure: Throwable? = null
        var importUiSucceeded = false
        try {
            val addButton = device.wait(Until.findObject(By.text("+")), 10_000)
                ?: throw AssertionError("The Home toolbar should expose Add playlist")
            addButton.click()
            assertTrue("The playlist source chooser should open", device.wait(
                Until.hasObject(By.text("Añadir playlist")), 5_000,
            ))
            assertTrue("The source chooser should establish initial M3U focus before DPAD input", waitForFocusOn(
                device,
                "URL M3U",
            ))

            // Select Xtream and ensure the focus ring stays on that provider
            // when its connection form replaces M3U.
            assertTrue("The Xtream source card should be visible", device.wait(
                Until.hasObject(By.text("Credenciales Xtream")), 5_000,
            ))
            device.findObject(By.text("Credenciales Xtream")).click()
            assertTrue("Selecting Xtream must not send focus back to M3U", waitForFocusOn(
                device,
                "Credenciales Xtream",
            ))

            enterImportField(device, "Nombre de playlist", fixtureName)
            enterImportField(device, "Servidor", baseUrl)
            enterImportField(device, "Usuario", fixtureUsername)
            enterImportField(device, "Contraseña", "performance-secret")
            val connectButton = device.wait(Until.findObject(By.text("Conectar Xtream")), 3_000)
                ?: throw AssertionError("The Connect Xtream action should be visible")
            assertTrue("Connect must enable after all four fields are entered", connectButton.isEnabled)
            assertTrue("The Connect Xtream action should be the next D-pad target", device.wait(
                Until.hasObject(By.text("Conectar Xtream")), 3_000,
            ))
            connectButton.click()

            val progressLabels = listOf(
                "Autenticando con Xtream",
                "Conectando con el panel Xtream",
                "Cargando canales y categorías",
                "Canales en directo:",
                "Importando catálogo Xtream",
                "Preparando películas",
                "Importando películas:",
                "Preparando series",
                "Importando series:",
            )
            var visibleProgress: String? = null
            val progressDeadline = SystemClock.elapsedRealtime() + 5_000L
            while (visibleProgress == null && SystemClock.elapsedRealtime() < progressDeadline) {
                visibleProgress = progressLabels.firstOrNull { label ->
                    device.hasObject(By.textContains(label))
                }
                if (visibleProgress == null) Thread.sleep(30)
            }
            val visibleUiText = device.findObjects(By.pkg("com.iptvnator.googletv"))
                .mapNotNull { runCatching { it.text?.toString() }.getOrNull() }
                .filter { it.isNotBlank() }
                .distinct()
                .take(40)
            assertTrue(
                "The long import should expose a live progress phase; requests=${receivedActions.toList()}, UI=$visibleUiText",
                visibleProgress != null,
            )
            // The form is hidden (not removed) behind the progress panel while
            // the import runs, so completion is the panel going away.
            assertTrue("The import progress panel should close when import completes", device.wait(
                Until.gone(By.textStartsWith("Sincronizando")), 60_000,
            ))
            assertTrue("The Xtream form should close when import completes", device.wait(
                Until.gone(By.text("Introduce los datos de tu servidor Xtream")), 10_000,
            ))
            var selectedSourceVisible = false
            val selectedSourceDeadline = SystemClock.elapsedRealtime() + 3_000L
            while (!selectedSourceVisible && SystemClock.elapsedRealtime() < selectedSourceDeadline) {
                selectedSourceVisible = device.findObjects(By.text(fixtureName)).any {
                    it.visibleBounds.top < 120
                }
                if (!selectedSourceVisible) Thread.sleep(40)
            }
            assertTrue("Home should show the imported Xtream source in its toolbar", selectedSourceVisible)
            importUiSucceeded = true
        } catch (failure: Throwable) {
            testFailure = failure
            throw failure
        } finally {
            scenario.close()
            runCatching {
                if (importUiSucceeded) {
                    val appStore = TvPlaylistStore(context, UI_TEST_DATABASE_NAME)
                    try {
                        val appRepository = TvPlaylistRepository(
                            appStore,
                            credentialVault = TvCredentialVault(context),
                        )
                        val imported = appRepository.loadStored().singleOrNull { it.name == fixtureName }
                            ?: throw AssertionError("The visible import should be persisted in the application database")
                        val counts = appStore.getPlaylistCounts(imported.id)
                        assertEquals(60_000, counts.channels)
                        assertEquals(20_000, counts.vod)
                        assertEquals(20_000, counts.series)
                        assertEquals("Only bounded live snapshots should enter Home state", 500, imported.channels.size)
                        assertEquals("Only bounded VOD snapshots should enter Home state", 500, imported.vod.size)
                        assertEquals("Only bounded series snapshots should enter Home state", 500, imported.series.size)
                        val credentials = appRepository.loadProviderAccount(imported.id).xtream
                        assertEquals(baseUrl, credentials?.serverUrl)
                        assertEquals(fixtureUsername, credentials?.username)
                        appRepository.deletePlaylist(imported.id)
                    } finally {
                        appStore.close()
                    }
                }
            }.exceptionOrNull()?.let { verificationFailure ->
                testFailure?.addSuppressed(verificationFailure) ?: throw verificationFailure
            }
            preferences.edit().apply {
                if (previousSelectedPlaylistId == null) remove("selected_playlist_id")
                else putString("selected_playlist_id", previousSelectedPlaylistId)
            }.apply()
            context.deleteDatabase(UI_TEST_DATABASE_NAME)
        }
    }

    @Test
    fun refreshUsesInMemoryCredentialsAndKeepsAllEpgSources() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "Refresh fixture Xtream",
            epgUrls = listOf("https://guide.one/xmltv", "https://guide.two/xmltv"),
        )

        // This repository deliberately has no credential vault. Refresh must
        // still use the account retained by the import instead of requesting
        // the Xtream host root as if it were an M3U playlist.
        val refreshProgress = java.util.Collections.synchronizedList(mutableListOf<String>())
        val refreshed = repository.refreshPlaylist(imported) { progress ->
            refreshProgress += progress.phase
        }

        assertEquals(imported.id, refreshed.id)
        assertEquals(
            listOf("account", "metadata", "vod", "live", "live", "vod", "series", "series", "complete"),
            refreshProgress,
        )
        assertEquals(
            listOf("https://guide.one/xmltv", "https://guide.two/xmltv"),
            store.getEpgSourceStates(refreshed.id).map { it.url },
        )
        assertEquals("Canal fixture", refreshed.channels.first().name)
    }

    @Test
    fun xtreamRefreshPreservesDisabledEpgSourcesButExplicitReconfigurationReplacesThem() {
        val repository = TvPlaylistRepository(store)
        val imported = repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "EPG preference refresh fixture",
            epgUrls = listOf("https://guide.one/xmltv", "https://guide.two/xmltv"),
        )
        assertTrue(store.setEpgSourceEnabled(imported.id, "https://guide.two/xmltv", false))
        val configuredBeforeRefresh = store.getEpgSourceStates(imported.id)
        assertEquals(
            listOf(
                TvEpgSourceState("https://guide.one/xmltv", enabled = true),
                TvEpgSourceState("https://guide.two/xmltv", enabled = false),
            ),
            configuredBeforeRefresh,
        )

        val currentPlaylist = repository.loadStored().single { it.id == imported.id }
        val refreshed = repository.refreshPlaylist(currentPlaylist)

        assertEquals(configuredBeforeRefresh, store.getEpgSourceStates(imported.id))
        assertEquals(listOf("https://guide.one/xmltv"), refreshed.epgUrls)

        repository.importXtream(
            credentials = XtreamCredentials(baseUrl, "demo", "secret"),
            name = "EPG preference refresh fixture",
            epgUrls = listOf("https://guide.changed/xmltv"),
            playlistIdOverride = imported.id,
        )
        assertEquals(
            listOf(TvEpgSourceState("https://guide.changed/xmltv", enabled = true)),
            store.getEpgSourceStates(imported.id),
        )
    }

    @Test
    fun cancellingLargeImportRollsBackPartialCatalog() {
        val repository = TvPlaylistRepository(store)
        val cancellationChecks = AtomicInteger(0)
        var cancelled = false
        val playlistId = "xtream:${baseUrl.lowercase()}:large".hashCode().toUInt().toString(16)
        store.replacePlaylist(
            playlistId,
            TvPlaylist("Previous catalogue", listOf(TvChannel("old", "Old channel", "https://old.example/live"))),
            sourceUrl = "https://old.example/player_api.php",
        )

        try {
            repository.importXtream(
                credentials = XtreamCredentials(baseUrl, "large", "secret"),
                name = "Cancelled fixture Xtream",
                isCancelled = {
                    cancellationChecks.incrementAndGet() > 30
                },
            )
        } catch (_: kotlinx.coroutines.CancellationException) {
            cancelled = true
        }

        assertTrue("the streaming import should observe cancellation", cancelled)
        assertTrue("cancellation should be checked while streaming", cancellationChecks.get() > 30)
        val preserved = store.getPlaylists().single()
        assertEquals("Previous catalogue", preserved.name)
        assertEquals("Old channel", preserved.channels.single().name)
        assertContentCatalogIndexesPresent()
    }

    @Test
    fun cancellationRemainsResponsiveWhileXtreamCategoriesAreLoading() {
        val repository = TvPlaylistRepository(store)
        val previousId = "previous-catalogue"
        store.replacePlaylist(
            previousId,
            TvPlaylist("Previous catalogue", listOf(TvChannel("old", "Old channel", "https://old.example/live"))),
            sourceUrl = "https://old.example/player_api.php",
        )
        delayCategoryResponses.set(true)
        delayLiveStreamResponses.set(true)

        val startedAt = System.nanoTime()
        var cancelled = false
        try {
            repository.importXtream(
                credentials = XtreamCredentials(baseUrl, "cancel-metadata", "secret"),
                name = "Cancelled metadata fixture",
                isCancelled = { categoryRequestReceived.get() && liveStreamRequestReceived.get() },
            )
        } catch (_: kotlinx.coroutines.CancellationException) {
            cancelled = true
        }
        val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000L

        assertTrue("category fixture should have received a request", categoryRequestReceived.get())
        assertTrue("live catalogue fixture should have received a request", liveStreamRequestReceived.get())
        assertTrue("the import should observe cancellation", cancelled)
        assertTrue("Cancel should not wait for the deliberately slow category response (elapsed=${elapsedMs}ms)", elapsedMs < 2_000L)
        val closeDeadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(2)
        while (cancelledCategoryConnections.get() == 0 && System.nanoTime() < closeDeadline) Thread.sleep(20)
        assertTrue("cancellation should close the provider socket, not leave its worker downloading", cancelledCategoryConnections.get() > 0)
        while (cancelledLiveStreamConnections.get() == 0 && System.nanoTime() < closeDeadline) Thread.sleep(20)
        assertTrue("cancellation should close the large live-catalogue socket", cancelledLiveStreamConnections.get() > 0)
        val preserved = store.getPlaylists().single()
        assertEquals("Previous catalogue", preserved.name)
        assertEquals("Old channel", preserved.channels.single().name)
    }

    private fun respond(socket: Socket) {
        val request = socket.getInputStream().bufferedReader()
        val line = request.readLine() ?: return
        while (request.readLine() != "") {
            // Consume the request headers before writing the response.
        }
        val query = line.substringAfter(' ', "").substringBefore(' ', "")
            .substringAfter('?', "")
            .split('&')
            .filter { it.contains('=') }
            .associate { part ->
                val pieces = part.split('=', limit = 2)
                URLDecoder.decode(pieces[0], "UTF-8") to URLDecoder.decode(pieces[1], "UTF-8")
            }
        query["action"]?.let(receivedActions::add)
        if (query["action"] == "get_account_info") accountInfoRequests.incrementAndGet()
        val isCategoryRequest = query["action"] in setOf("get_live_categories", "get_vod_categories", "get_series_categories")
        if (isCategoryRequest) {
            categoryRequestReceived.set(true)
            if (delayCategoryResponses.get()) {
                if (waitForClientClose(socket)) {
                    cancelledCategoryConnections.incrementAndGet()
                    return
                }
            }
        }
        if (query["action"] == "get_live_streams") {
            liveStreamRequestReceived.set(true)
            if (delayLiveStreamResponses.get()) {
                if (waitForClientClose(socket)) {
                    cancelledLiveStreamConnections.incrementAndGet()
                    return
                }
            }
        }
        if (query["action"] == "get_short_epg") {
            shortEpgRequestCount.incrementAndGet()
            shortEpgStreamIds += query["stream_id"].orEmpty()
        }
        val performance = query["username"] == "performance"
        val body = when (query["action"]) {
            "get_live_categories" -> if (performance) performanceCategories("TV", 60, 10_000) else "[{\"category_id\":\"1\",\"category_name\":\"Noticias\"}]"
            "get_vod_categories" -> if (performance) performanceCategories("Movie", 20, 20_000) else "[{\"category_id\":\"2\",\"category_name\":\"Películas\"}]"
            "get_series_categories" -> if (performance) performanceCategories("Series", 20, 30_000) else "[{\"category_id\":\"3\",\"category_name\":\"Series\"}]"
            "get_live_streams" -> if (performance) {
                performanceStreams(
                    "stream_id", "Canal", 60_000, 0, 10_000, 60,
                    "\"stream_icon\":null,\"epg_channel_id\":null,\"tv_archive\":0,\"tv_archive_duration\":0",
                )
            } else if (query["username"] == "large") {
                buildString {
                    append('[')
                    repeat(28_280) { index ->
                        if (index > 0) append(',')
                        val id = index + 1
                        append("{\"stream_id\":$id,\"name\":\"Canal fixture $id\",\"category_id\":\"1\",\"category_name\":\"Noticias\",\"stream_icon\":null,\"epg_channel_id\":null,\"tv_archive\":0,\"tv_archive_duration\":0}")
                    }
                    append(']')
                }
            } else """
                [{"stream_id":101,"name":"Canal fixture","category_id":"1","category_name":"Noticias","stream_icon":"https://img.example/live.png","epg_channel_id":"fixture.tv","tv_archive":1,"tv_archive_duration":48},
                 {"stream_id":102,"name":"Radio fixture","category_id":"1","category_name":"Noticias","stream_icon":null,"epg_channel_id":null,"tv_archive":0,"tv_archive_duration":0}]
            """.trimIndent().replace("\n", "")
            "get_vod_streams" -> if (performance) {
                performanceStreams(
                    "stream_id", "Movie", 20_000, 200_000, 20_000, 20,
                    "\"stream_icon\":null,\"container_extension\":\"mp4\",\"rating\":\"8.2\",\"added\":\"1700000000\"",
                )
            } else "[{\"stream_id\":201,\"name\":\"Película fixture\",\"category_id\":\"2\",\"stream_icon\":null,\"container_extension\":\"mp4\",\"rating\":\"8.2\",\"added\":\"1700000000\"}]"
            "get_series" -> if (performance) {
                performanceStreams(
                    "series_id", "Series", 20_000, 300_000, 30_000, 20,
                    "\"cover\":null,\"plot\":\"Performance fixture\",\"rating\":\"7.5\",\"added\":\"1700000000\"",
                )
            } else "[{\"series_id\":301,\"name\":\"Serie fixture\",\"category_id\":\"3\",\"cover\":null,\"plot\":\"Una serie\",\"rating\":\"7.5\",\"added\":\"1700000000\"}]"
            "get_short_epg" -> {
                val nowSeconds = System.currentTimeMillis() / 1_000L
                val title = android.util.Base64.encodeToString(
                    "Programa Xtream visible".toByteArray(StandardCharsets.UTF_8),
                    android.util.Base64.NO_WRAP,
                )
                """{"epg_listings":[{"start_timestamp":"${nowSeconds - 300}","stop_timestamp":"${nowSeconds + 3_300}","title":"$title"}]}"""
            }
            else -> """
                {"user_info":{"auth":1,"status":"Active","username":"demo"},"server_info":{"timezone":"UTC","allowed_output_formats":["m3u8"]}}
            """.trimIndent().replace("\n", "")
        }
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        socket.getOutputStream().use { output ->
            output.write(response.toByteArray(StandardCharsets.UTF_8))
            output.write(bytes)
            output.flush()
        }
    }

    private fun waitForFocusOn(device: UiDevice, label: String): Boolean {
        val deadline = SystemClock.elapsedRealtime() + 2_000L
        while (SystemClock.elapsedRealtime() < deadline) {
            val focused = device.findObject(By.focused(true))
            val labelBounds = device.findObject(By.text(label))?.visibleBounds
            if (focused != null && labelBounds != null &&
                focused.visibleBounds.contains(labelBounds.centerX(), labelBounds.centerY())
            ) {
                return true
            }
            Thread.sleep(40)
        }
        return false
    }

    private fun enterImportField(device: UiDevice, label: String, value: String) {
        val fieldLabel = device.wait(Until.findObject(By.text(label)), 5_000)
            ?: throw AssertionError("The Xtream field '$label' should be visible")
        val labelBounds = fieldLabel.visibleBounds
        val field = device.findObjects(By.clazz("android.widget.EditText")).firstOrNull {
            it.visibleBounds.contains(labelBounds.centerX(), labelBounds.centerY())
        } ?: throw AssertionError("The editable Xtream field '$label' should contain its label")
        field.click()
        field.setText(value)
        if (label != "Contraseña") {
            // Compose applies the accessibility text on the next frame; poll
            // like the Stalker form test instead of reading it synchronously.
            val valueDeadline = SystemClock.elapsedRealtime() + 3_000L
            var retained = false
            while (!retained && SystemClock.elapsedRealtime() < valueDeadline) {
                retained = device.findObjects(By.clazz("android.widget.EditText"))
                    .any { it.text?.toString() == value }
                if (!retained) Thread.sleep(50)
            }
            assertTrue("The Xtream field '$label' should retain the entered value", retained)
        }
        if (device.executeShellCommand("dumpsys input_method").contains("mIsInputViewShown=true")) {
            device.pressBack()
            val hideDeadline = SystemClock.elapsedRealtime() + 3_000L
            while (SystemClock.elapsedRealtime() < hideDeadline &&
                device.executeShellCommand("dumpsys input_method").contains("mIsInputViewShown=true")
            ) {
                Thread.sleep(50)
            }
        }
        assertTrue("The import form should retain editable fields after keyboard dismissal", device.wait(
            Until.findObject(By.clazz("android.widget.EditText")), 2_000,
        ) != null)
    }

    private fun assertContentCatalogIndexesPresent() {
        val indexes = store.readableDatabase.rawQuery(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('vod', 'series')",
            null,
        ).use { cursor -> buildSet { while (cursor.moveToNext()) add(cursor.getString(0)) } }
        assertTrue(
            "VOD/series lookup indexes must be restored after catalogue commit or rollback",
            indexes.containsAll(
                setOf(
                    "vod_playlist_idx",
                    "series_playlist_idx",
                    "vod_recent_idx",
                    "series_recent_idx",
                    "vod_name_lookup_idx",
                    "series_name_lookup_idx",
                ),
            ),
        )
    }

    private fun performanceCategories(label: String, count: Int, idBase: Int): String = buildString {
        append('[')
        repeat(count) { index ->
            if (index > 0) append(',')
            val number = index + 1
            append("{\"category_id\":\"").append(idBase + number)
                .append("\",\"category_name\":\"").append(label).append(" category ").append(number)
                .append("\"}")
        }
        append(']')
    }

    private fun performanceStreams(
        idKey: String,
        label: String,
        count: Int,
        idBase: Int,
        categoryIdBase: Int,
        categoryCount: Int,
        extraFields: String,
    ): String = buildString(count * 150) {
        append('[')
        repeat(count) { index ->
            if (index > 0) append(',')
            val id = idBase + index + 1
            val categoryId = categoryIdBase + (index % categoryCount) + 1
            append('{').append('"').append(idKey).append("\":").append(id)
                .append(",\"name\":\"").append(label).append(" performance ").append(index + 1)
                .append("\",\"category_id\":\"").append(categoryId).append("\",")
                .append(extraFields).append('}')
        }
        append(']')
    }

    private fun waitForClientClose(socket: Socket): Boolean {
        socket.soTimeout = 100
        val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(3)
        while (System.nanoTime() < deadline) {
            try {
                if (socket.getInputStream().read() < 0) return true
            } catch (_: SocketTimeoutException) {
                // A live client keeps the request socket open; cancellation sends EOF.
            }
        }
        return false
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

    companion object {
        private const val UI_TEST_DATABASE_NAME = "iptvnator-xtream-ui-import-test.db"
    }
}
