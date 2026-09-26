package com.iptvnator.googletv.playlist

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvPlaylistStoreArchiveDurationMigrationTest {
    @Test
    fun convertsLegacyXtreamDaysButLeavesM3uMinutesUnchanged() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "iptvnator-archive-duration-migration-test.db"
        context.deleteDatabase(databaseName)
        val store = TvPlaylistStore(context, databaseName)
        try {
            store.replacePlaylist(
                "legacy-xtream",
                TvPlaylist(
                    "Legacy Xtream",
                    listOf(
                        TvChannel(
                            id = "xtream:1",
                            name = "Xtream archive",
                            url = "http://example.test/live/1",
                            tvArchive = true,
                            tvArchiveDurationMinutes = 48,
                        ),
                    ),
                ),
            )
            store.replacePlaylist(
                "legacy-m3u",
                TvPlaylist(
                    "Legacy M3U",
                    listOf(
                        TvChannel(
                            id = "m3u:1",
                            name = "M3U archive",
                            url = "http://example.test/live/2",
                            tvArchive = true,
                            tvArchiveDurationMinutes = 2 * 24 * 60,
                            catchupDays = 2,
                        ),
                    ),
                ),
            )
        } finally {
            store.close()
        }

        val raw = SQLiteDatabase.openDatabase(
            context.getDatabasePath(databaseName).path,
            null,
            SQLiteDatabase.OPEN_READWRITE,
        )
        raw.version = 33
        raw.close()

        val upgraded = TvPlaylistStore(context, databaseName)
        try {
            assertEquals(48 * 24 * 60, upgraded.getChannel("legacy-xtream", "xtream:1")?.tvArchiveDurationMinutes)
            assertEquals(2 * 24 * 60, upgraded.getChannel("legacy-m3u", "m3u:1")?.tvArchiveDurationMinutes)
        } finally {
            upgraded.close()
            context.deleteDatabase(databaseName)
        }
    }
}
