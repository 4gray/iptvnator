package com.iptvnator.googletv.playlist

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class M3uEpgRegionRecommendationImportTest {
    private val databaseName = "iptvnator-m3u-epg-region-import-test.db"
    private lateinit var context: Context
    private lateinit var store: TvPlaylistStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(databaseName)
        store = TvPlaylistStore(context, databaseName)
    }

    @After
    fun tearDown() {
        store.close()
        context.deleteDatabase(databaseName)
    }

    @Test
    fun autoImportFetchesRegionMatchedGuideAndKeepsAllDetectedUrls() {
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1")).apply {
            soTimeout = 750
        }
        val requestedPaths = CopyOnWriteArrayList<String>()
        val serverThread = thread(name = "iptvnator-m3u-epg-region-fixture", isDaemon = true) {
            while (!server.isClosed) {
                val client = runCatching { server.accept() }.getOrNull() ?: break
                client.use { socket ->
                    val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
                    val requestLine = reader.readLine().orEmpty()
                    while (reader.readLine()?.isNotEmpty() == true) Unit
                    requestLine.split(' ').getOrNull(1)?.let(requestedPaths::add)
                    val body = "<?xml version=\"1.0\"?><tv></tv>".toByteArray(Charsets.UTF_8)
                    socket.getOutputStream().apply {
                        write("HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        write(body)
                        flush()
                    }
                }
            }
        }

        try {
            val base = "http://127.0.0.1:${server.localPort}"
            val paths = listOf(
                "/guides/us-en/guide.xml",
                "/guides/gb-en/guide.xml",
                "/guides/fr-fr/guide.xml",
                "/guides/pt-pt/guide.xml",
                "/guides/de-de/guide.xml",
                "/guides/it-it/guide.xml",
            )
            val m3u = buildString {
                appendLine("#EXTM3U x-tvg-url=\"${paths.joinToString(",") { base + it }}\"")
                appendLine("#EXTINF:-1 tvg-country=\"PT\" tvg-id=\"station.pt\",Canal")
                append("https://stream.example/live")
            }

            val imported = TvPlaylistRepository(store).importM3uReader(
                reader = m3u.reader().buffered(),
                name = "Regional EPG fixture",
                identitySeed = "m3u-epg-region-recommendation",
            )
            serverThread.join(2_000)

            assertEquals(listOf(paths[3]), requestedPaths)
            assertEquals(listOf(base + paths[3]), imported.epgUrls)
            assertEquals(
                paths.mapIndexed { index, path -> TvEpgSourceState(base + path, enabled = index == 3, detected = true) },
                store.getEpgSourceStates(imported.id),
            )
        } finally {
            server.close()
            serverThread.join(1_000)
        }
    }

    @Test
    fun m3uRefreshPreservesManualSourcesAndExistingDetectedOptOuts() {
        store.replacePlaylist("epg-refresh", TvPlaylist("EPG", emptyList()))
        store.setEpgSourceStates(
            "epg-refresh",
            listOf(
                TvEpgSourceState("https://guide.example/guides/es-es/old.xml", enabled = false, detected = true),
                TvEpgSourceState("https://manual.example/xmltv", enabled = true, detected = false),
            ),
        )

        val states = store.reconcileM3uEpgSources(
            sourceId = "epg-refresh",
            detectedUrls = listOf(
                "https://guide.example/guides/es-es/old.xml",
                "https://guide.example/guides/es-es/new.xml",
            ),
            recommendedUrls = listOf("https://guide.example/guides/es-es/new.xml"),
        )

        assertEquals(
            listOf(
                TvEpgSourceState("https://guide.example/guides/es-es/old.xml", enabled = false, detected = true),
                TvEpgSourceState("https://guide.example/guides/es-es/new.xml", enabled = true, detected = true),
                TvEpgSourceState("https://manual.example/xmltv", enabled = true, detected = false),
            ),
            states,
        )
        assertEquals(
            listOf("https://guide.example/guides/es-es/new.xml", "https://manual.example/xmltv"),
            store.getPlaylists().first { it.id == "epg-refresh" }.epgUrls,
        )
    }

    @Test
    fun playlistReimportKeepsDisabledDetectedAndManualSourcesWithoutReenablingStaleGuides() {
        val repository = TvPlaylistRepository(store)
        val playlistId = "epg-source-reimport"
        val detected = listOf(
            "https://guide.example/guides/us-en/one.xml",
            "https://guide.example/guides/gb-en/two.xml",
            "https://guide.example/guides/fr-fr/three.xml",
            "https://guide.example/guides/pt-pt/four.xml",
            "https://guide.example/guides/de-de/five.xml",
            "https://guide.example/guides/it-it/six.xml",
        )
        fun content(urls: List<String>) = """#EXTM3U x-tvg-url="${urls.joinToString(",")}" 
#EXTINF:-1 tvg-country="PT",Canal
https://stream.example/live"""

        repository.importM3uReader(
            reader = content(detected).reader().buffered(),
            name = "EPG reimport fixture",
            identitySeed = playlistId,
            playlistIdOverride = playlistId,
            autoImportEpg = false,
        )
        repository.setEpgSourceEnabled(playlistId, detected[3], false)
        val manualUrl = "https://manual.example/custom.xml"
        repository.updateEpgUrls(playlistId, detected + manualUrl)

        val refreshed = repository.importM3uReader(
            reader = content(listOf(detected[3], "https://guide.example/guides/es-es/new.xml")).reader().buffered(),
            name = "EPG reimport fixture",
            identitySeed = playlistId,
            playlistIdOverride = playlistId,
            autoImportEpg = false,
        )

        assertEquals(
            listOf(
                TvEpgSourceState(detected[3], enabled = false, detected = true),
                TvEpgSourceState("https://guide.example/guides/es-es/new.xml", enabled = true, detected = true),
                TvEpgSourceState(manualUrl, enabled = true, detected = false),
            ),
            repository.loadEpgSourceStates(playlistId),
        )
        assertEquals(
            listOf("https://guide.example/guides/es-es/new.xml", manualUrl),
            refreshed.epgUrls,
        )
    }
}
