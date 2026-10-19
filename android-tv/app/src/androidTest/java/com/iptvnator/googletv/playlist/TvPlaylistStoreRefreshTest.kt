package com.iptvnator.googletv.playlist

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.iptvnator.googletv.epg.TvEpgEntry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class TvPlaylistStoreRefreshTest {
    private val databaseName = "iptvnator-refresh-regression-test.db"
    private lateinit var store: TvPlaylistStore
    private lateinit var context: Context

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
    fun refreshPreservesUserStateAndEpg() {
        val playlistId = "fixture"
        val channel = TvChannel("news", "News", "https://old.example/live")
        store.replacePlaylist(
            playlistId,
            TvPlaylist("Original", listOf(channel)),
            sourceUrl = "https://old.example/playlist.m3u",
        )
        val saved = TvSavedItem(
            playlistId = playlistId,
            itemType = TvSavedItemType.CHANNEL,
            itemKey = channel.id,
            title = channel.name,
            uri = channel.url,
            coverUrl = null,
            savedAt = 1L,
            lastPlayedAt = null,
        )
        store.setFavorite(saved, true)
        store.recordPlaybackPosition(saved, positionMs = 12_000L, durationMs = 100_000L)
        store.recordEpisodeProgress(playlistId, seriesId = 7, episodeId = 3, positionMs = 15_000L, durationMs = 100_000L)
        store.setEpgMapping(playlistId, channel.id, "xmltv.news")
        assertTrue(store.setHiddenGroupTitles(playlistId, listOf("News", "Sports")))
        assertTrue(store.setHiddenCategories(playlistId, listOf(TvHiddenCategory("movies", "10"), TvHiddenCategory("series", "20"))))
        store.setEpgUrls(playlistId, listOf("https://guide.one/xmltv", "https://guide.two/xmltv"))
        store.setPrimaryEpgUrl(playlistId, "https://guide.one/xmltv")
        assertEquals(
            listOf(
                TvEpgSourceState("https://guide.one/xmltv", true),
                TvEpgSourceState("https://guide.two/xmltv", true),
            ),
            store.getEpgSourceStates(playlistId),
        )
        assertTrue(store.setEpgSourceEnabled(playlistId, "https://guide.one/xmltv", false))
        assertEquals(listOf("https://guide.two/xmltv"), store.getEpgUrls(playlistId))
        assertEquals(listOf("https://guide.two/xmltv"), store.getPlaylists().single().epgUrls)
        assertEquals(
            listOf(
                TvEpgSourceState("https://guide.one/xmltv", false),
                TvEpgSourceState("https://guide.two/xmltv", true),
            ),
            store.getEpgSourceStates(playlistId),
        )
        store.replaceEpg(playlistId, listOf(TvEpgEntry("news", 1_000L, 2_000L, "Informativo")))

        store.replacePlaylist(
            playlistId,
            TvPlaylist("Refrescada", listOf(channel.copy(name = "News HD", url = "https://new.example/live"))),
            sourceUrl = "https://new.example/playlist.m3u",
        )

        val refreshed = store.getPlaylists().single()
        assertEquals("Refrescada", refreshed.name)
        assertEquals("https://new.example/live", refreshed.channels.single().url)
        assertEquals(1, store.getFavorites().size)
        assertTrue(store.getHistory().single().resumePositionMs > 0L)
        assertEquals(15_000L, store.getEpisodeProgress(playlistId, 7).getValue(3).positionMs)
        assertEquals("xmltv.news", store.getEpgMapping(playlistId, channel.id))
        assertEquals(listOf("News", "Sports"), refreshed.hiddenGroupTitles)
        assertEquals(
            listOf(TvHiddenCategory("movies", "10"), TvHiddenCategory("series", "20")),
            refreshed.hiddenCategories,
        )
        assertEquals(listOf("https://guide.two/xmltv"), refreshed.epgUrls)
        assertEquals(
            listOf(
                TvEpgSourceState("https://guide.one/xmltv", false),
                TvEpgSourceState("https://guide.two/xmltv", true),
            ),
            store.getEpgSourceStates(playlistId),
        )
        assertEquals("Informativo", store.getEpg(playlistId, "news", 0L, 3_000L).single().title)
    }

    @Test
    fun playbackHistoryBeyondLatestHundredKeepsOlderFavoritesAndWatchedItems() {
        val playlistId = "unbounded-history"
        store.replacePlaylist(playlistId, TvPlaylist("History", emptyList()))
        val oldest = TvSavedItem(
            playlistId = playlistId,
            itemType = TvSavedItemType.CHANNEL,
            itemKey = "channel-001",
            title = "History item 001",
            uri = "https://example.invalid/001.m3u8",
            coverUrl = null,
            savedAt = 1L,
            lastPlayedAt = null,
        )
        store.setFavorite(oldest, true)
        store.setWatched(oldest, true)

        (1..125).forEach { index ->
            val item = if (index == 1) oldest else oldest.copy(
                itemKey = "channel-${index.toString().padStart(3, '0')}",
                title = "History item ${index.toString().padStart(3, '0')}",
                uri = "https://example.invalid/${index.toString().padStart(3, '0')}.m3u8",
                savedAt = index.toLong(),
                lastPlayedAt = null,
                isFavorite = false,
                isWatched = false,
            )
            store.recordPlayback(item)
            Thread.sleep(2)
        }

        val history = store.getHistory()
        assertEquals("Playback history must not evict entries after 100 distinct items", 125, history.size)
        assertEquals("The oldest item should remain at the end of chronological history", oldest.itemKey, history.last().itemKey)
        assertEquals("The oldest item should keep its favorite marker", listOf(oldest.itemKey), store.getFavorites().map { it.itemKey })
        assertEquals("The oldest item should keep its watched marker", listOf(oldest.itemKey), store.getWatched().map { it.itemKey })
    }

    @Test
    fun favoritesResolveCurrentM3uGroupsAndXtreamCategoriesFromTheirCatalogues() {
        val channel = TvChannel("news", "News", "https://m3u.example/live", group = "Noticias")
        store.replacePlaylist("m3u", TvPlaylist("M3U", listOf(channel)))
        store.setFavorite(
            TvSavedItem("m3u", TvSavedItemType.CHANNEL, channel.id, channel.name, channel.url, null, 1L, null),
            true,
        )
        val m3uVodId = channel.url.hashCode().toString()
        store.setFavorite(
            TvSavedItem("m3u", TvSavedItemType.VOD, m3uVodId, "M3U film", channel.url, null, 2L, null),
            true,
        )

        val vod = TvVodItem(7, "Xtream film", "https://xtream.example/movie", "Cine", null, "mp4", null)
        val series = TvSeriesItem(8, "Xtream series", "Series", null, null, null)
        store.replaceXtreamCatalog(
            id = "xtream",
            playlist = TvPlaylist("Xtream", emptyList()),
            vod = listOf(vod),
            series = listOf(series),
            sourceUrl = "https://xtream.example",
        )
        store.setFavorite(
            TvSavedItem("xtream", TvSavedItemType.VOD, "7", vod.name, vod.url, null, 3L, null),
            true,
        )
        store.setFavorite(
            TvSavedItem("xtream", TvSavedItemType.SERIES, "8", series.name, "", null, 4L, null),
            true,
        )

        val categories = store.getFavorites().associate { "${it.playlistId}:${it.itemKey}" to it.categoryId }
        assertEquals("Noticias", categories["m3u:news"])
        assertEquals("Noticias", categories["m3u:$m3uVodId"])
        assertEquals("Cine", categories["xtream:7"])
        assertEquals("Series", categories["xtream:8"])
    }

    @Test
    fun clearHistoryCanBeScopedAndPreservesFavoritesAndWatchedItems() {
        val first = TvSavedItem("first", TvSavedItemType.CHANNEL, "one", "One", "https://example/one", null, 1L, null)
        val second = TvSavedItem("second", TvSavedItemType.CHANNEL, "two", "Two", "https://example/two", null, 2L, null)
        store.replacePlaylist("first", TvPlaylist("First", listOf(TvChannel("one", "One", first.uri))))
        store.replacePlaylist("second", TvPlaylist("Second", listOf(TvChannel("two", "Two", second.uri))))
        store.recordPlaybackPosition(first, 15_000L, 60_000L)
        store.recordPlaybackPosition(second, 25_000L, 60_000L)
        store.setFavorite(first, true)
        store.setWatched(first, true)

        store.clearHistory("first")

        assertEquals(listOf("second"), store.getHistory().map { it.playlistId })
        assertEquals(listOf("first"), store.getFavorites().map { it.playlistId })
        assertEquals(listOf("first"), store.getWatched().map { it.playlistId })
        assertEquals(0L, store.getFavorites().single().resumePositionMs)

        store.clearHistory()
        assertTrue(store.getHistory().isEmpty())
        assertEquals(listOf("first"), store.getFavorites().map { it.playlistId })
        assertEquals(listOf("first"), store.getWatched().map { it.playlistId })
    }

    @Test
    fun clearFavoritesIsScopedAndPreservesHistoryAndWatchedState() {
        store.replacePlaylist(
            "first",
            TvPlaylist(
                "First",
                listOf(
                    TvChannel("played", "Played", "https://example/played"),
                    TvChannel("watched", "Watched", "https://example/watched"),
                ),
            ),
        )
        store.replacePlaylist("second", TvPlaylist("Second", listOf(TvChannel("other", "Other", "https://example/other"))))
        val played = TvSavedItem("first", TvSavedItemType.CHANNEL, "played", "Played", "https://example/played", null, 1L, null)
        val watched = TvSavedItem("first", TvSavedItemType.CHANNEL, "watched", "Watched", "https://example/watched", null, 2L, null)
        val otherPlaylist = TvSavedItem("second", TvSavedItemType.CHANNEL, "other", "Other", "https://example/other", null, 3L, null)
        store.setFavorite(played, true)
        store.setFavorite(watched, true)
        store.setFavorite(otherPlaylist, true)
        store.recordPlayback(played)
        store.setWatched(watched, true)

        assertEquals(2, store.clearFavorites(TvSavedItemType.CHANNEL, playlistId = "first"))

        assertEquals(listOf("other"), store.getFavorites().map { it.itemKey })
        assertEquals(listOf("played"), store.getHistory().map { it.itemKey })
        assertEquals(listOf("watched"), store.getWatched().map { it.itemKey })
    }

    @Test
    fun manualFavoriteOrderIsScopedAndSurvivesBackupRestore() {
        val first = TvSavedItem("first", TvSavedItemType.CHANNEL, "one", "One", "https://example/one", null, 1L, null, isFavorite = true)
        val second = TvSavedItem("first", TvSavedItemType.CHANNEL, "two", "Two", "https://example/two", null, 1L, null, isFavorite = true)
        val third = TvSavedItem("second", TvSavedItemType.CHANNEL, "three", "Three", "https://example/three", null, 1L, null, isFavorite = true)
        store.replacePlaylist("first", TvPlaylist("First", listOf(
            TvChannel("one", "One", first.uri),
            TvChannel("two", "Two", second.uri),
        )))
        store.replacePlaylist("second", TvPlaylist("Second", listOf(TvChannel("three", "Three", third.uri))))
        val firstEpgSources = listOf(
            TvEpgSourceState("https://detected.example/xmltv", enabled = false, detected = true),
            TvEpgSourceState("https://manual.example/xmltv", enabled = true, detected = false),
        )
        store.setEpgSourceStates("first", firstEpgSources)
        listOf(first, second, third).forEach { store.setFavorite(it, true) }

        store.updateFavoriteOrder(listOf(third, first, second))
        store.updateFavoriteOrder(listOf(second, first), playlistId = "first")

        val ordered = store.getFavorites().associateBy { it.itemKey }
        assertEquals(1, ordered.getValue("one").globalFavoriteOrder)
        assertEquals(2, ordered.getValue("two").globalFavoriteOrder)
        assertEquals(0, ordered.getValue("three").globalFavoriteOrder)
        assertEquals(1, ordered.getValue("one").playlistFavoriteOrder)
        assertEquals(0, ordered.getValue("two").playlistFavoriteOrder)
        assertNull(ordered.getValue("three").playlistFavoriteOrder)

        val playlists = store.getPlaylists()
        val backup = TvPlaylistBackup.export(
            playlists = playlists,
            credentials = null,
            savedItems = store.getFavorites(),
            epgSourceStates = playlists.associate { it.id to store.getEpgSourceStates(it.id) },
            sourceOrder = listOf("second", "first"),
        )
        val restoredPositions = mutableListOf<Pair<String, Int>>()
        val summary = TvPlaylistBackup.import(
            backup,
            TvPlaylistRepository(store),
            onSourcePosition = { id, position -> restoredPositions += id to position },
        )
        assertEquals(2, summary.imported)
        assertEquals(0, summary.failed)
        val restoredOrder = TvPlaylistBackup.mergeSourceOrder(emptyList(), restoredPositions)
        assertEquals(
            listOf("Second", "First"),
            restoredOrder.map { id -> store.getPlaylists().first { it.id == id }.name },
        )
        val restored = store.getFavorites()
            .filter { it.playlistId in summary.importedPlaylistIds }
            .associateBy { it.itemKey }
        assertEquals(1, restored.getValue("one").globalFavoriteOrder)
        assertEquals(2, restored.getValue("two").globalFavoriteOrder)
        assertEquals(1, restored.getValue("one").playlistFavoriteOrder)
        assertEquals(0, restored.getValue("two").playlistFavoriteOrder)
        val restoredPlaylistWithEpg = summary.importedPlaylistIds.first { store.getEpgSourceStates(it).isNotEmpty() }
        assertEquals(firstEpgSources, store.getEpgSourceStates(restoredPlaylistWithEpg))
    }

    @Test
    fun importsLocalXmltvFileThroughAndroidResolver() {
        val playlistId = "local-epg"
        store.replacePlaylist(playlistId, TvPlaylist("Local", listOf(TvChannel("news", "News", "https://example/news"))))
        val xml = """<?xml version="1.0" encoding="UTF-8"?>
            <tv>
              <channel id="news"><display-name>News</display-name></channel>
              <programme start="20260101080000 +0000" stop="20260101090000 +0000" channel="news">
                <title>Morning news</title>
              </programme>
            </tv>
        """.trimIndent()
        val file = File(context.filesDir, "local-test.xml")
        file.writeText(xml)
        try {
            val repository = TvPlaylistRepository(store, contentResolver = context.contentResolver)
            assertEquals(1, repository.importEpg(playlistId, file.toURI().toString()))
            assertEquals("Morning news", store.getEpg(playlistId, "news", 0L, Long.MAX_VALUE).single().title)
        } finally {
            file.delete()
        }
    }

    @Test
    fun importsLargeXmltvInBatchesAndKeepsOldGuideWhenParsingFails() {
        val playlistId = "large-epg"
        store.replacePlaylist(playlistId, TvPlaylist("Large EPG", listOf(TvChannel("news", "News", "https://example/news"))))
        store.replaceEpg(playlistId, listOf(TvEpgEntry("news", 1L, 2L, "Previous guide")))
        val xml = buildString {
            append("<tv>")
            repeat(2_505) { index ->
                val start = LocalDateTime.of(2026, 1, 1, 0, 0).plusHours(index.toLong())
                val formatter = DateTimeFormatter.ofPattern("yyyyMMddHHmmss")
                append("<programme channel=\"news\" start=\"${start.format(formatter)} +0000\" stop=\"${start.plusMinutes(30).format(formatter)} +0000\"><title>Show $index</title></programme>")
            }
            append("</tv>")
        }
        val file = File(context.filesDir, "large-test.xml")
        file.writeText(xml)
        val broken = File(context.filesDir, "broken-test.xml")
        broken.writeText("<tv><programme channel=\"news\"><title>Truncated")
        try {
            val repository = TvPlaylistRepository(store, contentResolver = context.contentResolver)
            assertEquals(2_505, repository.importEpg(playlistId, file.toURI().toString()))
            val imported = store.getEpg(playlistId, "news", 0L, Long.MAX_VALUE)
            assertEquals(2_505, imported.size)
            assertEquals("Show 0", imported.first().title)
            assertEquals("Show 2504", imported.last().title)

            org.junit.Assert.assertThrows(Exception::class.java) {
                repository.importEpg(playlistId, broken.toURI().toString())
            }
            assertEquals("Show 0", store.getEpg(playlistId, "news", 0L, Long.MAX_VALUE).first().title)
        } finally {
            file.delete()
            broken.delete()
        }
    }

    @Test
    fun importsGzippedXmltvAfterRedirectToCompressedFile() {
        val playlistId = "redirected-gzip-epg"
        store.replacePlaylist(playlistId, TvPlaylist("Redirected EPG", listOf(TvChannel("news", "News", "https://example/news"))))
        val xml = """<?xml version="1.0" encoding="UTF-8"?>
            <tv><programme start="20260101080000 +0000" stop="20260101090000 +0000" channel="news">
              <title>Redirected morning news</title>
            </programme></tv>
        """.trimIndent().toByteArray(Charsets.UTF_8)
        val gzippedXml = ByteArrayOutputStream().also { output ->
            GZIPOutputStream(output).use { it.write(xml) }
        }.toByteArray()
        val server = ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-gzip-epg-fixture", isDaemon = true) {
            server.accept().use { socket ->
                respondWithHttp(socket, "302 Found", listOf("Location: /guide.xml.gz"), byteArrayOf())
            }
            server.accept().use { socket ->
                respondWithHttp(socket, "200 OK", listOf("Content-Type: application/gzip"), gzippedXml)
            }
        }
        try {
            val url = "http://127.0.0.1:${server.localPort}/guide"
            val repository = TvPlaylistRepository(store, contentResolver = context.contentResolver)
            assertEquals(1, repository.importEpg(playlistId, url))
            assertEquals(
                "Redirected morning news",
                store.getEpg(playlistId, "news", 0L, Long.MAX_VALUE).single().title,
            )
        } finally {
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun remoteM3uImportStreamsChannelsAndPreservesPlaylistMetadata() {
        val body = """#EXTM3U
#EXTINF:-1 tvg-id="first" group-title="News",First channel
#EXTVLCOPT:http-user-agent=ChannelAgent/1.0
#EXTVLCOPT:http-referrer=https://channel.example/watch
https://stream.example/first.m3u8
#EXTINF:-1 radio="true",Second channel
https://stream.example/second.aac""".toByteArray(Charsets.UTF_8)
        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val serverThread = thread(name = "iptvnator-m3u-import-fixture", isDaemon = true) {
            server.accept().use { socket -> respondWithM3u(socket, body) }
        }
        try {
            val sourceUrl = "http://127.0.0.1:${server.localPort}/playlist.m3u"
            val imported = TvPlaylistRepository(store).importRemote(
                TvPlaylistSource(
                    sourceUrl,
                    "Streaming fixture",
                    userAgent = "PlaylistAgent/1.0",
                    referrer = "https://provider.example/watch",
                    origin = "https://provider.example",
                ),
            )
            val channels = store.getChannelPage(imported.id, 0, 10)

            assertEquals("Streaming fixture", imported.name)
            assertEquals(sourceUrl, imported.sourceUrl)
            assertEquals("PlaylistAgent/1.0", imported.sourceUserAgent)
            assertEquals("https://provider.example/watch", imported.sourceReferrer)
            assertEquals("https://provider.example", imported.sourceOrigin)
            assertEquals(listOf("First channel", "Second channel"), channels.map { it.name })
            assertEquals(
                listOf("https://stream.example/first.m3u8", "https://stream.example/second.aac"),
                channels.map { it.url },
            )
            assertEquals("ChannelAgent/1.0", channels.first().userAgent)
            assertEquals("PlaylistAgent/1.0", channels.last().userAgent)
            assertEquals("https://channel.example/watch", channels.first().headers["Referer"])
            assertEquals("https://provider.example/watch", channels.last().headers["Referer"])
            assertEquals("https://provider.example", channels.first().headers["Origin"])
            assertEquals("https://provider.example", channels.last().headers["Origin"])
            assertEquals("News", channels.first().group)
            assertTrue(channels.last().radio)
        } finally {
            server.close()
            serverThread.join(1_000L)
        }
    }

    @Test
    fun stalkerCatalogReplacementRollsBackLiveRowsWhenVodInsertFails() {
        val playlistId = "stalker-atomic-refresh"
        store.replaceXtreamCatalog(
            id = playlistId,
            playlist = TvPlaylist("Original portal", listOf(TvChannel("old-live", "Old live", "stalker://old/live"))),
            vod = listOf(TvVodItem(1, "Old movie", "stalker://old/vod/1", null, null, "", null)),
            series = listOf(TvSeriesItem(2, "Old series", null, null, null, null)),
            sourceUrl = "https://old.example/portal",
        )
        store.writableDatabase.execSQL(
            """CREATE TRIGGER fail_fixture_vod_insert BEFORE INSERT ON vod
                WHEN NEW.name = 'Broken fixture movie'
                BEGIN SELECT RAISE(ABORT, 'fixture insert failure'); END""".trimIndent(),
        )

        val failure = runCatching {
            store.replaceXtreamCatalog(
                id = playlistId,
                playlist = TvPlaylist("Partial replacement", listOf(TvChannel("new-live", "New live", "stalker://new/live"))),
                vod = listOf(TvVodItem(3, "Broken fixture movie", "stalker://new/vod/3", null, null, "", null)),
                series = listOf(TvSeriesItem(4, "New series", null, null, null, null)),
                sourceUrl = "https://new.example/portal",
            )
        }.exceptionOrNull()

        assertTrue("A failed catalogue write should abort the replacement", failure is android.database.sqlite.SQLiteConstraintException)
        assertEquals("Original portal", store.getPlaylists().single().name)
        assertEquals("Old live", store.getChannelPage(playlistId, offset = 0, limit = 10).single().name)
        assertEquals("Old movie", store.getVodPage(playlistId, offset = 0, limit = 10).single().name)
        assertEquals("Old series", store.getSeriesPage(playlistId, offset = 0, limit = 10).single().name)
        assertEquals(TvPlaylistCounts(channels = 1, vod = 1, series = 1), store.getPlaylistCounts(playlistId))
    }

    private fun respondWithM3u(socket: Socket, body: ByteArray) {
        respondWithHttp(socket, "200 OK", listOf("Content-Type: audio/x-mpegurl; charset=utf-8"), body)
    }

    private fun respondWithHttp(socket: Socket, status: String, headers: List<String>, body: ByteArray) {
        socket.soTimeout = 5_000
        val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.US_ASCII))
        while (reader.readLine()?.isNotEmpty() == true) Unit
        val output = socket.getOutputStream()
        output.write(
            ("HTTP/1.1 $status\r\n" +
                headers.joinToString(separator = "\r\n", postfix = "\r\n") +
                "Content-Length: ${body.size}\r\n" +
                "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
        )
        output.write(body)
        output.flush()
    }

    @Test
    fun importsOriginalDesktopBackupAndRestoresM3uUserState() {
        val backup = """
            {
              "kind": "iptvnator-playlist-backup",
              "version": 1,
              "exportedAt": "2026-09-22T00:00:00.000Z",
              "includeSecrets": true,
              "playlists": [{
                "portalType": "m3u",
                "exportedId": "desktop-m3u",
                "title": "Desktop fixture",
                "autoRefresh": true,
                "source": {
                  "kind": "text",
                  "rawM3u": "#EXTM3U\n#EXTINF:-1 tvg-id=\"news\",News\n#EXTVLCOPT:http-referrer=https://channel.example/watch\nhttps://fixture.example/news.m3u8\n",
                  "url": "https://fixture.example/playlist.m3u",
                  "userAgent": "DesktopPlaylist/1.0",
                  "referrer": "https://provider.example/watch",
                  "origin": "https://provider.example"
                },
                "userState": {
                  "favorites": ["news"],
                  "recentlyViewed": [{
                    "source": "m3u",
                    "id": "news",
                    "url": "https://fixture.example/news.m3u8",
                    "title": "News",
                    "category_id": "live",
                    "added_at": "2026-09-22T00:00:00.000Z"
                  }],
                  "hiddenGroupTitles": []
                }
              }]
            }
        """.trimIndent()

        val repository = TvPlaylistRepository(store)
        val summary = TvPlaylistBackup.import(backup, repository)

        assertEquals(1, summary.imported)
        assertEquals(0, summary.failed)
        val restoredPlaylist = store.getPlaylists().single()
        assertEquals("https://provider.example/watch", restoredPlaylist.sourceReferrer)
        assertEquals("https://provider.example", restoredPlaylist.sourceOrigin)
        assertEquals("DesktopPlaylist/1.0", restoredPlaylist.sourceUserAgent)
        val restoredChannel = restoredPlaylist.channels.single()
        assertEquals("https://channel.example/watch", restoredChannel.headers["Referer"])
        assertEquals("https://provider.example", restoredChannel.headers["Origin"])
        assertEquals("DesktopPlaylist/1.0", restoredChannel.userAgent)
        assertEquals(1, store.getFavorites().size)
        assertEquals("News", store.getFavorites().single().title)
        assertEquals(1, store.getHistory().size)
        assertEquals("https://fixture.example/news.m3u8", store.getHistory().single().uri)

        val exported = org.json.JSONObject(
            TvPlaylistBackup.export(
                playlists = repository.loadStoredForBackup(),
                credentials = null,
                savedItems = TvPlaylistBackup.mergeSavedItems(store.getFavorites(), store.getHistory()),
            ),
        ).getJSONArray("playlists").getJSONObject(0).getJSONObject("source")
        assertEquals("https://provider.example/watch", exported.getString("referrer"))
        assertEquals("https://provider.example", exported.getString("origin"))
        assertEquals("DesktopPlaylist/1.0", exported.getString("userAgent"))
    }

    @Test
    fun importsLegacyAndroidTvBackupAfterSwitchingToSharedManifest() {
        val backup = """
            {
              "kind":"iptvnator-android-tv-playlist-backup",
              "version":1,
              "sources":[{
                "type":"m3u",
                "title":"Legacy TV backup",
                "content":"#EXTM3U\n#EXTINF:-1,Legacy channel\nhttps://fixture.example/live.m3u8\n"
              }]
            }
        """.trimIndent()

        val summary = TvPlaylistBackup.import(backup, TvPlaylistRepository(store))

        assertEquals(1, summary.imported)
        assertEquals(0, summary.failed)
        assertEquals("Legacy channel", store.getPlaylists().single().channels.single().name)
    }

    @Test
    fun catalogPagesAndCategoriesReadBeyondStartupWindow() {
        val playlistId = "large-catalog"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Large catalog", emptyList()),
            sourceUrl = "https://provider.example/playlist",
        )
        try {
            writer.addChannel(
                TvChannel(
                    id = "xtream:99",
                    name = "Live 99",
                    url = "https://provider.example/live/99.m3u8",
                    group = "News",
                    logoUrl = "https://provider.example/logo.png",
                    tvgId = "news.99",
                    tvArchive = true,
                    tvArchiveDurationMinutes = 48,
                ),
            )
            repeat(3) { index ->
                writer.addVod(
                    TvVodItem(
                        id = index + 1,
                        name = "Movie ${index + 1}",
                        url = "https://provider.example/movie/${index + 1}",
                        categoryId = if (index == 2) "Drama" else "Comedy",
                        providerCategoryId = if (index == 2) "20" else "10",
                        coverUrl = null,
                        extension = "mp4",
                        rating = null,
                        addedAtMs = when (index) {
                            0 -> 1_000L
                            1 -> 3_000L
                            else -> 2_000L
                        },
                    ),
                )
                writer.addSeries(
                    TvSeriesItem(
                        id = index + 1,
                        name = "Series ${index + 1}",
                        categoryId = if (index == 2) "Drama" else "Comedy",
                        providerCategoryId = if (index == 2) "30" else "11",
                        coverUrl = null,
                        plot = null,
                        rating = null,
                        addedAtMs = when (index) {
                            0 -> 1_000L
                            1 -> 3_000L
                            else -> 2_000L
                        },
                    ),
                )
            }
            writer.finish()
        } finally {
            writer.close()
        }

        assertEquals("Live 99", store.getPlaylists().single().channels.single().name)
        assertEquals(1, store.getPlaylistCounts(playlistId).channels)
        assertEquals(listOf("Comedy", "Drama"), store.getVodCategories(playlistId))
        assertEquals(listOf("Comedy", "Drama"), store.getSeriesCategories(playlistId))
        assertEquals(
            listOf(TvCatalogCategoryMapping("Comedy", "10"), TvCatalogCategoryMapping("Drama", "20")),
            store.getVodCategoryMappings(playlistId),
        )
        assertEquals(
            listOf(TvCatalogCategoryMapping("Comedy", "11"), TvCatalogCategoryMapping("Drama", "30")),
            store.getSeriesCategoryMappings(playlistId),
        )
        assertEquals("Movie 3", store.getVodCategoryPage(playlistId, "Drama", 0, 1).single().name)
        assertEquals("Series 3", store.getSeriesCategoryPage(playlistId, "Drama", 0, 1).single().name)
        assertEquals("Movie 3", store.getVodPage(playlistId, 2, 1).single().name)
        assertEquals("Series 3", store.getSeriesPage(playlistId, 2, 1).single().name)
        assertEquals(listOf("Movie 2", "Movie 3"), store.getRecentVodPage(playlistId, 2).map { it.name })
        assertEquals(listOf("Series 2", "Series 3"), store.getRecentSeriesPage(playlistId, 2).map { it.name })
    }

    @Test
    fun vodAndSeriesSearchContinuePastFirstTwoHundredMatches() {
        val playlistId = "paged-search"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Paged search", emptyList()),
            sourceUrl = "https://provider.example/playlist",
        )
        try {
            repeat(405) { index ->
                val id = index + 1
                writer.addVod(
                    TvVodItem(
                        id = id,
                        name = "Searchable Movie ${id.toString().padStart(3, '0')}",
                        url = "https://provider.example/movie/$id",
                        categoryId = if (id % 2 == 0) "Drama" else "Comedy",
                        providerCategoryId = "10",
                        coverUrl = null,
                        extension = "mp4",
                        rating = null,
                        addedAtMs = null,
                    ),
                )
                writer.addSeries(
                    TvSeriesItem(
                        id = id,
                        name = "Searchable Series ${id.toString().padStart(3, '0')}",
                        categoryId = if (id % 2 == 0) "Drama" else "Comedy",
                        providerCategoryId = "20",
                        coverUrl = null,
                        plot = null,
                        rating = null,
                        addedAtMs = null,
                    ),
                )
            }
            writer.finish()
        } finally {
            writer.close()
        }

        val vod = (0..2).flatMap { page -> store.searchVod(playlistId, "Searchable", 201, page * 200).take(200) }
        val series = (0..2).flatMap { page -> store.searchSeries(playlistId, "Searchable", 201, page * 200).take(200) }
        assertEquals(405, vod.size)
        assertEquals(405, vod.map { it.id }.distinct().size)
        assertEquals(405, series.size)
        assertEquals(405, series.map { it.id }.distinct().size)
        assertEquals("Searchable Movie 401", vod[400].name)
        assertEquals("Searchable Series 401", series[400].name)
        assertEquals(202, store.searchVod(playlistId, "Searchable", 201, 0, "Drama").take(200).size +
            store.searchVod(playlistId, "Searchable", 201, 200, "Drama").take(200).size)
        assertEquals(202, store.searchSeries(playlistId, "Searchable", 201, 0, "Drama").take(200).size +
            store.searchSeries(playlistId, "Searchable", 201, 200, "Drama").take(200).size)
    }

    @Test
    fun liveStartupWindowCanBeExpandedWithoutMaterialisingTheWholeSource() {
        val playlistId = "large-live"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Large live", emptyList()),
            sourceUrl = "https://provider.example/live",
        )
        try {
            repeat(501) { index ->
                writer.addChannel(
                    TvChannel(
                        id = "xtream:$index",
                        name = "Channel ${index.toString().padStart(3, '0')}",
                        url = "https://provider.example/live/$index.m3u8",
                    ),
                )
            }
            writer.finish()
        } finally {
            writer.close()
        }

        val startup = store.getPlaylists(catalogLimit = 500).single()
        assertEquals(500, startup.channels.size)
        assertEquals(501, store.getPlaylistCounts(playlistId).channels)
        assertEquals("Channel 500", store.getChannelPage(playlistId, 500, 1).single().name)
        assertEquals("Channel 500", store.searchChannels(playlistId, "500").single().name)
        assertEquals(501, store.countMatchingChannels(playlistId, "Channel", radioOnly = false))
        val searchWindow = store.searchChannels(playlistId, "Channel", limit = 201, radioOnly = false)
        assertEquals(201, searchWindow.size) // 200 results plus the TV picker’s has-more sentinel.
        assertEquals("Channel 200", searchWindow[200].name)
        assertEquals("Channel 200", store.searchChannels(playlistId, "Channel", limit = 201, radioOnly = false, offset = 200).first().name)
        assertEquals("Channel 000", store.searchChannels(playlistId, "Channel", limit = 1, radioOnly = false).single().name)
        assertEquals("Channel 001", store.searchChannels(playlistId, "Channel", limit = 1, radioOnly = false, offset = 1).single().name)
        val searchPlan = store.readableDatabase.rawQuery(
            """EXPLAIN QUERY PLAN SELECT id FROM channels
                WHERE playlist_id = ? AND radio = 0
                  AND (name LIKE ? COLLATE NOCASE OR group_name LIKE ? COLLATE NOCASE)
                ORDER BY source_order, id LIMIT 101""".trimIndent(),
            arrayOf(playlistId, "%500%", "%500%"),
        ).use { rows -> buildList { while (rows.moveToNext()) add(rows.getString(3)) }.joinToString(" ") }
        assertTrue("Channel search should use the stable-order index: $searchPlan", searchPlan.contains("channels_source_order_idx"))
        assertTrue("Channel search should not allocate a temporary sorter: $searchPlan", !searchPlan.contains("TEMP B-TREE"))
        assertEquals(501, TvPlaylistRepository(store).loadStoredForBackup().single().channels.size)
        assertEquals("Channel 001", store.getAdjacentChannel(playlistId, "xtream:0", 1)?.name)
        assertEquals("Channel 500", store.getChannelAtPosition(playlistId, 500)?.name)
    }

    @Test
    fun channelGroupCountsStayCompleteAndSeparateRadio() {
        val playlistId = "groups"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Groups", emptyList()),
            sourceUrl = "https://provider.example/groups",
        )
        try {
            writer.addChannel(TvChannel("xtream:1", "News TV", "https://provider/live/1", group = "News"))
            writer.addChannel(TvChannel("xtream:2", "News Radio", "https://provider/live/2", group = "News", radio = true))
            writer.addChannel(TvChannel("xtream:3", "Sports TV", "https://provider/live/3", group = "Documentaries"))
            writer.finish()
        } finally {
            writer.close()
        }

        assertEquals(mapOf("Documentaries" to 1, "News" to 1), store.getChannelGroupCounts(playlistId, radioOnly = false))
        assertEquals(mapOf("News" to 1), store.getChannelGroupCounts(playlistId, radioOnly = true))
        assertEquals(listOf("News Radio"), store.getChannelPage(playlistId, 0, 10, radioOnly = true).map { it.name })
        assertEquals(listOf("News TV", "Sports TV"), store.getChannelPage(playlistId, 0, 10, radioOnly = false).map { it.name })
        assertEquals(listOf("News Radio"), store.searchChannels(playlistId, "News", radioOnly = true).map { it.name })
        assertEquals(listOf("News TV"), store.searchChannels(playlistId, "News", radioOnly = false).map { it.name })
        assertEquals(listOf("Sports TV"), store.searchChannels(playlistId, "Documentaries", radioOnly = false).map { it.name })
        assertEquals(listOf("News TV"), store.getChannelsByIds(playlistId, listOf("xtream:1", "xtream:2"), radioOnly = false).map { it.name })
    }

    @Test
    fun channelGroupCountsPreserveFirstProviderAppearanceForServerSorting() {
        val playlistId = "provider-group-order"
        store.replacePlaylist(
            playlistId,
            TvPlaylist(
                "Provider group order",
                listOf(
                    TvChannel("z", "First", "https://provider/live/1", group = "Zulu"),
                    TvChannel("two", "Second", "https://provider/live/2", group = "Group 2"),
                    TvChannel("alpha", "Third", "https://provider/live/3", group = "Alpha"),
                    TvChannel("ten", "Fourth", "https://provider/live/4", group = "Group 10"),
                    TvChannel("z-again", "Fifth", "https://provider/live/5", group = "Zulu"),
                ),
            ),
        )

        assertEquals(
            listOf("Zulu", "Group 2", "Alpha", "Group 10"),
            store.getChannelGroupCounts(playlistId).keys.toList(),
        )
    }

    @Test
    fun channelGroupsNormalizeWhitespaceAndCaseWithoutLosingIndexedPaging() {
        val playlistId = "normalized-groups"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Normalized groups", emptyList()),
            sourceUrl = "https://provider.example/normalized-groups",
        )
        try {
            writer.addChannel(TvChannel("xtream:1", "News TV", "https://provider/live/1", group = " Noticias "))
            writer.addChannel(TvChannel("xtream:2", "News HD", "https://provider/live/2", group = "NOTICIAS"))
            writer.addChannel(TvChannel("xtream:3", "Sports TV", "https://provider/live/3", group = "Deportes"))
            writer.finish()
        } finally {
            writer.close()
        }

        assertEquals(mapOf("Deportes" to 1, "Noticias" to 2), store.getChannelGroupCounts(playlistId))
        assertEquals(
            listOf("News TV", "News HD"),
            store.getChannelGroupPage(playlistId, " Noticias ", 0, 10, radioOnly = false).map { it.name },
        )
        val pagePlan = store.readableDatabase.rawQuery(
            "EXPLAIN QUERY PLAN SELECT id FROM channels WHERE playlist_id = ? AND radio = 0 " +
                "AND TRIM(group_name) COLLATE NOCASE = ? ORDER BY source_order, id LIMIT 10",
            arrayOf(playlistId, "Noticias"),
        ).use { rows -> buildList { while (rows.moveToNext()) add(rows.getString(3)) }.joinToString(" ") }
        assertTrue("Normalized group pages should use the expression index: $pagePlan", pagePlan.contains("channels_group_page_idx"))
        assertTrue("Normalized group pages should not allocate a temporary sorter: $pagePlan", !pagePlan.contains("TEMP B-TREE"))
    }

    @Test
    fun nameSortedLiveAndGroupPagesStayStableAcrossBoundaries() {
        val playlistId = "name-sorted-pages"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Name sorted pages", emptyList()),
            sourceUrl = "https://provider.example/name-sorted-pages",
        )
        try {
            repeat(505) { index ->
                val channelNumber = 504 - index
                writer.addChannel(
                    TvChannel(
                        id = "xtream:$index",
                        name = "Channel ${channelNumber.toString().padStart(3, '0')}",
                        url = "https://provider/live/$index",
                        group = "News",
                    ),
                )
            }
            writer.addChannel(TvChannel("xtream:radio", "A Radio", "https://provider/radio", group = "News", radio = true))
            writer.finish()
        } finally {
            writer.close()
        }

        assertEquals("Channel 504", store.getChannelPage(playlistId, 0, 1, radioOnly = false).single().name)
        val ascendingHead = store.getChannelPage(playlistId, 0, 2, radioOnly = false, sortByName = true)
        val ascendingTail = store.getChannelPage(playlistId, 500, 5, radioOnly = false, sortByName = true)
        assertEquals(listOf("Channel 000", "Channel 001"), ascendingHead.map { it.name })
        assertEquals(listOf("Channel 500", "Channel 501", "Channel 502", "Channel 503", "Channel 504"), ascendingTail.map { it.name })
        assertEquals(
            listOf("Channel 504", "Channel 503"),
            store.getChannelPage(playlistId, 0, 2, radioOnly = false, sortByName = true, descending = true).map { it.name },
        )

        val groupHead = store.getChannelGroupPage(playlistId, "News", 0, 2, radioOnly = false, sortByName = true)
        val groupTail = store.getChannelGroupPage(playlistId, "News", 500, 5, radioOnly = false, sortByName = true)
        assertEquals(ascendingHead.map { it.name }, groupHead.map { it.name })
        assertEquals(ascendingTail.map { it.name }, groupTail.map { it.name })
        assertEquals(
            listOf("Channel 000", "Channel 001"),
            store.searchChannels(playlistId, "Channel", 2, radioOnly = false, sortByName = true).map { it.name },
        )

        val groupPlan = store.readableDatabase.rawQuery(
            "EXPLAIN QUERY PLAN SELECT id FROM channels WHERE playlist_id = ? AND radio = 0 " +
                "AND TRIM(group_name) COLLATE NOCASE = ? ORDER BY name COLLATE NOCASE, id LIMIT 2",
            arrayOf(playlistId, "News"),
        ).use { rows -> buildList { while (rows.moveToNext()) add(rows.getString(3)) }.joinToString(" ") }
        assertTrue("Name-sorted group pages should use their index: $groupPlan", groupPlan.contains("channels_group_name_page_idx"))
        assertTrue("Name-sorted group pages should not allocate a temporary sorter: $groupPlan", !groupPlan.contains("TEMP B-TREE"))
    }

    @Test
    fun epgSnapshotBatchesLargePagesAndKeepsIdentifierFallbackAndCatchupWindow() {
        val playlistId = "batched-epg"
        val now = 2_000_000_000_000L
        val channels = List(205) { index ->
            TvChannel(
                id = "channel-$index",
                name = "Channel name $index",
                url = "https://provider.example/live/$index",
                tvgId = "guide-id-$index",
                tvgName = "Guide name $index",
                catchupDays = if (index == 0) 2 else 0,
            )
        }
        store.replacePlaylist(playlistId, TvPlaylist("Batched EPG", channels))
        store.setEpgMapping(playlistId, "channel-0", "manual-guide-id")
        store.mergeEpg(
            playlistId,
            listOf(
                TvEpgEntry("manual-guide-id", now - 36 * 60 * 60 * 1_000L, now - 35 * 60 * 60 * 1_000L, "Mapped archive"),
                TvEpgEntry("channel-0", now - 60 * 60 * 1_000L, now - 30 * 60 * 1_000L, "Local id fallback"),
                TvEpgEntry("guide-id-0", now, now + 30 * 60 * 1_000L, "TVG id fallback"),
                TvEpgEntry("Guide name 0", now + 30 * 60 * 1_000L, now + 60 * 60 * 1_000L, "TVG name fallback"),
                TvEpgEntry("channel-0", now - 80 * 60 * 60 * 1_000L, now - 79 * 60 * 60 * 1_000L, "Outside archive"),
                TvEpgEntry("guide-id-204", now, now + 30 * 60 * 1_000L, "Batched tail entry"),
            ),
        )

        val repository = TvPlaylistRepository(store)
        val snapshot = repository.loadEpgSnapshot(
            playlists = repository.loadStored(),
            windowMs = 6 * 60 * 60 * 1_000L,
            centerMs = now,
        )

        assertEquals(
            listOf("Mapped archive", "Local id fallback", "TVG id fallback", "TVG name fallback"),
            snapshot.getValue("$playlistId:channel-0").map { it.title },
        )
        assertEquals(
            listOf("Batched tail entry"),
            snapshot.getValue("$playlistId:channel-204").map { it.title },
        )
        assertTrue(snapshot.getValue("$playlistId:channel-0").none { it.title == "Outside archive" })
    }

    @Test
    fun channelPagesKeepEqualNamesInStableNonOverlappingOrder() {
        val playlistId = "equal-name-pages"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Equal names", emptyList()),
            sourceUrl = "https://provider.example/live",
        )
        try {
            listOf("id-c", "id-a", "id-d", "id-b").forEach { id ->
                writer.addChannel(TvChannel(id, "Same channel", "https://provider/live/$id"))
            }
            writer.finish()
        } finally {
            writer.close()
        }

        val firstPage = store.getChannelPage(playlistId, offset = 0, limit = 2).map { it.id }
        val secondPage = store.getChannelPage(playlistId, offset = 2, limit = 2).map { it.id }

        assertEquals(listOf("id-c", "id-a"), firstPage)
        assertEquals(listOf("id-d", "id-b"), secondPage)
    }

    @Test
    fun channelZappingUsesStableOrderWrapsAndKeepsRadioSeparate() {
        val playlistId = "zapping-order"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Zapping", emptyList()),
            sourceUrl = "https://provider.example/live",
        )
        try {
            writer.addChannel(TvChannel("tv-b", "Beta", "https://provider/live/tv-b"))
            writer.addChannel(TvChannel("tv-a2", "Alpha", "https://provider/live/tv-a2"))
            writer.addChannel(TvChannel("tv-a1", "Alpha", "https://provider/live/tv-a1"))
            writer.addChannel(TvChannel("radio", "Radio", "https://provider/live/radio", radio = true))
            writer.finish()
        } finally {
            writer.close()
        }

        assertEquals("tv-b", store.getAdjacentChannel(playlistId, "tv-a1", 1)?.id)
        assertEquals("tv-b", store.getAdjacentChannel(playlistId, "tv-a2", -1)?.id)
        assertEquals("tv-a2", store.getAdjacentChannel(playlistId, "tv-b", 1)?.id)
        assertNull(store.getAdjacentChannel(playlistId, "radio", 1))
    }

    @Test
    fun channelZappingRespectsTheCapturedGroupOrderAndHiddenCategories() {
        val playlistId = "zapping-visible-scope"
        val writer = store.beginXtreamCatalog(
            playlistId,
            TvPlaylist("Visible scope", emptyList()),
            sourceUrl = "https://provider.example/live",
        )
        try {
            writer.addChannel(TvChannel("news-z", "Zulu News", "https://provider/live/news-z", group = "News", providerCategoryId = "1"))
            writer.addChannel(TvChannel("hidden-category", "Hidden", "https://provider/live/hidden-category", group = "Movies", providerCategoryId = "9"))
            writer.addChannel(TvChannel("hidden-group", "Blocked", "https://provider/live/hidden-group", group = "Blocked", providerCategoryId = "3"))
            writer.addChannel(TvChannel("news-a", "Alpha News", "https://provider/live/news-a", group = "News", providerCategoryId = "1"))
            writer.addChannel(TvChannel("news-other-category", "Beta News", "https://provider/live/news-other-category", group = "News", providerCategoryId = "4"))
            writer.addChannel(TvChannel("sports", "Sports", "https://provider/live/sports", group = "Sports", providerCategoryId = "2"))
            writer.finish()
        } finally {
            writer.close()
        }

        assertEquals(
            "news-a",
            store.getAdjacentChannelInScope(playlistId, "news-z", 1, groupName = "News", providerCategoryId = "1")?.id,
        )
        assertEquals(
            "news-z",
            store.getAdjacentChannelInScope(
                playlistId,
                "news-a",
                1,
                groupName = "News",
                providerCategoryId = "1",
                sortByName = true,
                descending = true,
            )?.id,
        )
        assertEquals(
            "news-a",
            store.getAdjacentChannelInScope(
                playlistId,
                "news-z",
                1,
                hiddenGroupTitles = listOf("Blocked"),
                hiddenCategoryIds = listOf("9"),
            )?.id,
        )
    }

    @Test
    fun channelZappingAndNumberSelectionTraverseConcatenatedPlaylistBlocks() {
        val firstPlaylist = "global-zap-first"
        val secondPlaylist = "global-zap-second"
        val firstWriter = store.beginXtreamCatalog(
            firstPlaylist,
            TvPlaylist("First global source", emptyList()),
            sourceUrl = "https://provider.example/first",
        )
        try {
            firstWriter.addChannel(TvChannel("first-zulu", "Zulu News", "https://provider/first/zulu", group = "News", providerCategoryId = "1"))
            firstWriter.addChannel(TvChannel("first-hidden", "Hidden News", "https://provider/first/hidden", group = "Hidden", providerCategoryId = "1"))
            firstWriter.addChannel(TvChannel("first-alpha", "Alpha News", "https://provider/first/alpha", group = "News", providerCategoryId = "1"))
            firstWriter.finish()
        } finally {
            firstWriter.close()
        }
        val secondWriter = store.beginXtreamCatalog(
            secondPlaylist,
            TvPlaylist("Second global source", emptyList()),
            sourceUrl = "https://provider.example/second",
        )
        try {
            secondWriter.addChannel(TvChannel("second-hidden-category", "Aardvark News", "https://provider/second/hidden", group = "News", providerCategoryId = "9"))
            secondWriter.addChannel(TvChannel("second-beta", "Beta News", "https://provider/second/beta", group = "News", providerCategoryId = "2"))
            secondWriter.addChannel(TvChannel("second-sport", "Sport", "https://provider/second/sport", group = "Sports", providerCategoryId = "3"))
            secondWriter.finish()
        } finally {
            secondWriter.close()
        }

        val sourceOrder = listOf(firstPlaylist, secondPlaylist)
        val hiddenGroups = mapOf(firstPlaylist to listOf("Hidden"))
        val hiddenCategories = mapOf(secondPlaylist to listOf("9"))
        fun next(id: String, delta: Int, sortByName: Boolean = false, descending: Boolean = false) =
            store.getAdjacentChannelAcrossPlaylists(
                playlistIds = sourceOrder,
                playlistId = if (id.startsWith("first-")) firstPlaylist else secondPlaylist,
                channelId = id,
                delta = delta,
                groupName = "News",
                sortByName = sortByName,
                descending = descending,
                hiddenGroupTitlesByPlaylist = hiddenGroups,
                hiddenCategoryIdsByPlaylist = hiddenCategories,
            )

        assertEquals("first-alpha", next("first-zulu", 1)?.second?.id)
        assertEquals("second-beta", next("first-alpha", 1)?.second?.id)
        assertEquals("first-zulu", next("second-beta", 1)?.second?.id)
        assertEquals("second-beta", next("first-zulu", -1)?.second?.id)
        assertEquals("first-zulu", next("first-alpha", -1)?.second?.id)

        assertEquals("first-zulu", next("first-alpha", 1, sortByName = true)?.second?.id)
        assertEquals("second-beta", next("first-zulu", 1, sortByName = true)?.second?.id)
        assertEquals("first-alpha", next("second-beta", 1, sortByName = true)?.second?.id)
        assertEquals("second-beta", next("first-alpha", -1, sortByName = true)?.second?.id)

        assertEquals(
            firstPlaylist to "first-zulu",
            store.getChannelAtPositionAcrossPlaylists(sourceOrder, 0, radioOnly = false)
                ?.let { it.first to it.second.id },
        )
        assertEquals(
            secondPlaylist to "second-hidden-category",
            store.getChannelAtPositionAcrossPlaylists(sourceOrder, 3, radioOnly = false)
                ?.let { it.first to it.second.id },
        )
        assertNull(store.getChannelAtPositionAcrossPlaylists(sourceOrder, 99, radioOnly = false))
    }

    @Test
    fun playlistOrderIsPreservedInsteadOfAlphabetizedForLivePages() {
        val playlistId = "server-order"
        store.replacePlaylist(
            playlistId,
            TvPlaylist(
                "Server order",
                listOf(
                    TvChannel("zulu", "Zulu News", "https://provider/live/zulu"),
                    TvChannel("alpha", "Alpha News", "https://provider/live/alpha"),
                    TvChannel("middle", "Middle News", "https://provider/live/middle"),
                ),
            ),
        )

        assertEquals(
            listOf("Zulu News", "Alpha News", "Middle News"),
            store.getChannelPage(playlistId, offset = 0, limit = 10).map { it.name },
        )
        assertEquals("alpha", store.getAdjacentChannel(playlistId, "zulu", 1)?.id)
    }
}
