package com.iptvnator.googletv.playlist

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvPlaylistStoreFavoriteOrderMigrationTest {
    @Test
    fun skippedAndPreviousVersionsGainOrderColumnsWithoutLosingFavoritesOrOnSecondOpen() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        listOf(33, 38).forEach { oldVersion ->
            val databaseName = "iptvnator-favorite-order-v$oldVersion-test.db"
            context.deleteDatabase(databaseName)
            try {
                createHistoricalFixture(context, databaseName, oldVersion)

                TvPlaylistStore(context, databaseName).use { upgraded ->
                    val favorite = upgraded.getFavorites().single()
                    assertEquals("legacy-playlist", favorite.playlistId)
                    assertEquals("legacy-channel", favorite.itemKey)
                    assertEquals("Legacy favorite", favorite.title)
                    assertNull(favorite.globalFavoriteOrder)
                    assertNull(favorite.playlistFavoriteOrder)
                    assertEquals(setOf("global_favorite_order", "playlist_favorite_order"), savedItemColumns(context, databaseName).intersect(
                        setOf("global_favorite_order", "playlist_favorite_order"),
                    ))
                    val migratedEpgState = TvEpgSourceState("https://guide.example/xmltv", true, detected = true)
                    upgraded.setEpgSourceStates("legacy-playlist", listOf(migratedEpgState))
                    assertEquals(listOf(migratedEpgState), upgraded.getEpgSourceStates("legacy-playlist"))
                }

                TvPlaylistStore(context, databaseName).use { reopened ->
                    assertEquals("Legacy favorite", reopened.getFavorites().single().title)
                }
                SQLiteDatabase.openDatabase(
                    context.getDatabasePath(databaseName).path,
                    null,
                    SQLiteDatabase.OPEN_READONLY,
                ).use { database -> assertEquals(43, database.version) }
            } finally {
                context.deleteDatabase(databaseName)
            }
        }
    }

    private fun createHistoricalFixture(context: Context, databaseName: String, version: Int) {
        context.openOrCreateDatabase(databaseName, Context.MODE_PRIVATE, null).use { database ->
            database.execSQL(
                """CREATE TABLE playlists (
                    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, source_url TEXT, epg_url TEXT,
                    source_user_agent TEXT, imported_at INTEGER NOT NULL,
                    hidden_groups TEXT NOT NULL DEFAULT '[]', hidden_categories TEXT NOT NULL DEFAULT '[]'
                )""".trimIndent(),
            )
            database.execSQL(
                """CREATE TABLE channels (
                    id TEXT PRIMARY KEY NOT NULL, playlist_id TEXT NOT NULL, name TEXT NOT NULL,
                    url TEXT NOT NULL, group_name TEXT, radio INTEGER NOT NULL DEFAULT 0,
                    source_order INTEGER NOT NULL DEFAULT 0, tv_archive INTEGER NOT NULL DEFAULT 0,
                    tv_archive_duration INTEGER NOT NULL DEFAULT 0, catchup_source TEXT,
                    catchup_days INTEGER NOT NULL DEFAULT 0
                )""".trimIndent(),
            )
            database.execSQL(
                """CREATE TABLE saved_items (
                    id TEXT PRIMARY KEY NOT NULL, playlist_id TEXT NOT NULL, item_type TEXT NOT NULL,
                    item_key TEXT NOT NULL, title TEXT NOT NULL, uri TEXT NOT NULL, cover_url TEXT,
                    saved_at INTEGER NOT NULL, last_played_at INTEGER, is_favorite INTEGER NOT NULL DEFAULT 0,
                    resume_position_ms INTEGER NOT NULL DEFAULT 0, is_watched INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(playlist_id, item_type, item_key)
                )""".trimIndent(),
            )
            // Both catalog tables already existed at historical versions 33
            // and 38. Favorites join them while resolving live groups and
            // movie/series categories, even when this fixture stores a channel
            // favorite only.
            database.execSQL(
                """CREATE TABLE vod (
                    id TEXT PRIMARY KEY NOT NULL, playlist_id TEXT NOT NULL,
                    name TEXT NOT NULL, category_id TEXT
                )""".trimIndent(),
            )
            database.execSQL(
                """CREATE TABLE series (
                    id TEXT PRIMARY KEY NOT NULL, playlist_id TEXT NOT NULL,
                    name TEXT NOT NULL, category_id TEXT
                )""".trimIndent(),
            )
            database.execSQL("INSERT INTO playlists(id, name, imported_at) VALUES ('legacy-playlist', 'Legacy', 1)")
            database.execSQL(
                "INSERT INTO channels(id, playlist_id, name, url, group_name) VALUES ('legacy-channel', 'legacy-playlist', 'Legacy favorite', 'https://example.test/live', 'News')",
            )
            database.execSQL(
                """INSERT INTO saved_items(
                    id, playlist_id, item_type, item_key, title, uri, saved_at, last_played_at, is_favorite
                ) VALUES ('legacy-favorite', 'legacy-playlist', 'CHANNEL', 'legacy-channel',
                    'Legacy favorite', 'https://example.test/live', 17, 29, 1)""".trimIndent(),
            )
            database.version = version
        }
    }

    private fun savedItemColumns(context: Context, databaseName: String): Set<String> =
        SQLiteDatabase.openDatabase(
            context.getDatabasePath(databaseName).path,
            null,
            SQLiteDatabase.OPEN_READONLY,
        ).use { database ->
            database.rawQuery("PRAGMA table_info(saved_items)", null).use { cursor ->
                buildSet { while (cursor.moveToNext()) add(cursor.getString(1)) }
            }
        }
}
