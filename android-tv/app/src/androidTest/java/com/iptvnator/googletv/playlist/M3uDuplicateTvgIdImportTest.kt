package com.iptvnator.googletv.playlist

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.iptvnator.googletv.stalker.StalkerCredentials
import com.iptvnator.googletv.xtream.XtreamCredentials
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.io.Reader
import java.io.StringReader
import java.io.File

@RunWith(AndroidJUnit4::class)
class M3uDuplicateTvgIdImportTest {
    private val databaseName = "iptvnator-m3u-duplicate-tvg-id-test.db"
    private val identitySeed = "m3u-duplicate-tvg-id-fixture"
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
    fun importRetainsEveryChannelEvenWhenTvgIdIsShared() {
        val playlistText =
            """#EXTM3U
#EXTINF:-1 tvg-id="shared" group-title="News",First
https://provider.example/first.m3u8
#EXTINF:-1 tvg-id="shared" group-title="Sports",Second
https://provider.example/second.m3u8
#EXTINF:-1 tvg-id="shared" group-title="Movies",Third
https://provider.example/third.m3u8""".trimIndent()
        val importedPlaylist = TvPlaylistRepository(store).importM3uReader(
            reader = StringReader(playlistText).buffered(),
            name = "Duplicate IDs",
            identitySeed = identitySeed,
        )

        val imported = store.getChannelPage(importedPlaylist.id, offset = 0, limit = 10)
        assertEquals(3, store.getPlaylistCounts(importedPlaylist.id).channels)
        assertEquals(listOf("First", "Second", "Third"), imported.map(TvChannel::name))
        assertEquals(listOf("shared", "shared", "shared"), imported.map(TvChannel::tvgId))
        assertEquals(
            listOf(
                "shared",
                "shared#duplicate-2",
                "shared#duplicate-3",
            ),
            imported.map(TvChannel::id),
        )
    }

    @Test
    fun importKeepsQuotedCommasInGroupAndTvgName() {
        val importedPlaylist = TvPlaylistRepository(store).importM3uReader(
            reader = StringReader(
                """#EXTM3U
#EXTINF:-1 group-title="Noticias, España" tvg-name="Canal, Nacional",La 1, en directo
https://provider.example/live/news.m3u8""".trimIndent(),
            ).buffered(),
            name = "Comma metadata",
            identitySeed = "m3u-comma-metadata-fixture",
        )

        val channel = store.getChannelPage(importedPlaylist.id, offset = 0, limit = 1).single()
        assertEquals("Noticias, España", channel.group)
        assertEquals("Canal, Nacional", channel.tvgName)
        assertEquals("La 1, en directo", channel.name)
    }

    @Test
    fun largeM3uImportKeepsFullSqliteCountAndLoadsOnlyRequestedTailPage() {
        val channelCount = 12_000
        val playlistText = buildString(channelCount * 120) {
            appendLine("#EXTM3U")
            repeat(channelCount) { index ->
                // Deliberately repeat EPG IDs throughout the catalogue.
                appendLine("#EXTINF:-1 tvg-id=\"epg-${index % 250}\" group-title=\"Group ${index % 32}\",Channel $index")
                appendLine("https://provider.example/live/$index.m3u8")
            }
        }

        val importedPlaylist = TvPlaylistRepository(store).importM3uReader(
            reader = StringReader(playlistText).buffered(),
            name = "Large M3U",
            identitySeed = "large-m3u-fixture",
        )

        assertEquals(channelCount, store.getPlaylistCounts(importedPlaylist.id).channels)
        val tail = store.getChannelPage(importedPlaylist.id, offset = channelCount - 5, limit = 10)
        assertEquals(5, tail.size)
        assertEquals("Channel ${channelCount - 5}", tail.first().name)
        assertEquals("Channel ${channelCount - 1}", tail.last().name)
        assertEquals(5, tail.map(TvChannel::id).distinct().size)
    }

    @Test
    fun importsOneHundredThousandM3uRowsFromABoundedReader() {
        val channelCount = 100_000
        val startedAt = android.os.SystemClock.elapsedRealtime()
        val importedPlaylist = TvPlaylistRepository(store).importM3uReader(
            reader = GeneratedLargeM3uReader(channelCount).buffered(),
            name = "100k streaming M3U",
            identitySeed = "100k-streaming-m3u-fixture",
        )
        val elapsedMs = android.os.SystemClock.elapsedRealtime() - startedAt

        assertEquals(channelCount, store.getPlaylistCounts(importedPlaylist.id).channels)
        val tail = store.getChannelPage(importedPlaylist.id, offset = channelCount - 5, limit = 10)
        assertEquals(5, tail.size)
        assertEquals("Channel ${channelCount - 5}", tail.first().name)
        assertEquals("Channel ${channelCount - 1}", tail.last().name)
        assertEquals(6_250, store.getChannelGroupCounts(importedPlaylist.id).getValue("Group 15"))
        assertChannelCatalogIndexesPresent()
        android.util.Log.i("TvM3uImportPerf", "rows=$channelCount elapsedMs=$elapsedMs groupCount=${store.getChannelGroupCounts(importedPlaylist.id).size}")
    }

