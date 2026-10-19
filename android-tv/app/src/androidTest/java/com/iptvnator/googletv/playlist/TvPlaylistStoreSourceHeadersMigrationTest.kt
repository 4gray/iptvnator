package com.iptvnator.googletv.playlist

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvPlaylistStoreSourceHeadersMigrationTest {
    @Test
    fun version41PlaylistHeadersAreAddedWithoutLosingSourceMetadata() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "iptvnator-source-headers-migration-test.db"
        context.deleteDatabase(databaseName)
        context.openOrCreateDatabase(databaseName, Context.MODE_PRIVATE, null).use { database ->
            database.execSQL(
                """CREATE TABLE playlists (
                    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, source_url TEXT, epg_url TEXT,
                    source_user_agent TEXT, imported_at INTEGER NOT NULL,
                    hidden_groups TEXT NOT NULL DEFAULT '[]', hidden_categories TEXT NOT NULL DEFAULT '[]'
                )""".trimIndent(),
            )
            // Every real v41 database has a channel catalogue; the v43 EPG
            // search indexes are built on it.
            database.execSQL(
                "CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL, playlist_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, tvg_id TEXT, tvg_name TEXT)",
            )
            database.execSQL(
                "INSERT INTO playlists(id, name, source_url, source_user_agent, imported_at) VALUES (?, ?, ?, ?, ?)",
                arrayOf<Any?>("legacy", "Legacy M3U", "https://playlist.example/list.m3u", "LegacyAgent/1.0", 7),
            )
            database.version = 41
        }

        val upgraded = TvPlaylistStore(context, databaseName)
        try {
            val database = upgraded.writableDatabase
            val columns = database.rawQuery("PRAGMA table_info(playlists)", null).use { cursor ->
                buildSet { while (cursor.moveToNext()) add(cursor.getString(1)) }
            }
            assertTrue(columns.contains("source_referrer"))
            assertTrue(columns.contains("source_origin"))
            database.rawQuery(
                "SELECT name, source_user_agent, source_referrer, source_origin FROM playlists WHERE id = ?",
                arrayOf("legacy"),
            ).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals("Legacy M3U", cursor.getString(0))
                assertEquals("LegacyAgent/1.0", cursor.getString(1))
                assertTrue(cursor.isNull(2))
                assertTrue(cursor.isNull(3))
            }
            assertEquals(43, database.version)
        } finally {
            upgraded.close()
            context.deleteDatabase(databaseName)
        }
    }
}
