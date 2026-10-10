package com.iptvnator.googletv.playlist

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.iptvnator.googletv.epg.TvEpgEntry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvPlaylistStoreEpgStagingMigrationTest {
    @Test
    fun version35UpgradeCreatesStreamingImportTableAndPreservesGuide() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "iptvnator-epg-staging-migration-test.db"
        context.deleteDatabase(databaseName)
        val beforeUpgrade = TvPlaylistStore(context, databaseName)
        beforeUpgrade.replacePlaylist(
            "epg-migration",
            TvPlaylist("EPG migration", listOf(TvChannel("news", "News", "https://example.test/live"))),
        )
        beforeUpgrade.replaceEpg("epg-migration", listOf(TvEpgEntry("news", 1_000L, 2_000L, "Kept guide")))
        beforeUpgrade.close()

        SQLiteDatabase.openDatabase(
            context.getDatabasePath(databaseName).path,
            null,
            SQLiteDatabase.OPEN_READWRITE,
        ).use { database ->
            // Model the on-disk schema immediately before migration 36.
            database.execSQL("DROP TABLE epg_import_staging")
            database.version = 35
        }

        val upgraded = TvPlaylistStore(context, databaseName)
        try {
            assertEquals("Kept guide", upgraded.getEpg("epg-migration", "news", 0L, Long.MAX_VALUE).single().title)
            upgraded.beginEpgImport("epg-migration", replaceExisting = true).use { writer ->
                writer.add(TvEpgEntry("news", 3_000L, 4_000L, "Imported after upgrade"))
                writer.finish()
            }
            assertEquals(
                "Imported after upgrade",
                upgraded.getEpg("epg-migration", "news", 0L, Long.MAX_VALUE).single().title,
            )
        } finally {
            upgraded.close()
            context.deleteDatabase(databaseName)
        }
    }

    @Test
    fun version42UpgradeAddsSearchableCategoryAndPreservesStagedImports() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "iptvnator-epg-category-migration-test.db"
        context.deleteDatabase(databaseName)
        context.openOrCreateDatabase(databaseName, Context.MODE_PRIVATE, null).use { database ->
            database.execSQL("CREATE TABLE epg(source_id TEXT, channel_id TEXT, start_ms INTEGER, end_ms INTEGER, title TEXT, subtitle TEXT, description TEXT)")
            database.execSQL("CREATE TABLE epg_import_staging(import_id TEXT, source_id TEXT, channel_id TEXT, start_ms INTEGER, end_ms INTEGER, title TEXT, subtitle TEXT, description TEXT)")
            database.execSQL("CREATE TABLE channels(id TEXT, playlist_id TEXT, name TEXT, tvg_id TEXT, tvg_name TEXT, source_order INTEGER)")
            database.execSQL("CREATE TABLE epg_mappings(source_id TEXT, channel_id TEXT, epg_channel_id TEXT)")
            database.execSQL("INSERT INTO epg VALUES('epg-category', 'news', 1000, 2000, 'Kept programme', NULL, NULL)")
            database.version = 42
        }

        val upgraded = TvPlaylistStore(context, databaseName)
        try {
            assertEquals(null, upgraded.getEpg("epg-category", "news", 0L, Long.MAX_VALUE).single().category)
            upgraded.beginEpgImport("epg-category", replaceExisting = true).use { writer ->
                writer.add(TvEpgEntry("news", 3_000L, 4_000L, "Categorized programme", category = "Documentary"))
                writer.finish()
            }
            assertEquals(
                "Documentary",
                upgraded.getEpg("epg-category", "news", 0L, Long.MAX_VALUE).single().category,
            )
        } finally {
            upgraded.close()
            context.deleteDatabase(databaseName)
        }
    }
}