    private class GeneratedLargeM3uReader(private val channelCount: Int) : Reader() {
        private var currentLine = ""
        private var currentOffset = 0
        private var headerPending = true
        private var metadataPending = true
        private var channelIndex = 0
        private var exhausted = false

        override fun read(buffer: CharArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            if (exhausted) return -1
            var written = 0
            while (written < length) {
                if (currentOffset >= currentLine.length) {
                    currentOffset = 0
                    currentLine = when {
                        headerPending -> "#EXTM3U\n".also { headerPending = false }
                        channelIndex >= channelCount -> {
                            exhausted = true
                            return written.takeIf { it > 0 } ?: -1
                        }
                        metadataPending -> "#EXTINF:-1 tvg-id=\"stream-$channelIndex\" group-title=\"Group ${channelIndex % 16}\",Channel $channelIndex\n"
                            .also { metadataPending = false }
                        else -> "https://provider.example/live/$channelIndex.m3u8\n"
                            .also { metadataPending = true; channelIndex++ }
                    }
                }
                val copied = minOf(length - written, currentLine.length - currentOffset)
                currentLine.toCharArray(buffer, offset + written, currentOffset, currentOffset + copied)
                currentOffset += copied
                written += copied
            }
            return written
        }

        override fun close() = Unit
    }

    @Test
    fun refreshesSelectedLocalM3uFileAndRetainsSavedStateWhenFileDisappears() {
        val file = File(context.cacheDir, "iptvnator-local-refresh-fixture.m3u")
        val sourceUrl = Uri.fromFile(file).toString()
        val repository = TvPlaylistRepository(store)
        try {
            file.writeText("""#EXTM3U
#EXTINF:-1 tvg-id="stable" group-title="News",Original channel
https://provider.example/old.m3u8""".trimIndent())
            val original = file.bufferedReader().use { reader ->
                repository.importM3uReader(
                    reader = reader,
                    name = "Local fixture",
                    identitySeed = sourceUrl,
                    sourceUrl = sourceUrl,
                )
            }
            val channelId = original.channels.single().id
            store.setFavorite(
                TvSavedItem(
                    playlistId = original.id,
                    itemType = TvSavedItemType.CHANNEL,
                    itemKey = channelId,
                    title = "Original channel",
                    uri = original.channels.single().url,
                    coverUrl = null,
                    savedAt = 1L,
                    lastPlayedAt = null,
                ),
                true,
            )
            store.setHiddenGroupTitles(original.id, listOf("News"))

            file.writeText("""#EXTM3U
#EXTINF:-1 tvg-id="stable" group-title="News",Updated channel
https://provider.example/new.m3u8
#EXTINF:-1 tvg-id="second" group-title="Sports",Second channel
https://provider.example/second.m3u8""".trimIndent())
            val refreshed = repository.refreshPlaylist(original)
            assertEquals(original.id, refreshed.id)
            assertEquals(sourceUrl, refreshed.sourceUrl)
            assertEquals(2, store.getPlaylistCounts(original.id).channels)
            assertEquals("Updated channel", store.getChannel(original.id, channelId)?.name)
            assertEquals(listOf("News"), refreshed.hiddenGroupTitles)
            assertEquals(channelId, store.getFavorites().single().itemKey)

            assertTrue(file.delete())
            val failure = runCatching { repository.refreshPlaylist(refreshed) }.exceptionOrNull()
            assertTrue(failure?.message?.contains("No se encuentra el archivo M3U") == true)
            assertEquals(2, store.getPlaylistCounts(original.id).channels)
            assertEquals("Updated channel", store.getChannel(original.id, channelId)?.name)
        } finally {
            file.delete()
        }
    }

    @Test
    fun failedM3uRefreshRollsBackInsteadOfLeavingAnEmptyOrPartialPlaylist() {
        val repository = TvPlaylistRepository(store)
        val identity = "m3u-rollback-fixture"
        val previous = repository.importM3uReader(
            reader = StringReader("""#EXTM3U
#EXTINF:-1 tvg-id="stable",Previously imported
https://provider.example/old.m3u8""".trimIndent()).buffered(),
            name = "Rollback source",
            identitySeed = identity,
        )
        val failingReader = object : java.io.BufferedReader(
            StringReader("""#EXTM3U
#EXTINF:-1 tvg-id="new",Partial replacement
https://provider.example/new.m3u8
#EXTINF:-1 tvg-id="never-read",Never read
https://provider.example/never.m3u8""".trimIndent()),
        ) {
            private var readCount = 0
            override fun readLine(): String? {
                if (++readCount == 4) throw IOException("fixture read failure")
                return super.readLine()
            }
        }

        try {
            repository.importM3uReader(failingReader, "Rollback source", identity)
            throw AssertionError("The fixture read failure should abort the refresh")
        } catch (expected: IOException) {
            assertEquals("fixture read failure", expected.message)
        }

        assertEquals(1, store.getPlaylistCounts(previous.id).channels)
        assertEquals("Previously imported", store.getChannelPage(previous.id, 0, 10).single().name)
        assertChannelCatalogIndexesPresent()
    }

    private fun assertChannelCatalogIndexesPresent() {
        val actual = store.readableDatabase.rawQuery(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='channels'",
            null,
        ).use { cursor -> buildSet { while (cursor.moveToNext()) add(cursor.getString(0)) } }
        assertTrue(
            "Every secondary channel index must be restored after commit or rollback",
            actual.containsAll(
                setOf(
                    "channels_playlist_idx",
                    "channels_group_idx",
                    "channels_lookup_idx",
                    "channels_page_idx",
                    "channels_number_idx",
                    "channels_playlist_url_idx",
                    "channels_source_order_idx",
                    "channels_group_page_idx",
                    "channels_group_name_page_idx",
                    "channels_grouped_picker_idx",
                ),
            ),
        )
    }

    @Test
    fun editingSourceKeepsPlaylistIdentityAndUserStateWhenItsAddressChanges() {
        val xtreamCredentials = mutableMapOf<String, XtreamCredentials>()
        val stalkerCredentials = mutableMapOf<String, StalkerCredentials>()
        val repository = TvPlaylistRepository(
            store,
            xtreamCredentials = xtreamCredentials,
            stalkerCredentials = stalkerCredentials,
        )
        val previous = repository.importM3uReader(
            reader = StringReader(
                """#EXTM3U
#EXTINF:-1 tvg-id="stable" group-title="News",Original channel
https://old.example/live.m3u8""".trimIndent(),
            ).buffered(),
            name = "Before edit",
            identitySeed = "https://old.example/playlist.m3u",
            sourceUrl = "https://old.example/playlist.m3u",
        )
        val saved = TvSavedItem(
            playlistId = previous.id,
            itemType = TvSavedItemType.CHANNEL,
            itemKey = "stable",
            title = "Original channel",
            uri = "https://old.example/live.m3u8",
            coverUrl = null,
            savedAt = 1L,
            lastPlayedAt = null,
        )
        store.setFavorite(saved, true)
        store.recordPlaybackPosition(saved, positionMs = 12_000L, durationMs = 100_000L)
        store.setHiddenGroupTitles(previous.id, listOf("News"))
        store.setHiddenCategories(previous.id, listOf(TvHiddenCategory("live", "news-id")))
        xtreamCredentials[previous.id] = XtreamCredentials("https://old.example", "user", "pass")
        stalkerCredentials[previous.id] = StalkerCredentials("https://old.example", "00:1A:79:AA:BB:CC")

        val edited = repository.importM3uReader(
            reader = StringReader(
                """#EXTM3U
#EXTINF:-1 tvg-id="stable" group-title="Sports",Updated channel
https://new.example/live.m3u8""".trimIndent(),
            ).buffered(),
            name = "After edit",
            identitySeed = "https://new.example/playlist.m3u",
            sourceUrl = "https://new.example/playlist.m3u",
            playlistIdOverride = previous.id,
        )

        assertEquals("An edited source must retain its playlist identity", previous.id, edited.id)
        assertEquals("https://new.example/playlist.m3u", edited.sourceUrl)
        assertEquals(1, repository.loadStored().size)
        assertEquals(listOf("News"), edited.hiddenGroupTitles)
        assertEquals(listOf(TvHiddenCategory("live", "news-id")), edited.hiddenCategories)
        assertEquals(listOf(saved.itemKey), repository.loadFavorites().map(TvSavedItem::itemKey))
        assertEquals(12_000L, repository.loadHistory().single().resumePositionMs)
        assertEquals("Changing to M3U must clear stale provider accounts", TvProviderAccount(), repository.loadProviderAccount(edited.id))
    }
}
