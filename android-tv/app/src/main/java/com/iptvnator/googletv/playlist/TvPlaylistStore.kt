package com.iptvnator.googletv.playlist

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import android.database.sqlite.SQLiteOpenHelper
import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.TvDrmConfig
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class StoredPlaylist(
    val id: String,
    val name: String,
    val sourceUrl: String?,
    val epgUrl: String? = null,
    val epgUrls: List<String> = emptyList(),
    val sourceUserAgent: String? = null,
    val importedAtMs: Long? = null,
    val channels: List<TvChannel>,
    val vod: List<TvVodItem> = emptyList(),
    val series: List<TvSeriesItem> = emptyList(),
    /** Complete persisted totals; the lists above are intentionally paged at startup. */
    val catalogCounts: TvPlaylistCounts? = null,
    /** Group titles hidden by the user in the live/radio group rail. */
    val hiddenGroupTitles: List<String> = emptyList(),
    /** Xtream category ids hidden by content type (live/movies/series). */
    val hiddenCategories: List<TvHiddenCategory> = emptyList(),
    /** Playlist-level HTTP header defaults used when a channel has no override. */
    val sourceReferrer: String? = null,
    val sourceOrigin: String? = null,
)

data class TvHiddenCategory(
    val type: String,
    val id: String,
)

data class TvPlaylistCounts(
    val channels: Int,
    val vod: Int,
    val series: Int,
    val radio: Int = 0,
)

data class TvEpgSourceState(
    val url: String,
    val enabled: Boolean,
    val detected: Boolean = false,
)

data class StoredEpgSearchHit(
    val playlistId: String,
    val channel: TvChannel,
    val programme: TvEpgEntry,
)

data class TvVodItem(
    val id: Int,
    val name: String,
    val url: String,
    val categoryId: String?,
    val coverUrl: String?,
    val extension: String,
    val rating: Double?,
    val providerCommand: String? = null,
    val providerType: String? = null,
    val useHttpTmpLink: Boolean? = null,
    val useLoadBalancing: Boolean? = null,
    val addedAtMs: Long? = null,
    val providerCategoryId: String? = null,
)

data class TvSeriesItem(
    val id: Int,
    val name: String,
    val categoryId: String?,
    val coverUrl: String?,
    val plot: String?,
    val rating: Double?,
    val providerType: String? = null,
    val providerCommand: String? = null,
    val useHttpTmpLink: Boolean? = null,
    val useLoadBalancing: Boolean? = null,
    val addedAtMs: Long? = null,
    val providerCategoryId: String? = null,
)

data class TvCatalogCategoryMapping(
    val label: String,
    val providerId: String?,
)

enum class TvSavedItemType { CHANNEL, VOD, SERIES }

data class TvSavedItem(
    val playlistId: String,
    val itemType: TvSavedItemType,
    val itemKey: String,
    val title: String,
    val uri: String,
    val coverUrl: String?,
    val savedAt: Long,
    val lastPlayedAt: Long?,
    val isFavorite: Boolean = false,
    val resumePositionMs: Long = 0L,
    val isWatched: Boolean = false,
    val globalFavoriteOrder: Int? = null,
    val playlistFavoriteOrder: Int? = null,
    /** Resolved from the current source catalogue for Favorites group/category filtering. */
    val categoryId: String? = null,
)

data class TvEpisodeProgress(
    val playlistId: String,
    val seriesId: Int,
    val episodeId: Int,
    val positionMs: Long,
    val durationMs: Long,
    val completed: Boolean,
    val updatedAt: Long,
)

/** Small SQLite boundary for the TV client; it can later be replaced by Room without changing callers. */
class TvPlaylistStore(context: Context, databaseName: String = DATABASE_NAME) : SQLiteOpenHelper(
    context,
    databaseName,
    null,
    DATABASE_VERSION,
) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE playlists (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                source_url TEXT,
                epg_url TEXT,
                source_user_agent TEXT,
                source_referrer TEXT,
                source_origin TEXT,
                imported_at INTEGER NOT NULL,
                hidden_groups TEXT NOT NULL DEFAULT '[]',
                hidden_categories TEXT NOT NULL DEFAULT '[]'
            )""".trimIndent()
        )
        db.execSQL(
            """CREATE TABLE channels (
                id TEXT PRIMARY KEY NOT NULL,
                playlist_id TEXT NOT NULL,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                group_name TEXT,
                logo_url TEXT,
                tvg_id TEXT,
                tvg_name TEXT,
                user_agent TEXT,
                headers TEXT,
                provider_command TEXT,
                stalker_http_tmp INTEGER,
                stalker_load_balancing INTEGER,
                tv_archive INTEGER NOT NULL DEFAULT 0,
                tv_archive_duration INTEGER NOT NULL DEFAULT 0,
                catchup_source TEXT,
                catchup_type TEXT,
                catchup_days INTEGER NOT NULL DEFAULT 0,
                radio INTEGER NOT NULL DEFAULT 0,
                channel_number INTEGER,
                source_order INTEGER NOT NULL DEFAULT 0,
                drm_json TEXT,
                provider_category_id TEXT,
                favorite INTEGER NOT NULL DEFAULT 0,
                last_played_at INTEGER,
                FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            )""".trimIndent()
        )
        db.execSQL("CREATE INDEX channels_playlist_idx ON channels(playlist_id)")
        db.execSQL("CREATE INDEX channels_group_idx ON channels(playlist_id, group_name)")
        createChannelUrlLookupIndex(db)
        createCatalogTables(db)
        createChannelSourceOrderIndex(db)
        createGroupedChannelPickerIndex(db)
        createUserItemTable(db)
        createEpgTable(db)
        createEpgImportStagingTable(db)
        createEpgMappingTable(db)
        createEpgSearchIndexes(db)
        createEpgSourcesTable(db)
        createEpisodeProgressTable(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) createCatalogTables(db)
        if (oldVersion < 3) addColumnIfMissing(db, "channels", "provider_command", "TEXT")
        if (oldVersion < 4) createUserItemTable(db)
        if (oldVersion < 5) addColumnIfMissing(db, "saved_items", "is_favorite", "INTEGER NOT NULL DEFAULT 0")
        if (oldVersion < 6) createEpgTable(db)
        if (oldVersion < 7) {
            addColumnIfMissing(db, "vod", "provider_command", "TEXT")
            addColumnIfMissing(db, "vod", "provider_type", "TEXT")
        }
        if (oldVersion < 8) addColumnIfMissing(db, "series", "provider_type", "TEXT")
        if (oldVersion < 9) addColumnIfMissing(db, "playlists", "epg_url", "TEXT")
        if (oldVersion < 10) addColumnIfMissing(db, "series", "provider_command", "TEXT")
        if (oldVersion < 11) addColumnIfMissing(db, "channels", "headers", "TEXT")
        if (oldVersion < 12) addColumnIfMissing(db, "saved_items", "resume_position_ms", "INTEGER NOT NULL DEFAULT 0")
        if (oldVersion < 13) {
            addColumnIfMissing(db, "channels", "tv_archive", "INTEGER NOT NULL DEFAULT 0")
            addColumnIfMissing(db, "channels", "tv_archive_duration", "INTEGER NOT NULL DEFAULT 0")
        }
        if (oldVersion < 14) {
            addColumnIfMissing(db, "channels", "catchup_source", "TEXT")
            addColumnIfMissing(db, "channels", "catchup_type", "TEXT")
            addColumnIfMissing(db, "channels", "catchup_days", "INTEGER NOT NULL DEFAULT 0")
        }
        if (oldVersion < 15) createEpisodeProgressTable(db)
        if (oldVersion < 16) addColumnIfMissing(db, "channels", "radio", "INTEGER NOT NULL DEFAULT 0")
        if (oldVersion < 17) addColumnIfMissing(db, "channels", "channel_number", "INTEGER")
        if (oldVersion < 18) addColumnIfMissing(db, "playlists", "source_user_agent", "TEXT")
        if (oldVersion < 19) addColumnIfMissing(db, "channels", "drm_json", "TEXT")
        if (oldVersion < 20) addColumnIfMissing(db, "channels", "tvg_name", "TEXT")
        if (oldVersion < 21) {
            addColumnIfMissing(db, "vod", "added_at_ms", "INTEGER")
            addColumnIfMissing(db, "series", "added_at_ms", "INTEGER")
        }
        if (oldVersion < 22) addColumnIfMissing(db, "saved_items", "is_watched", "INTEGER NOT NULL DEFAULT 0")
        if (oldVersion < 23) createEpgMappingTable(db)
        if (oldVersion < 24) createEpgSourcesTable(db)
        if (oldVersion < 25) createCatalogRecentIndexes(db)
        if (oldVersion < 26) createCatalogLookupIndexes(db)
        if (oldVersion < 27) {
            addColumnIfMissing(db, "channels", "stalker_http_tmp", "INTEGER")
            addColumnIfMissing(db, "channels", "stalker_load_balancing", "INTEGER")
            addColumnIfMissing(db, "vod", "stalker_http_tmp", "INTEGER")
            addColumnIfMissing(db, "vod", "stalker_load_balancing", "INTEGER")
            addColumnIfMissing(db, "series", "stalker_http_tmp", "INTEGER")
            addColumnIfMissing(db, "series", "stalker_load_balancing", "INTEGER")
        }
        if (oldVersion < 28) addColumnIfMissing(db, "playlists", "hidden_groups", "TEXT NOT NULL DEFAULT '[]'")
        if (oldVersion < 29) addColumnIfMissing(db, "playlists", "hidden_categories", "TEXT NOT NULL DEFAULT '[]'")
        if (oldVersion < 34) {
            // Before version 34 Xtream's day-valued tv_archive_duration was
            // stored directly in a column whose contract is minutes. M3U
            // archive rows already carry catchup_days and must not be scaled.
            db.execSQL(
                """UPDATE channels
                    SET tv_archive_duration = MIN(tv_archive_duration * 1440, 2147483647)
                    WHERE tv_archive = 1
                      AND catchup_days = 0
                      AND (catchup_source IS NULL OR TRIM(catchup_source) = '')
                      AND tv_archive_duration > 0""".trimIndent(),
            )
        }
        if (oldVersion < 30) addColumnIfMissing(db, "channels", "provider_category_id", "TEXT")
        if (oldVersion < 31) {
            addColumnIfMissing(db, "vod", "provider_category_id", "TEXT")
            addColumnIfMissing(db, "series", "provider_category_id", "TEXT")
        }
        if (oldVersion < 32) createChannelPageIndex(db)
        if (oldVersion < 33) {
            addColumnIfMissing(db, "channels", "source_order", "INTEGER NOT NULL DEFAULT 0")
            // rowid is the insertion order for legacy catalogs; preserve it
            // during migration instead of turning old playlists alphabetical.
            db.execSQL("UPDATE channels SET source_order = rowid")
            createChannelSourceOrderIndex(db)
        }
        if (oldVersion < 35) createGroupedChannelPickerIndex(db)
        if (oldVersion < 36) createEpgImportStagingTable(db)
        if (oldVersion < 37) {
            db.execSQL("DROP INDEX IF EXISTS channels_group_page_idx")
            createChannelGroupPageIndex(db)
        }
        if (oldVersion < 38) createChannelGroupNamePageIndex(db)
        if (oldVersion < 39) {
            addColumnIfMissing(db, "saved_items", "global_favorite_order", "INTEGER")
            addColumnIfMissing(db, "saved_items", "playlist_favorite_order", "INTEGER")
        }
        if (oldVersion < 40) createChannelUrlLookupIndex(db)
        if (oldVersion < 41) {
            createEpgSourcesTable(db)
            addColumnIfMissing(db, "epg_sources", "detected", "INTEGER NOT NULL DEFAULT 0")
        }
        if (oldVersion < 42) {
            addColumnIfMissing(db, "playlists", "source_referrer", "TEXT")
            addColumnIfMissing(db, "playlists", "source_origin", "TEXT")
        }
        if (oldVersion < 43) {
            // Create-if-missing first: a skipped-release or partially
            // initialised database may lack either EPG table, and ALTER TABLE
            // on a missing table aborts the whole upgrade.
            createEpgTable(db)
            createEpgImportStagingTable(db)
            createEpgMappingTable(db)
            addColumnIfMissing(db, "channels", "tvg_id", "TEXT")
            addColumnIfMissing(db, "channels", "tvg_name", "TEXT")
            addColumnIfMissing(db, "epg", "category", "TEXT")
            addColumnIfMissing(db, "epg_import_staging", "category", "TEXT")
            createEpgSearchIndexes(db)
        }
    }

    private fun addColumnIfMissing(db: SQLiteDatabase, table: String, column: String, definition: String) {
        val exists = db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
            generateSequence { if (cursor.moveToNext()) cursor.getString(1) else null }.any { it == column }
        }
        if (!exists) db.execSQL("ALTER TABLE $table ADD COLUMN $column $definition")
    }

    override fun onConfigure(db: SQLiteDatabase) {
        super.onConfigure(db)
        db.setForeignKeyConstraintsEnabled(true)
    }

    fun replacePlaylist(
        id: String,
        playlist: TvPlaylist,
        sourceUrl: String? = null,
        epgUrl: String? = null,
        sourceUserAgent: String? = null,
        sourceReferrer: String? = null,
        sourceOrigin: String? = null,
    ) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("channels", "playlist_id = ?", arrayOf(id))
            val metadata = ContentValues().apply {
                put("id", id)
                put("name", playlist.name)
                put("source_url", sourceUrl)
                put("epg_url", epgUrl)
                put("source_user_agent", sourceUserAgent)
                put("source_referrer", sourceReferrer)
                put("source_origin", sourceOrigin)
                put("imported_at", System.currentTimeMillis())
            }
            // Do not use INSERT OR REPLACE here. SQLite implements REPLACE as
            // delete + insert, which would cascade into saved_items,
            // episode_progress and epg whenever an existing source is refreshed.
            if (db.update("playlists", metadata, "id = ?", arrayOf(id)) == 0) {
                db.insertOrThrow("playlists", null, metadata)
            }
            playlist.channels.forEachIndexed { index, channel ->
                db.insertWithOnConflict(
                    "channels",
                    null,
                    ContentValues().apply {
                        put("id", "$id:${channel.id}")
                        put("playlist_id", id)
                        put("name", channel.name)
                        put("url", channel.url)
                        put("group_name", channel.group)
                        put("provider_category_id", channel.providerCategoryId)
                        put("logo_url", channel.logoUrl)
                        put("tvg_id", channel.tvgId)
                        put("tvg_name", channel.tvgName)
                        put("user_agent", channel.userAgent)
                        put("headers", channel.headers.takeIf { it.isNotEmpty() }?.let { headers ->
                            JSONObject().apply { headers.forEach { (key, value) -> put(key, value) } }.toString()
                        })
                        put("provider_command", channel.providerCommand)
                        put("stalker_http_tmp", channel.useHttpTmpLink?.let { if (it) 1 else 0 })
                        put("stalker_load_balancing", channel.useLoadBalancing?.let { if (it) 1 else 0 })
                        put("tv_archive", if (channel.tvArchive) 1 else 0)
                        put("tv_archive_duration", channel.tvArchiveDurationMinutes)
                        put("catchup_source", channel.catchupSource)
                        put("catchup_type", channel.catchupType)
                        put("catchup_days", channel.catchupDays)
                        put("radio", if (channel.radio) 1 else 0)
                        put("channel_number", channel.channelNumber)
                        put("source_order", index)
                        put("drm_json", channel.drm?.let { drm ->
                            JSONObject().apply {
                                put("license_type", drm.licenseType)
                                put("supported", drm.supported)
                                put("clear_keys", JSONObject(drm.clearKeys))
                                put("license_url", drm.licenseUrl ?: JSONObject.NULL)
                                put("license_headers", JSONObject(drm.licenseHeaders))
                                put("license_request_data", drm.licenseRequestData ?: JSONObject.NULL)
                                put("license_response_data", drm.licenseResponseData ?: JSONObject.NULL)
                                put("additional_properties", JSONObject(drm.additionalProperties))
                            }.toString()
                        })
                    },
                    SQLiteDatabase.CONFLICT_REPLACE,
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun replaceXtreamCatalog(
        id: String,
        playlist: TvPlaylist,
        vod: List<TvVodItem>,
        series: List<TvSeriesItem>,
        sourceUrl: String,
        epgUrl: String? = null,
    ) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            // A Stalker refresh updates live channels and its VOD/series
            // catalogue together. Keep the playlist-row/channel replacement
            // inside this transaction too, so a malformed catalogue cannot
            // leave a mixture of the old VOD/series and new live channels.
            replacePlaylist(id, playlist, sourceUrl, epgUrl)
            db.delete("vod", "playlist_id = ?", arrayOf(id))
            db.delete("series", "playlist_id = ?", arrayOf(id))
            vod.forEach { item ->
                db.insertOrThrow("vod", null, ContentValues().apply {
                    put("id", "$id:${item.id}")
                    put("playlist_id", id)
                    put("xtream_id", item.id)
                    put("name", item.name)
                    put("url", item.url)
                    put("category_id", item.categoryId)
                    put("provider_category_id", item.providerCategoryId)
                    put("cover_url", item.coverUrl)
                    put("extension", item.extension)
                    put("rating", item.rating)
                    put("provider_command", item.providerCommand)
                    put("provider_type", item.providerType)
                    put("stalker_http_tmp", item.useHttpTmpLink?.let { if (it) 1 else 0 })
                    put("stalker_load_balancing", item.useLoadBalancing?.let { if (it) 1 else 0 })
                    put("added_at_ms", item.addedAtMs)
                })
            }
            series.forEach { item ->
                db.insertOrThrow("series", null, ContentValues().apply {
                    put("id", "$id:${item.id}")
                    put("playlist_id", id)
                    put("xtream_id", item.id)
                    put("name", item.name)
                    put("category_id", item.categoryId)
                    put("provider_category_id", item.providerCategoryId)
                    put("cover_url", item.coverUrl)
                    put("plot", item.plot)
                    put("rating", item.rating)
                    put("provider_type", item.providerType)
                    put("provider_command", item.providerCommand)
                    put("stalker_http_tmp", item.useHttpTmpLink?.let { if (it) 1 else 0 })
                    put("stalker_load_balancing", item.useLoadBalancing?.let { if (it) 1 else 0 })
                    put("added_at_ms", item.addedAtMs)
                })
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /**
     * Starts an Xtream catalogue transaction without requiring the caller to
     * build the complete VOD/series lists first. This is important for TV
     * panels that expose hundreds of thousands of rows.
     */
    fun beginXtreamCatalog(
        id: String,
        playlist: TvPlaylist,
        sourceUrl: String,
        epgUrl: String? = null,
    ): XtreamCatalogWriter {
        val db = writableDatabase
        db.beginTransaction()
        return try {
            // Keep source metadata in the same transaction as the streamed
            // catalogue. If a large import is cancelled or the provider drops
            // the connection, neither an empty playlist nor a partial catalog
            // may survive the rollback.
            db.delete("channels", "playlist_id = ?", arrayOf(id))
            val metadata = ContentValues().apply {
                put("id", id)
                put("name", playlist.name)
                put("source_url", sourceUrl)
                put("epg_url", epgUrl)
                put("source_user_agent", null as String?)
                put("source_referrer", null as String?)
                put("source_origin", null as String?)
                put("imported_at", System.currentTimeMillis())
            }
            // Avoid INSERT OR REPLACE: REPLACE would delete the row and can
            // cascade into saved items, episode progress and EPG state.
            if (db.update("playlists", metadata, "id = ?", arrayOf(id)) == 0) {
                db.insertOrThrow("playlists", null, metadata)
            }
            db.delete("channels", "playlist_id = ?", arrayOf(id))
            dropChannelCatalogIndexes(db)
            db.delete("vod", "playlist_id = ?", arrayOf(id))
            db.delete("series", "playlist_id = ?", arrayOf(id))
            dropContentCatalogIndexes(db)
            XtreamCatalogWriter(id, db, rebuildChannelIndexesOnFinish = true)
        } catch (failure: Throwable) {
            db.endTransaction()
            throw failure
        }
    }

    /** Starts an atomic M3U refresh while channel rows are parsed from the network stream. */
    fun beginM3uCatalog(
        id: String,
        name: String,
        sourceUrl: String?,
        sourceUserAgent: String?,
        sourceReferrer: String? = null,
        sourceOrigin: String? = null,
    ): XtreamCatalogWriter {
        val db = writableDatabase
        db.beginTransaction()
        return try {
            db.delete("channels", "playlist_id = ?", arrayOf(id))
            dropChannelCatalogIndexes(db)
            val metadata = ContentValues().apply {
                put("id", id)
                put("name", name)
                put("source_url", sourceUrl)
                put("epg_url", null as String?)
                put("source_user_agent", sourceUserAgent)
                put("source_referrer", sourceReferrer)
                put("source_origin", sourceOrigin)
                put("imported_at", System.currentTimeMillis())
            }
            if (db.update("playlists", metadata, "id = ?", arrayOf(id)) == 0) {
                db.insertOrThrow("playlists", null, metadata)
            }
            XtreamCatalogWriter(id, db, rebuildChannelIndexesOnFinish = true)
        } catch (failure: Throwable) {
            db.endTransaction()
            throw failure
        }
    }

    inner class XtreamCatalogWriter internal constructor(
        private val playlistId: String,
        private val db: SQLiteDatabase,
        private val rebuildChannelIndexesOnFinish: Boolean = false,
    ) : AutoCloseable {
        private var closed = false
        private var nextChannelOrder = 0
        private val channelInsert = db.compileStatement(
            """INSERT OR REPLACE INTO channels (
                id, playlist_id, name, url, group_name, provider_category_id, logo_url, tvg_id, tvg_name,
                user_agent, headers, provider_command, tv_archive, tv_archive_duration,
                catchup_source, catchup_type, catchup_days, radio, channel_number, drm_json, source_order,
                stalker_http_tmp, stalker_load_balancing
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""".trimIndent(),
        )
        private val channelInsertIfUnique = db.compileStatement(
            """INSERT OR IGNORE INTO channels (
                id, playlist_id, name, url, group_name, provider_category_id, logo_url, tvg_id, tvg_name,
                user_agent, headers, provider_command, tv_archive, tv_archive_duration,
                catchup_source, catchup_type, catchup_days, radio, channel_number, drm_json, source_order,
                stalker_http_tmp, stalker_load_balancing
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""".trimIndent(),
        )
        private val vodInsert = db.compileStatement(
            """INSERT INTO vod (
                id, playlist_id, xtream_id, name, url, category_id, provider_category_id, cover_url,
                extension, rating, provider_command, provider_type, added_at_ms, stalker_http_tmp, stalker_load_balancing
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""".trimIndent(),
        )
        private val seriesInsert = db.compileStatement(
            """INSERT OR REPLACE INTO series (
                id, playlist_id, xtream_id, name, category_id, provider_category_id, cover_url, plot,
                rating, provider_type, provider_command, added_at_ms, stalker_http_tmp, stalker_load_balancing
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""".trimIndent(),
        )

        private fun SQLiteStatement.bindStringOrNull(index: Int, value: String?) {
            if (value == null) bindNull(index) else bindString(index, value)
        }

        private fun SQLiteStatement.bindLongOrNull(index: Int, value: Long?) {
            if (value == null) bindNull(index) else bindLong(index, value)
        }

        private fun SQLiteStatement.bindDoubleOrNull(index: Int, value: Double?) {
            if (value == null) bindNull(index) else bindDouble(index, value)
        }

        private fun insertChannel(statement: SQLiteStatement, channel: TvChannel, storedId: String): Long {
            val headers = channel.headers.takeIf { it.isNotEmpty() }?.let { values ->
                JSONObject().apply { values.forEach { (key, value) -> put(key, value) } }.toString()
            }
            val drm = channel.drm?.let { value ->
                JSONObject().apply {
                    put("license_type", value.licenseType)
                    put("supported", value.supported)
                    put("clear_keys", JSONObject(value.clearKeys))
                    put("license_url", value.licenseUrl ?: JSONObject.NULL)
                    put("license_headers", JSONObject(value.licenseHeaders))
                    put("license_request_data", value.licenseRequestData ?: JSONObject.NULL)
                    put("license_response_data", value.licenseResponseData ?: JSONObject.NULL)
                    put("additional_properties", JSONObject(value.additionalProperties))
                }.toString()
            }
            statement.clearBindings()
            statement.bindString(1, storedId)
            statement.bindString(2, playlistId)
            statement.bindString(3, channel.name)
            statement.bindString(4, channel.url)
            statement.bindStringOrNull(5, channel.group)
            statement.bindStringOrNull(6, channel.providerCategoryId)
            statement.bindStringOrNull(7, channel.logoUrl)
            statement.bindStringOrNull(8, channel.tvgId)
            statement.bindStringOrNull(9, channel.tvgName)
            statement.bindStringOrNull(10, channel.userAgent)
            statement.bindStringOrNull(11, headers)
            statement.bindStringOrNull(12, channel.providerCommand)
            statement.bindLong(13, if (channel.tvArchive) 1 else 0)
            statement.bindLong(14, channel.tvArchiveDurationMinutes.toLong())
            statement.bindStringOrNull(15, channel.catchupSource)
            statement.bindStringOrNull(16, channel.catchupType)
            statement.bindLong(17, channel.catchupDays.toLong())
            statement.bindLong(18, if (channel.radio) 1 else 0)
            statement.bindLongOrNull(19, channel.channelNumber?.toLong())
            statement.bindStringOrNull(20, drm)
            statement.bindLong(21, nextChannelOrder.toLong())
            statement.bindLongOrNull(22, channel.useHttpTmpLink?.let { if (it) 1L else 0L })
            statement.bindLongOrNull(23, channel.useLoadBalancing?.let { if (it) 1L else 0L })
            return statement.executeInsert()
        }

        fun addChannel(channel: TvChannel) {
            check(!closed) { "Xtream catalogue writer is closed" }
            insertChannel(channelInsert, channel, "$playlistId:${channel.id}")
            nextChannelOrder += 1
        }

        /** Stores M3U entries without an in-heap ID set; duplicate provider IDs get stable suffixes. */
        fun addChannelKeepingDuplicates(channel: TvChannel) {
            check(!closed) { "Xtream catalogue writer is closed" }
            var suffix = 1
            while (true) {
                val channelId = if (suffix == 1) channel.id else "${channel.id}#duplicate-$suffix"
                val storedId = "$playlistId:$channelId"
                if (insertChannel(channelInsertIfUnique, channel, storedId) >= 0L) {
                    nextChannelOrder += 1
                    return
                }
                val idAlreadyExists = db.rawQuery(
                    "SELECT 1 FROM channels WHERE id = ? LIMIT 1",
                    arrayOf(storedId),
                ).use { it.moveToFirst() }
                check(idAlreadyExists) { "M3U channel could not be inserted without an ID collision" }
                suffix += 1
            }
        }

        fun setEpgUrl(url: String?) {
            check(!closed) { "Xtream catalogue writer is closed" }
            db.execSQL("UPDATE playlists SET epg_url = ? WHERE id = ?", arrayOf(url, playlistId))
        }

        fun addVod(item: TvVodItem) {
            check(!closed) { "Xtream catalogue writer is closed" }
            vodInsert.clearBindings()
            vodInsert.bindString(1, "$playlistId:${item.id}")
            vodInsert.bindString(2, playlistId)
            vodInsert.bindLong(3, item.id.toLong())
            vodInsert.bindString(4, item.name)
            vodInsert.bindString(5, item.url)
            vodInsert.bindStringOrNull(6, item.categoryId)
            vodInsert.bindStringOrNull(7, item.providerCategoryId)
            vodInsert.bindStringOrNull(8, item.coverUrl)
            vodInsert.bindString(9, item.extension)
            vodInsert.bindDoubleOrNull(10, item.rating)
            vodInsert.bindStringOrNull(11, item.providerCommand)
            vodInsert.bindStringOrNull(12, item.providerType)
            vodInsert.bindLongOrNull(13, item.addedAtMs)
            vodInsert.bindLongOrNull(14, item.useHttpTmpLink?.let { if (it) 1L else 0L })
            vodInsert.bindLongOrNull(15, item.useLoadBalancing?.let { if (it) 1L else 0L })
            vodInsert.executeInsert()
        }

        fun addSeries(item: TvSeriesItem) {
            check(!closed) { "Xtream catalogue writer is closed" }
            seriesInsert.clearBindings()
            seriesInsert.bindString(1, "$playlistId:${item.id}")
            seriesInsert.bindString(2, playlistId)
            seriesInsert.bindLong(3, item.id.toLong())
            seriesInsert.bindString(4, item.name)
            seriesInsert.bindStringOrNull(5, item.categoryId)
            seriesInsert.bindStringOrNull(6, item.providerCategoryId)
            seriesInsert.bindStringOrNull(7, item.coverUrl)
            seriesInsert.bindStringOrNull(8, item.plot)
            seriesInsert.bindDoubleOrNull(9, item.rating)
            seriesInsert.bindStringOrNull(10, item.providerType)
            seriesInsert.bindStringOrNull(11, item.providerCommand)
            seriesInsert.bindLongOrNull(12, item.addedAtMs)
            seriesInsert.bindLongOrNull(13, item.useHttpTmpLink?.let { if (it) 1L else 0L })
            seriesInsert.bindLongOrNull(14, item.useLoadBalancing?.let { if (it) 1L else 0L })
            seriesInsert.executeInsert()
        }

        fun finish() {
            check(!closed) { "Xtream catalogue writer is closed" }
            if (rebuildChannelIndexesOnFinish) {
                createChannelCatalogIndexes(db)
                createContentCatalogIndexes(db)
            }
            db.setTransactionSuccessful()
            close()
        }

        override fun close() {
            if (!closed) {
                closed = true
                channelInsert.close()
                channelInsertIfUnique.close()
                vodInsert.close()
                seriesInsert.close()
                db.endTransaction()
            }
        }
    }

    /** Bulk provider imports rebuild secondary indexes once, after all rows are inserted. */
    private fun dropChannelCatalogIndexes(db: SQLiteDatabase) {
        CHANNEL_CATALOG_INDEXES.forEach { name -> db.execSQL("DROP INDEX IF EXISTS $name") }
    }

    private fun createChannelCatalogIndexes(db: SQLiteDatabase) {
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_playlist_idx ON channels(playlist_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_group_idx ON channels(playlist_id, group_name)")
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_lookup_idx ON channels(playlist_id, radio, name COLLATE NOCASE, id)")
        createChannelPageIndex(db)
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_number_idx ON channels(playlist_id, radio, channel_number)")
        createChannelUrlLookupIndex(db)
        createChannelSourceOrderIndex(db)
        createGroupedChannelPickerIndex(db)
    }

    private fun dropContentCatalogIndexes(db: SQLiteDatabase) {
        CONTENT_CATALOG_INDEXES.forEach { name -> db.execSQL("DROP INDEX IF EXISTS $name") }
    }

    private fun createContentCatalogIndexes(db: SQLiteDatabase) {
        db.execSQL("CREATE INDEX IF NOT EXISTS vod_playlist_idx ON vod(playlist_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS series_playlist_idx ON series(playlist_id)")
        createCatalogRecentIndexes(db)
        db.execSQL("CREATE INDEX IF NOT EXISTS vod_name_lookup_idx ON vod(playlist_id, name COLLATE NOCASE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS series_name_lookup_idx ON series(playlist_id, name COLLATE NOCASE)")
    }

    /**
     * Loads the source metadata and an initial catalog window. The complete
     * Xtream catalog remains persisted in SQLite and is fetched incrementally
     * by the TV catalog surfaces; materialising every row at startup would
     * exhaust a Google TV heap on large providers.
     */
    fun getPlaylists(catalogLimit: Int = 500): List<StoredPlaylist> {
        val result = mutableListOf<StoredPlaylist>()
        readableDatabase.query(
            "playlists",
            arrayOf("id", "name", "source_url", "epg_url", "source_user_agent", "source_referrer", "source_origin", "imported_at", "hidden_groups", "hidden_categories"),
            null,
            null,
            null,
            null,
            "imported_at DESC",
        ).use { playlists ->
            while (playlists.moveToNext()) {
                val id = playlists.getString(0)
                val primaryEpg = playlists.getStringOrNull(3)
                result += StoredPlaylist(
                    id = id,
                    name = playlists.getString(1),
                    sourceUrl = playlists.getStringOrNull(2),
                    epgUrl = primaryEpg,
                    epgUrls = getEpgUrls(id, primaryEpg),
                    sourceUserAgent = playlists.getStringOrNull(4),
                    importedAtMs = playlists.getLongOrNull(7),
                    channels = getChannels(id, offset = 0, limit = catalogLimit),
                    vod = getVod(id, 0, catalogLimit),
                    series = getSeries(id, 0, catalogLimit),
                    hiddenGroupTitles = parseHiddenGroups(playlists.getStringOrNull(8)),
                    hiddenCategories = parseHiddenCategories(playlists.getStringOrNull(9)),
                    sourceReferrer = playlists.getStringOrNull(5),
                    sourceOrigin = playlists.getStringOrNull(6),
                )
            }
        }
        return result
    }

    /** Returns complete provider totals without materialising the catalog windows. */
    fun getPlaylistCounts(playlistId: String): TvPlaylistCounts {
        fun count(table: String, predicate: String? = null): Int = readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM $table WHERE playlist_id = ?${predicate?.let { " AND $it" }.orEmpty()}",
            arrayOf(playlistId),
        ).use { cursor ->
            if (cursor.moveToFirst()) cursor.getLong(0).coerceAtMost(Int.MAX_VALUE.toLong()).toInt() else 0
        }
        return TvPlaylistCounts(
            channels = count("channels"),
            vod = count("vod"),
            series = count("series"),
            radio = count("channels", "radio = 1"),
        )
    }

    /** Loads a bounded live-TV window; large Xtream sources must not be materialised at startup. */
    fun getChannelPage(
        playlistId: String,
        offset: Int,
        limit: Int = 500,
        radioOnly: Boolean? = null,
        sortByName: Boolean = false,
        descending: Boolean = false,
    ): List<TvChannel> = if (radioOnly == null) {
        getChannels(
            playlistId,
            offset,
            limit,
            orderBy = if (sortByName) channelNameOrder(descending) else "source_order, id",
        )
    } else {
        getChannels(
            playlistId,
            offset,
            limit,
            selection = "playlist_id = ? AND radio = ?",
            selectionArgs = arrayOf(playlistId, if (radioOnly) "1" else "0"),
            orderBy = if (sortByName) channelNameOrder(descending) else "source_order, id",
        )
    }

    /** Stable group/name ordering for the TV live-player picker, applied before pagination. */
    fun getGroupedChannelPage(
        playlistId: String,
        offset: Int,
        limit: Int = 500,
        radioOnly: Boolean,
    ): List<TvChannel> = getChannels(
        playlistId = playlistId,
        offset = offset,
        limit = limit,
        selection = "playlist_id = ? AND radio = ?",
        selectionArgs = arrayOf(playlistId, if (radioOnly) "1" else "0"),
        orderBy = "COALESCE(NULLIF(TRIM(group_name), ''), 'Sin grupo') COLLATE NOCASE, " +
            "COALESCE(NULLIF(TRIM(group_name), ''), 'Sin grupo') COLLATE BINARY, name COLLATE NOCASE, id",
    )

    /** Loads one bounded group window without walking unrelated channels. */
    fun getChannelGroupPage(
        playlistId: String,
        groupName: String,
        offset: Int,
        limit: Int = 500,
        radioOnly: Boolean,
        sortByName: Boolean = false,
        descending: Boolean = false,
    ): List<TvChannel> = getChannels(
        playlistId = playlistId,
        offset = offset,
        limit = limit,
        selection = "playlist_id = ? AND radio = ? AND TRIM(group_name) COLLATE NOCASE = ?",
        selectionArgs = arrayOf(playlistId, if (radioOnly) "1" else "0", groupName.trim()),
        orderBy = if (sortByName) channelNameOrder(descending) else "source_order, id",
    )

    /** Returns complete group counts without materialising the channel catalogue. */
    fun getChannelGroupCounts(playlistId: String, radioOnly: Boolean = false): Map<String, Int> {
        val result = linkedMapOf<String, Int>()
        readableDatabase.rawQuery(
            "SELECT (SELECT TRIM(canonical.group_name) FROM channels AS canonical " +
                "WHERE canonical.playlist_id = grouped.playlist_id AND canonical.radio = grouped.radio " +
                "AND TRIM(canonical.group_name) COLLATE NOCASE = grouped.group_key COLLATE NOCASE " +
                "ORDER BY canonical.source_order, canonical.id LIMIT 1), grouped.channel_count " +
                "FROM (SELECT playlist_id, radio, TRIM(group_name) AS group_key, COUNT(*) AS channel_count, " +
                "MIN(source_order) AS first_source_order " +
                "FROM channels WHERE playlist_id = ? AND radio = ? AND group_name IS NOT NULL " +
                "AND TRIM(group_name) <> '' GROUP BY TRIM(group_name) COLLATE NOCASE) AS grouped " +
                "ORDER BY grouped.first_source_order, grouped.group_key COLLATE NOCASE",
            arrayOf(playlistId, if (radioOnly) "1" else "0"),
        ).use { rows ->
            while (rows.moveToNext()) {
                val group = rows.getString(0)
                if (group.isNotEmpty()) result[group] = rows.getInt(1)
            }
        }
        return result
    }

    fun getChannel(playlistId: String, channelId: String): TvChannel? =
        getChannels(
            playlistId,
            offset = 0,
            limit = 1,
            selection = "playlist_id = ? AND id = ?",
            selectionArgs = arrayOf(playlistId, "$playlistId:$channelId"),
        ).firstOrNull()

    fun getChannelsByIds(playlistId: String, channelIds: List<String>, radioOnly: Boolean? = null): List<TvChannel> =
        channelIds.distinct().chunked(800).flatMap { ids ->
            if (ids.isEmpty()) emptyList() else {
                val selection = buildString {
                    append("playlist_id = ? AND id IN (${ids.joinToString(",") { "?" }})")
                    if (radioOnly != null) append(" AND radio = ?")
                }
                val args = buildList {
                    add(playlistId)
                    ids.forEach { add("$playlistId:$it") }
                    radioOnly?.let { add(if (it) "1" else "0") }
                }.toTypedArray()
                getChannels(playlistId, limit = ids.size, selection = selection, selectionArgs = args)
            }
        }

    fun getChannelAtPosition(playlistId: String, position: Int, radioOnly: Boolean? = null): TvChannel? {
        val selection = if (radioOnly == null) {
            "playlist_id = ?"
        } else {
            "playlist_id = ? AND radio = ?"
        }
        val args = if (radioOnly == null) {
            arrayOf(playlistId)
        } else {
            arrayOf(playlistId, if (radioOnly) "1" else "0")
        }
        return getChannels(playlistId, position.coerceAtLeast(0), 1, selection, args).firstOrNull()
    }

    /** Resolves a zero-based offset across playlist blocks without loading their channel lists. */
    fun getChannelAtPositionAcrossPlaylists(
        playlistIds: List<String>,
        position: Int,
        radioOnly: Boolean,
    ): Pair<String, TvChannel>? {
        if (position < 0) return null
        var remaining = position
        playlistIds.distinct().forEach { playlistId ->
            val counts = getPlaylistCounts(playlistId)
            val channelCount = if (radioOnly) counts.radio else counts.channels - counts.radio
            if (remaining < channelCount) {
                return getChannelAtPosition(playlistId, remaining, radioOnly)?.let { playlistId to it }
            }
            remaining -= channelCount
        }
        return null
    }

    fun getChannelByNumber(playlistId: String, number: Int, radioOnly: Boolean? = null): TvChannel? {
        val selection = if (radioOnly == null) {
            "playlist_id = ? AND channel_number = ?"
        } else {
            "playlist_id = ? AND channel_number = ? AND radio = ?"
        }
        val args = if (radioOnly == null) {
            arrayOf(playlistId, number.toString())
        } else {
            arrayOf(playlistId, number.toString(), if (radioOnly) "1" else "0")
        }
        return getChannels(playlistId, 0, 1, selection, args).firstOrNull()
    }

    fun getAdjacentChannel(playlistId: String, channelId: String, delta: Int): TvChannel? =
        getAdjacentChannelInScope(playlistId, channelId, delta)

    /** Indexed one-row channel stepping inside the list scope that launched playback. */
    fun getAdjacentChannelInScope(
        playlistId: String,
        channelId: String,
        delta: Int,
        groupName: String? = null,
        providerCategoryId: String? = null,
        sortByName: Boolean = false,
        descending: Boolean = false,
        wrap: Boolean = true,
        hiddenGroupTitles: List<String> = emptyList(),
        hiddenCategoryIds: List<String> = emptyList(),
    ): TvChannel? {
        if (delta == 0) return getChannel(playlistId, channelId)
        val current = getChannel(playlistId, channelId) ?: return null
        val currentId = "$playlistId:$channelId"
        val conditions = mutableListOf("playlist_id = ?", "radio = ?")
        val baseArgs = mutableListOf(playlistId, if (current.radio) "1" else "0")
        groupName?.takeIf(String::isNotBlank)?.let { group ->
            conditions += "TRIM(group_name) COLLATE NOCASE = ?"
            baseArgs += group.trim()
        }
        providerCategoryId?.takeIf(String::isNotBlank)?.let { categoryId ->
            conditions += "provider_category_id COLLATE NOCASE = ?"
            baseArgs += categoryId.trim()
        }
        val hiddenGroups = hiddenGroupTitles.map(String::trim).filter(String::isNotBlank).distinct()
        if (hiddenGroups.isNotEmpty()) {
            conditions += "(group_name IS NULL OR group_name COLLATE NOCASE NOT IN (${hiddenGroups.joinToString(",") { "?" }}))"
            baseArgs += hiddenGroups
        }
        val hiddenCategories = hiddenCategoryIds.map(String::trim).filter(String::isNotBlank).distinct()
        if (hiddenCategories.isNotEmpty()) {
            conditions += "(provider_category_id IS NULL OR provider_category_id COLLATE NOCASE NOT IN (${hiddenCategories.joinToString(",") { "?" }}))"
            baseArgs += hiddenCategories
        }
        val baseSelection = conditions.joinToString(" AND ")

        // delta is relative to the visible order. A negative delta in a
        // descending name sort therefore moves toward larger SQL values.
        val comparisonMovesUp = (delta > 0) xor (sortByName && descending)
        val comparison = if (comparisonMovesUp) ">" else "<"
        val traversalDescending = if (delta > 0) sortByName && descending else !(sortByName && descending)
        val direction = if (traversalDescending) "DESC" else "ASC"
        val orderBy = if (sortByName) {
            "name COLLATE NOCASE $direction, id $direction"
        } else {
            "source_order $direction, id $direction"
        }
        val cursor = if (sortByName) {
            "(name COLLATE NOCASE $comparison ? COLLATE NOCASE OR " +
                "(name COLLATE NOCASE = ? COLLATE NOCASE AND id $comparison ?))"
        } else {
            "(source_order $comparison (SELECT source_order FROM channels WHERE id = ?) OR " +
                "(source_order = (SELECT source_order FROM channels WHERE id = ?) AND id $comparison ?))"
        }
        val cursorArgs = if (sortByName) {
            arrayOf(current.name, current.name, currentId)
        } else {
            arrayOf(currentId, currentId, currentId)
        }
        getChannels(
            playlistId = playlistId,
            limit = 1,
            selection = "$baseSelection AND $cursor",
            selectionArgs = (baseArgs + cursorArgs).toTypedArray(),
            orderBy = orderBy,
        ).firstOrNull()?.let { return it }

        if (!wrap) return null

        // Wrap without counting/materializing a potentially very large Xtream catalogue.
        return getChannels(
            playlistId = playlistId,
            limit = 1,
            selection = "$baseSelection AND id != ?",
            selectionArgs = (baseArgs + currentId).toTypedArray(),
            orderBy = orderBy,
        ).firstOrNull()
    }

    /** Moves between concatenated playlist blocks while issuing only one-row indexed queries. */
    fun getAdjacentChannelAcrossPlaylists(
        playlistIds: List<String>,
        playlistId: String,
        channelId: String,
        delta: Int,
        groupName: String? = null,
        providerCategoryId: String? = null,
        sortByName: Boolean = false,
        descending: Boolean = false,
        hiddenGroupTitlesByPlaylist: Map<String, List<String>> = emptyMap(),
        hiddenCategoryIdsByPlaylist: Map<String, List<String>> = emptyMap(),
    ): Pair<String, TvChannel>? {
        if (delta == 0) return getChannel(playlistId, channelId)?.let { playlistId to it }
        val sources = playlistIds.distinct()
        val currentSourceIndex = sources.indexOf(playlistId)
        if (currentSourceIndex < 0) return null
        val current = getChannel(playlistId, channelId) ?: return null
        val localNext = getAdjacentChannelInScope(
            playlistId = playlistId,
            channelId = channelId,
            delta = delta,
            groupName = groupName,
            providerCategoryId = providerCategoryId,
            sortByName = sortByName,
            descending = descending,
            wrap = false,
            hiddenGroupTitles = hiddenGroupTitlesByPlaylist[playlistId].orEmpty(),
            hiddenCategoryIds = hiddenCategoryIdsByPlaylist[playlistId].orEmpty(),
        )
        if (localNext != null) return playlistId to localNext

        val lastInBlock = delta < 0
        for (offset in 1..sources.size) {
            val sourceIndex = Math.floorMod(
                currentSourceIndex + if (delta > 0) offset else -offset,
                sources.size,
            )
            val candidatePlaylistId = sources[sourceIndex]
            val edge = getChannelInScopeEdge(
                playlistId = candidatePlaylistId,
                radioOnly = current.radio,
                groupName = groupName,
                providerCategoryId = providerCategoryId,
                sortByName = sortByName,
                descending = descending,
                last = lastInBlock,
                hiddenGroupTitles = hiddenGroupTitlesByPlaylist[candidatePlaylistId].orEmpty(),
                hiddenCategoryIds = hiddenCategoryIdsByPlaylist[candidatePlaylistId].orEmpty(),
            ) ?: continue
            if (candidatePlaylistId != playlistId || edge.id != channelId) {
                return candidatePlaylistId to edge
            }
        }
        return null
    }

    private fun getChannelInScopeEdge(
        playlistId: String,
        radioOnly: Boolean,
        groupName: String?,
        providerCategoryId: String?,
        sortByName: Boolean,
        descending: Boolean,
        last: Boolean,
        hiddenGroupTitles: List<String>,
        hiddenCategoryIds: List<String>,
    ): TvChannel? {
        val conditions = mutableListOf("playlist_id = ?", "radio = ?")
        val args = mutableListOf(playlistId, if (radioOnly) "1" else "0")
        groupName?.takeIf(String::isNotBlank)?.let { group ->
            conditions += "TRIM(group_name) COLLATE NOCASE = ?"
            args += group.trim()
        }
        providerCategoryId?.takeIf(String::isNotBlank)?.let { categoryId ->
            conditions += "provider_category_id COLLATE NOCASE = ?"
            args += categoryId.trim()
        }
        hiddenGroupTitles.map(String::trim).filter(String::isNotBlank).distinct().takeIf { it.isNotEmpty() }?.let { hidden ->
            conditions += "(group_name IS NULL OR group_name COLLATE NOCASE NOT IN (${hidden.joinToString(",") { "?" }}))"
            args += hidden
        }
        hiddenCategoryIds.map(String::trim).filter(String::isNotBlank).distinct().takeIf { it.isNotEmpty() }?.let { hidden ->
            conditions += "(provider_category_id IS NULL OR provider_category_id COLLATE NOCASE NOT IN (${hidden.joinToString(",") { "?" }}))"
            args += hidden
        }
        val descendingOrder = if (sortByName) descending else false
        val reverseOrder = last xor descendingOrder
        val direction = if (reverseOrder) "DESC" else "ASC"
        val orderBy = if (sortByName) {
            "name COLLATE NOCASE $direction, id $direction"
        } else {
            "source_order $direction, id $direction"
        }
        return getChannels(
            playlistId = playlistId,
            limit = 1,
            selection = conditions.joinToString(" AND "),
            selectionArgs = args.toTypedArray(),
            orderBy = orderBy,
        ).firstOrNull()
    }

    fun searchChannels(
        playlistId: String,
        query: String,
        limit: Int = 200,
        radioOnly: Boolean? = null,
        offset: Int = 0,
        sortByName: Boolean = false,
        descending: Boolean = false,
    ): List<TvChannel> {
        val selection = buildString {
            append("playlist_id = ? AND (name LIKE ? COLLATE NOCASE OR group_name LIKE ? COLLATE NOCASE)")
            if (radioOnly != null) append(" AND radio = ?")
        }
        val selectionArgs = buildList {
            add(playlistId)
            add("%${query.trim()}%")
            add("%${query.trim()}%")
            radioOnly?.let { add(if (it) "1" else "0") }
        }.toTypedArray()
        return getChannels(
            playlistId,
            offset = offset,
            limit = limit,
            selection = selection,
            selectionArgs = selectionArgs,
            orderBy = if (sortByName) channelNameOrder(descending) else "source_order, id",
        )
    }

    private fun channelNameOrder(descending: Boolean): String =
        if (descending) "name COLLATE NOCASE DESC, id DESC" else "name COLLATE NOCASE, id"

    fun countMatchingChannels(playlistId: String, query: String, radioOnly: Boolean? = null): Int {
        val sql = buildString {
            append("SELECT COUNT(*) FROM channels WHERE playlist_id = ? AND (name LIKE ? COLLATE NOCASE OR group_name LIKE ? COLLATE NOCASE)")
            if (radioOnly != null) append(" AND radio = ?")
        }
        val args = buildList {
            add(playlistId)
            add("%${query.trim()}%")
            add("%${query.trim()}%")
            radioOnly?.let { add(if (it) "1" else "0") }
        }.toTypedArray()
        return readableDatabase.rawQuery(sql, args).use { cursor ->
            if (cursor.moveToFirst()) cursor.getLong(0).coerceAtMost(Int.MAX_VALUE.toLong()).toInt() else 0
        }
    }

    /** Loads a later catalogue window without materialising the whole provider catalogue. */
    fun getVodPage(playlistId: String, offset: Int, limit: Int = 500): List<TvVodItem> =
        getVod(playlistId, offset, limit)

    /** Returns every non-empty VOD category without being limited to the startup window. */
    fun getVodCategories(playlistId: String): List<String> = distinctCategories("vod", playlistId)

    fun getVodCategoryMappings(playlistId: String): List<TvCatalogCategoryMapping> =
        distinctCategoryMappings("vod", playlistId)

    fun getVodCategoryPage(playlistId: String, categoryId: String, offset: Int, limit: Int = 500): List<TvVodItem> =
        getVod(
            playlistId,
            offset,
            limit,
            "playlist_id = ? AND category_id = ?",
            "name COLLATE NOCASE, id",
            arrayOf(playlistId, categoryId),
        )

    fun getVodItem(playlistId: String, vodId: Int): TvVodItem? =
        getVod(
            playlistId = playlistId,
            offset = 0,
            limit = 1,
            selection = "playlist_id = ? AND xtream_id = ?",
            orderBy = "name COLLATE NOCASE",
            selectionArgs = arrayOf(playlistId, vodId.toString()),
        ).firstOrNull()

    fun searchVod(
        playlistId: String,
        query: String,
        limit: Int = 200,
        offset: Int = 0,
        categoryId: String? = null,
    ): List<TvVodItem> {
        val normalized = query.trim()
        if (normalized.isBlank()) return emptyList()
        val selection = buildString {
            append("playlist_id = ? AND name LIKE ? COLLATE NOCASE")
            if (!categoryId.isNullOrBlank()) append(" AND category_id = ?")
        }
        val args = buildList {
            add(playlistId)
            add("%$normalized%")
            categoryId?.takeIf(String::isNotBlank)?.let(::add)
        }.toTypedArray()
        return getVod(
            playlistId = playlistId,
            offset = offset,
            limit = limit,
            selection = selection,
            orderBy = "name COLLATE NOCASE",
            selectionArgs = args,
        )
    }

    /** Returns the newest catalogue rows directly from SQLite, independent of the name-sorted startup window. */
    fun getRecentVodPage(playlistId: String, limit: Int = 100): List<TvVodItem> =
        getVod(playlistId, 0, limit, "playlist_id = ? AND added_at_ms IS NOT NULL", "added_at_ms DESC, name COLLATE NOCASE")

    /** Loads a later series window without materialising the whole provider catalogue. */
    fun getSeriesPage(playlistId: String, offset: Int, limit: Int = 500): List<TvSeriesItem> =
        getSeries(playlistId, offset, limit)

    /** Returns every non-empty series category without being limited to the startup window. */
    fun getSeriesCategories(playlistId: String): List<String> = distinctCategories("series", playlistId)

    fun getSeriesCategoryMappings(playlistId: String): List<TvCatalogCategoryMapping> =
        distinctCategoryMappings("series", playlistId)

    fun getSeriesCategoryPage(playlistId: String, categoryId: String, offset: Int, limit: Int = 500): List<TvSeriesItem> =
        getSeries(
            playlistId,
            offset,
            limit,
            "playlist_id = ? AND category_id = ?",
            "name COLLATE NOCASE",
            arrayOf(playlistId, categoryId),
        )

    fun getSeriesItem(playlistId: String, seriesId: Int): TvSeriesItem? =
        getSeries(
            playlistId = playlistId,
            offset = 0,
            limit = 1,
            selection = "playlist_id = ? AND xtream_id = ?",
            orderBy = "name COLLATE NOCASE",
            selectionArgs = arrayOf(playlistId, seriesId.toString()),
        ).firstOrNull()

    fun searchSeries(
        playlistId: String,
        query: String,
        limit: Int = 200,
        offset: Int = 0,
        categoryId: String? = null,
    ): List<TvSeriesItem> {
        val normalized = query.trim()
        if (normalized.isBlank()) return emptyList()
        val selection = buildString {
            append("playlist_id = ? AND name LIKE ? COLLATE NOCASE")
            if (!categoryId.isNullOrBlank()) append(" AND category_id = ?")
        }
        val args = buildList {
            add(playlistId)
            add("%$normalized%")
            categoryId?.takeIf(String::isNotBlank)?.let(::add)
        }.toTypedArray()
        return getSeries(
            playlistId = playlistId,
            offset = offset,
            limit = limit,
            selection = selection,
            orderBy = "name COLLATE NOCASE",
            selectionArgs = args,
        )
    }

    /** Returns the newest series rows directly from SQLite, independent of the name-sorted startup window. */
    fun getRecentSeriesPage(playlistId: String, limit: Int = 100): List<TvSeriesItem> =
        getSeries(playlistId, 0, limit, "playlist_id = ? AND added_at_ms IS NOT NULL", "added_at_ms DESC, name COLLATE NOCASE")

    fun setFavorite(item: TvSavedItem, favorite: Boolean) {
        val db = writableDatabase
        if (favorite) {
            val alreadyFavorite = db.query(
                "saved_items",
                arrayOf("is_favorite"),
                "playlist_id = ? AND item_type = ? AND item_key = ?",
                arrayOf(item.playlistId, item.itemType.name, item.itemKey),
                null,
                null,
                null,
            ).use { rows -> rows.moveToFirst() && rows.getInt(0) != 0 }
            if (alreadyFavorite) return
            val updated = db.update("saved_items", ContentValues().apply {
                put("is_favorite", 1)
                putNull("global_favorite_order")
                putNull("playlist_favorite_order")
            }, "playlist_id = ? AND item_type = ? AND item_key = ?", arrayOf(item.playlistId, item.itemType.name, item.itemKey))
            if (updated > 0) return
            db.insertWithOnConflict("saved_items", null, ContentValues().apply {
                put("id", savedItemId(item.playlistId, item.itemType, item.itemKey))
                put("playlist_id", item.playlistId)
                put("item_type", item.itemType.name)
                put("item_key", item.itemKey)
                put("title", item.title)
                put("uri", item.uri)
                put("cover_url", item.coverUrl)
                put("saved_at", item.savedAt)
                put("is_favorite", 1)
                put("is_watched", if (item.isWatched) 1 else 0)
                putNull("global_favorite_order")
                putNull("playlist_favorite_order")
            }, SQLiteDatabase.CONFLICT_REPLACE)
        } else {
            db.execSQL("UPDATE saved_items SET is_favorite = 0, global_favorite_order = NULL, playlist_favorite_order = NULL WHERE playlist_id = ? AND item_type = ? AND item_key = ?", arrayOf(item.playlistId, item.itemType.name, item.itemKey))
            db.delete(
                "saved_items",
                "playlist_id = ? AND item_type = ? AND item_key = ? AND last_played_at IS NULL AND is_watched = 0",
                arrayOf(item.playlistId, item.itemType.name, item.itemKey),
            )
        }
    }

    /** Persists the manual order of live-channel favorites in the selected scope. */
    fun updateFavoriteOrder(items: List<TvSavedItem>, playlistId: String? = null) {
        val db = writableDatabase
        val orderColumn = if (playlistId == null) "global_favorite_order" else "playlist_favorite_order"
        val scopeClause = if (playlistId == null) "" else " AND playlist_id = ?"
        val scopeArgs = if (playlistId == null) emptyArray() else arrayOf(playlistId)
        db.beginTransaction()
        try {
            db.execSQL(
                "UPDATE saved_items SET $orderColumn = NULL WHERE item_type = ? AND is_favorite = 1$scopeClause",
                arrayOf(TvSavedItemType.CHANNEL.name, *scopeArgs),
            )
            items.asSequence()
                .filter { it.itemType == TvSavedItemType.CHANNEL && it.isFavorite }
                .filter { playlistId == null || it.playlistId == playlistId }
                .forEachIndexed { index, item ->
                    db.execSQL(
                        "UPDATE saved_items SET $orderColumn = ? WHERE playlist_id = ? AND item_type = ? AND item_key = ? AND is_favorite = 1",
                        arrayOf<Any>(index, item.playlistId, item.itemType.name, item.itemKey),
                    )
                }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** Clears a content type's favorites without deleting independent history or watched state. */
    fun clearFavorites(itemType: TvSavedItemType, playlistId: String? = null): Int {
        val db = writableDatabase
        val scopeClause = if (playlistId == null) "" else " AND playlist_id = ?"
        val args = if (playlistId == null) arrayOf(itemType.name) else arrayOf(itemType.name, playlistId)
        db.beginTransaction()
        try {
            val favoriteIds = mutableListOf<String>()
            db.query(
                "saved_items",
                arrayOf("id"),
                "item_type = ? AND is_favorite = 1$scopeClause",
                args,
                null,
                null,
                null,
            ).use { rows -> while (rows.moveToNext()) favoriteIds += rows.getString(0) }
            if (favoriteIds.isEmpty()) {
                db.setTransactionSuccessful()
                return 0
            }
            favoriteIds.chunked(500).forEach { ids ->
                val placeholders = ids.joinToString(",") { "?" }
                val chunkArgs = ids.toTypedArray()
                db.update(
                    "saved_items",
                    ContentValues().apply {
                        put("is_favorite", 0)
                        putNull("global_favorite_order")
                        putNull("playlist_favorite_order")
                    },
                    "id IN ($placeholders)",
                    chunkArgs,
                )
                db.delete(
                    "saved_items",
                    "id IN ($placeholders) AND last_played_at IS NULL AND is_watched = 0",
                    chunkArgs,
                )
            }
            db.setTransactionSuccessful()
            return favoriteIds.size
        } finally {
            db.endTransaction()
        }
    }

    fun restoreSavedItem(item: TvSavedItem) {
        writableDatabase.insertWithOnConflict(
            "saved_items",
            null,
            ContentValues().apply {
                put("id", savedItemId(item.playlistId, item.itemType, item.itemKey))
                put("playlist_id", item.playlistId)
                put("item_type", item.itemType.name)
                put("item_key", item.itemKey)
                put("title", item.title)
                put("uri", item.uri)
                put("cover_url", item.coverUrl)
                put("saved_at", item.savedAt)
                put("last_played_at", item.lastPlayedAt)
                put("is_favorite", if (item.isFavorite) 1 else 0)
                put("resume_position_ms", item.resumePositionMs.coerceAtLeast(0L))
                put("is_watched", if (item.isWatched) 1 else 0)
                put("global_favorite_order", item.globalFavoriteOrder)
                put("playlist_favorite_order", item.playlistFavoriteOrder)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    /** Updates recent order without eviction: this row can also own favorite or watched state. */
    fun recordPlayback(item: TvSavedItem) {
        val now = System.currentTimeMillis()
        val db = writableDatabase
        val updated = db.update("saved_items", ContentValues().apply { put("last_played_at", now) }, "playlist_id = ? AND item_type = ? AND item_key = ?", arrayOf(item.playlistId, item.itemType.name, item.itemKey))
        if (updated == 0) db.insertWithOnConflict("saved_items", null, ContentValues().apply {
            put("id", savedItemId(item.playlistId, item.itemType, item.itemKey))
            put("playlist_id", item.playlistId)
            put("item_type", item.itemType.name)
            put("item_key", item.itemKey)
            put("title", item.title)
            put("uri", item.uri)
            put("cover_url", item.coverUrl)
            put("saved_at", item.savedAt)
            put("last_played_at", now)
            put("is_favorite", 0)
            put("resume_position_ms", item.resumePositionMs)
            put("is_watched", if (item.isWatched) 1 else 0)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun recordPlaybackPosition(item: TvSavedItem, positionMs: Long, durationMs: Long) {
        val normalized = if (durationMs > 0L && positionMs >= (durationMs - 30_000L).coerceAtLeast(0L)) 0L else positionMs.coerceAtLeast(0L)
        val watched = durationMs > 0L && positionMs >= (durationMs - 30_000L).coerceAtLeast(0L)
        val updated = writableDatabase.update(
            "saved_items",
            ContentValues().apply {
                put("last_played_at", System.currentTimeMillis())
                put("resume_position_ms", normalized)
                if (watched) put("is_watched", 1)
            },
            "playlist_id = ? AND item_type = ? AND item_key = ?",
            arrayOf(item.playlistId, item.itemType.name, item.itemKey),
        )
        if (updated == 0) recordPlayback(item.copy(resumePositionMs = normalized, isWatched = item.isWatched || watched))
    }

    fun setWatched(item: TvSavedItem, watched: Boolean) {
        val db = writableDatabase
        val updated = db.update(
            "saved_items",
            ContentValues().apply { put("is_watched", if (watched) 1 else 0) },
            "playlist_id = ? AND item_type = ? AND item_key = ?",
            arrayOf(item.playlistId, item.itemType.name, item.itemKey),
        )
        if (updated == 0) {
            db.insertWithOnConflict("saved_items", null, ContentValues().apply {
                put("id", savedItemId(item.playlistId, item.itemType, item.itemKey))
                put("playlist_id", item.playlistId)
                put("item_type", item.itemType.name)
                put("item_key", item.itemKey)
                put("title", item.title)
                put("uri", item.uri)
                put("cover_url", item.coverUrl)
                put("saved_at", item.savedAt)
                put("last_played_at", item.lastPlayedAt)
                put("is_favorite", if (item.isFavorite) 1 else 0)
                put("resume_position_ms", item.resumePositionMs.coerceAtLeast(0L))
                put("is_watched", if (watched) 1 else 0)
            }, SQLiteDatabase.CONFLICT_REPLACE)
        }
    }

    /** Removes only the recent-playback marker, preserving favorites and watched state. */
    fun removeFromHistory(item: TvSavedItem) {
        val db = writableDatabase
        db.update(
            "saved_items",
            ContentValues().apply {
                putNull("last_played_at")
                put("resume_position_ms", 0L)
            },
            "playlist_id = ? AND item_type = ? AND item_key = ?",
            arrayOf(item.playlistId, item.itemType.name, item.itemKey),
        )
        db.delete(
            "saved_items",
            "playlist_id = ? AND item_type = ? AND item_key = ? AND is_favorite = 0 AND is_watched = 0 AND last_played_at IS NULL",
            arrayOf(item.playlistId, item.itemType.name, item.itemKey),
        )
    }

    /** Clears recent-playback markers without deleting favorites or watched state. */
    fun clearHistory(playlistId: String? = null) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val selection = playlistId?.let { "playlist_id = ? AND last_played_at IS NOT NULL" }
                ?: "last_played_at IS NOT NULL"
            val args = playlistId?.let { arrayOf(it) }
            db.update(
                "saved_items",
                ContentValues().apply {
                    putNull("last_played_at")
                    put("resume_position_ms", 0L)
                },
                selection,
                args,
            )
            val staleSelection = playlistId?.let {
                "playlist_id = ? AND is_favorite = 0 AND is_watched = 0 AND last_played_at IS NULL"
            } ?: "is_favorite = 0 AND is_watched = 0 AND last_played_at IS NULL"
            db.delete("saved_items", staleSelection, args)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun recordEpisodeProgress(playlistId: String, seriesId: Int, episodeId: Int, positionMs: Long, durationMs: Long) {
        val safeDuration = durationMs.coerceAtLeast(0L)
        val completed = safeDuration > 0L && positionMs >= (safeDuration - 30_000L).coerceAtLeast(0L)
        val normalized = if (completed) 0L else positionMs.coerceAtLeast(0L)
        writableDatabase.insertWithOnConflict(
            "episode_progress",
            null,
            ContentValues().apply {
                put("playlist_id", playlistId)
                put("series_id", seriesId)
                put("episode_id", episodeId)
                put("position_ms", normalized)
                put("duration_ms", safeDuration)
                put("completed", if (completed) 1 else 0)
                put("updated_at", System.currentTimeMillis())
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun restoreEpisodeProgress(progress: TvEpisodeProgress) {
        writableDatabase.insertWithOnConflict(
            "episode_progress",
            null,
            ContentValues().apply {
                put("playlist_id", progress.playlistId)
                put("series_id", progress.seriesId)
                put("episode_id", progress.episodeId)
                put("position_ms", progress.positionMs.coerceAtLeast(0L))
                put("duration_ms", progress.durationMs.coerceAtLeast(0L))
                put("completed", if (progress.completed) 1 else 0)
                put("updated_at", progress.updatedAt)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    /** Marks or clears a set of episodes atomically for the TV watched toggles. */
    fun setEpisodesWatched(
        playlistId: String,
        seriesId: Int,
        episodeIds: Collection<Int>,
        watched: Boolean,
    ) {
        if (episodeIds.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            episodeIds.distinct().forEach { episodeId ->
                if (watched) {
                    val existing = db.query(
                        "episode_progress",
                        arrayOf("duration_ms"),
                        "playlist_id = ? AND series_id = ? AND episode_id = ?",
                        arrayOf(playlistId, seriesId.toString(), episodeId.toString()),
                        null,
                        null,
                        null,
                    ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
                    db.insertWithOnConflict(
                        "episode_progress",
                        null,
                        ContentValues().apply {
                            put("playlist_id", playlistId)
                            put("series_id", seriesId)
                            put("episode_id", episodeId)
                            put("position_ms", existing.coerceAtLeast(1L))
                            put("duration_ms", existing.coerceAtLeast(0L))
                            put("completed", 1)
                            put("updated_at", System.currentTimeMillis())
                        },
                        SQLiteDatabase.CONFLICT_REPLACE,
                    )
                } else {
                    db.delete(
                        "episode_progress",
                        "playlist_id = ? AND series_id = ? AND episode_id = ?",
                        arrayOf(playlistId, seriesId.toString(), episodeId.toString()),
                    )
                }
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun getEpisodeProgress(playlistId: String, seriesId: Int): Map<Int, TvEpisodeProgress> {
        val result = mutableMapOf<Int, TvEpisodeProgress>()
        readableDatabase.query(
            "episode_progress",
            arrayOf("episode_id", "position_ms", "duration_ms", "completed", "updated_at"),
            "playlist_id = ? AND series_id = ?",
            arrayOf(playlistId, seriesId.toString()),
            null,
            null,
            "updated_at DESC",
        ).use { rows ->
            while (rows.moveToNext()) {
                val episodeId = rows.getInt(0)
                result[episodeId] = TvEpisodeProgress(
                    playlistId = playlistId,
                    seriesId = seriesId,
                    episodeId = episodeId,
                    positionMs = rows.getLong(1),
                    durationMs = rows.getLong(2),
                    completed = rows.getInt(3) != 0,
                    updatedAt = rows.getLong(4),
                )
            }
        }
        return result
    }

    fun getEpisodeProgressForPlaylist(playlistId: String): List<TvEpisodeProgress> {
        val result = mutableListOf<TvEpisodeProgress>()
        readableDatabase.query(
            "episode_progress",
            arrayOf("series_id", "episode_id", "position_ms", "duration_ms", "completed", "updated_at"),
            "playlist_id = ?",
            arrayOf(playlistId),
            null,
            null,
            "updated_at DESC",
        ).use { rows ->
            while (rows.moveToNext()) result += TvEpisodeProgress(
                playlistId = playlistId,
                seriesId = rows.getInt(0),
                episodeId = rows.getInt(1),
                positionMs = rows.getLong(2),
                durationMs = rows.getLong(3),
                completed = rows.getInt(4) != 0,
                updatedAt = rows.getLong(5),
            )
        }
        return result
    }

    fun getFavorites(): List<TvSavedItem> = getSavedItems("saved_items.saved_at DESC", "saved_items.is_favorite = 1")

    fun getHistory(): List<TvSavedItem> = getSavedItems("saved_items.last_played_at DESC", "saved_items.last_played_at IS NOT NULL")

    fun getWatched(): List<TvSavedItem> = getSavedItems("saved_items.saved_at DESC", "saved_items.is_watched = 1")

    fun deletePlaylist(id: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            // Keep deletion correct even for databases created before foreign-key
            // enforcement was enabled on every connection.
            db.delete("episode_progress", "playlist_id = ?", arrayOf(id))
            db.delete("epg", "source_id = ?", arrayOf(id))
            db.delete("epg_mappings", "source_id = ?", arrayOf(id))
            db.delete("saved_items", "playlist_id = ?", arrayOf(id))
            db.delete("series", "playlist_id = ?", arrayOf(id))
            db.delete("vod", "playlist_id = ?", arrayOf(id))
            db.delete("channels", "playlist_id = ?", arrayOf(id))
            db.delete("playlists", "id = ?", arrayOf(id))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun updateEpgUrl(id: String, epgUrl: String?) {
        val normalized = epgUrl?.trim()?.takeIf(String::isNotBlank)
        setEpgUrls(id, normalized?.let(::listOf).orEmpty())
        setPrimaryEpgUrl(id, normalized)
    }

    fun getEpgUrls(sourceId: String, primary: String? = null): List<String> {
        val allStates = getEpgSourceStates(sourceId)
        val urls = allStates.filter(TvEpgSourceState::enabled).map(TvEpgSourceState::url).toMutableList()
        // Legacy playlists may only have playlists.epg_url. Do not resurrect a
        // source that exists in epg_sources but the user explicitly disabled.
        primary?.trim()?.takeIf { it.isNotBlank() && allStates.none { state -> state.url == it } }
            ?.let { urls.add(0, it) }
        return urls.distinct()
    }

    fun getEpgSourceStates(sourceId: String): List<TvEpgSourceState> {
        val result = mutableListOf<TvEpgSourceState>()
        readableDatabase.query(
            "epg_sources",
            arrayOf("url", "enabled", "detected"),
            "source_id = ?",
            arrayOf(sourceId),
            null,
            null,
            "position ASC",
        ).use { rows ->
            while (rows.moveToNext()) result += TvEpgSourceState(
                url = rows.getString(0),
                enabled = rows.getInt(1) != 0,
                detected = rows.getInt(2) != 0,
            )
        }
        return result
    }

    fun setEpgSourceEnabled(sourceId: String, url: String, enabled: Boolean): Boolean {
        val updated = writableDatabase.update(
            "epg_sources",
            ContentValues().apply { put("enabled", if (enabled) 1 else 0) },
            "source_id = ? AND url = ?",
            arrayOf(sourceId, url),
        ) > 0
        if (updated) {
            setPrimaryEpgUrl(
                sourceId,
                getEpgSourceStates(sourceId).firstOrNull(TvEpgSourceState::enabled)?.url,
            )
        }
        return updated
    }

    fun setEpgUrls(sourceId: String, urls: List<String>) {
        val normalized = urls.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        setEpgSourceStates(sourceId, normalized.map { TvEpgSourceState(it, enabled = true) })
    }

    /** Replace source inventory while retaining user choices and distinguishing header-detected URLs. */
    fun reconcileM3uEpgSources(
        sourceId: String,
        detectedUrls: List<String>,
        recommendedUrls: List<String>,
        manualUrls: List<String> = emptyList(),
    ): List<TvEpgSourceState> {
        val detected = detectedUrls.map(String::trim).filter(String::isNotBlank).distinct()
        val detectedSet = detected.toSet()
        val recommended = recommendedUrls.map(String::trim).toSet()
        val existing = getEpgSourceStates(sourceId).associateBy(TvEpgSourceState::url)
        val detectedStates = detected.map { url ->
            TvEpgSourceState(
                url = url,
                enabled = existing[url]?.enabled ?: (url in recommended),
                detected = true,
            )
        }
        val retainedManual = getEpgSourceStates(sourceId)
            .filter { !it.detected && it.url !in detectedSet }
        val explicitManual = manualUrls.map(String::trim).filter(String::isNotBlank)
            .filter { it !in detectedSet }
            .map { url -> existing[url] ?: TvEpgSourceState(url, enabled = true) }
        val states = (detectedStates + retainedManual + explicitManual)
            .distinctBy(TvEpgSourceState::url)
        setEpgSourceStates(sourceId, states)
        setPrimaryEpgUrl(sourceId, states.firstOrNull(TvEpgSourceState::enabled)?.url)
        return states
    }

    /** Apply an explicit settings/backup inventory, retaining state for URLs that remain. */
    fun updateEpgSourceConfiguration(sourceId: String, urls: List<String>): List<TvEpgSourceState> {
        val existing = getEpgSourceStates(sourceId).associateBy(TvEpgSourceState::url)
        val states = urls.map(String::trim).filter(String::isNotBlank).distinct().map { url ->
            existing[url] ?: TvEpgSourceState(url, enabled = true)
        }
        setEpgSourceStates(sourceId, states)
        setPrimaryEpgUrl(sourceId, states.firstOrNull(TvEpgSourceState::enabled)?.url)
        return states
    }

    fun setEpgSourceStates(sourceId: String, states: List<TvEpgSourceState>) {
        val normalized = states.map { it.copy(url = it.url.trim()) }
            .filter { it.url.isNotBlank() }
            .distinctBy(TvEpgSourceState::url)
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("epg_sources", "source_id = ?", arrayOf(sourceId))
            normalized.forEachIndexed { index, state ->
                db.insert("epg_sources", null, ContentValues().apply {
                    put("source_id", sourceId)
                    put("url", state.url)
                    put("position", index)
                    put("enabled", if (state.enabled) 1 else 0)
                    put("detected", if (state.detected) 1 else 0)
                })
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun setPrimaryEpgUrl(sourceId: String, url: String?) {
        writableDatabase.update(
            "playlists",
            ContentValues().apply { put("epg_url", url?.trim()?.takeIf(String::isNotBlank) as String?) },
            "id = ?",
            arrayOf(sourceId),
        )
    }

    fun updatePlaylistName(id: String, name: String): Boolean {
        return writableDatabase.update(
            "playlists",
            ContentValues().apply { put("name", name) },
            "id = ?",
            arrayOf(id),
        ) > 0
    }

    fun getHiddenGroupTitles(playlistId: String): List<String> = readableDatabase.query(
        "playlists",
        arrayOf("hidden_groups"),
        "id = ?",
        arrayOf(playlistId),
        null,
        null,
        null,
    ).use { rows ->
        if (rows.moveToFirst()) parseHiddenGroups(rows.getStringOrNull(0)) else emptyList()
    }

    fun setHiddenGroupTitles(playlistId: String, titles: List<String>): Boolean {
        val normalized = titles.map(String::trim).filter(String::isNotBlank).distinct()
        return writableDatabase.update(
            "playlists",
            ContentValues().apply { put("hidden_groups", JSONArray(normalized).toString()) },
            "id = ?",
            arrayOf(playlistId),
        ) > 0
    }

    fun getHiddenCategories(playlistId: String): List<TvHiddenCategory> = readableDatabase.query(
        "playlists",
        arrayOf("hidden_categories"),
        "id = ?",
        arrayOf(playlistId),
        null,
        null,
        null,
    ).use { rows ->
        if (rows.moveToFirst()) parseHiddenCategories(rows.getStringOrNull(0)) else emptyList()
    }

    fun setHiddenCategories(playlistId: String, categories: List<TvHiddenCategory>): Boolean {
        val normalized = categories.map { TvHiddenCategory(it.type.trim().lowercase(), it.id.trim()) }
            .filter { it.type.isNotBlank() && it.id.isNotBlank() }
            .distinct()
        return writableDatabase.update(
            "playlists",
            ContentValues().apply {
                put("hidden_categories", JSONArray().apply {
                    normalized.forEach { put(JSONObject().put("type", it.type).put("id", it.id)) }
                }.toString())
            },
            "id = ?",
            arrayOf(playlistId),
        ) > 0
    }

    private fun parseHiddenGroups(raw: String?): List<String> = runCatching {
        val array = JSONArray(raw ?: "[]")
        (0 until array.length()).mapNotNull { array.optString(it).trim().takeIf(String::isNotBlank) }.distinct()
    }.getOrDefault(emptyList())

    private fun parseHiddenCategories(raw: String?): List<TvHiddenCategory> = runCatching {
        val array = JSONArray(raw ?: "[]")
        (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val type = item.optString("type").trim().lowercase()
            val id = item.optString("id").trim()
            if (type.isBlank() || id.isBlank()) null else TvHiddenCategory(type, id)
        }.distinct()
    }.getOrDefault(emptyList())

    fun replaceEpg(sourceId: String, entries: List<TvEpgEntry>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("epg", "source_id = ?", arrayOf(sourceId))
            entries.forEach { entry -> db.insert("epg", null, ContentValues().apply {
                put("source_id", sourceId)
                put("channel_id", entry.channelId)
                put("start_ms", entry.startMs)
                put("end_ms", entry.endMs)
                put("title", entry.title)
                put("subtitle", entry.subtitle)
                put("description", entry.description)
                put("category", entry.category)
            }) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    /** Stages bounded XMLTV batches, then atomically replaces/merges the visible guide on finish. */
    fun beginEpgImport(sourceId: String, replaceExisting: Boolean): EpgImportWriter =
        EpgImportWriter(UUID.randomUUID().toString(), sourceId, replaceExisting)

    inner class EpgImportWriter internal constructor(
        private val importId: String,
        private val sourceId: String,
        private val replaceExisting: Boolean,
    ) : AutoCloseable {
        private val batch = ArrayList<TvEpgEntry>(EPG_IMPORT_BATCH_SIZE)
        private var closed = false
        private var committed = false
        var entriesWritten: Int = 0
            private set

        fun add(entry: TvEpgEntry) {
            check(!closed) { "XMLTV import writer is closed" }
            batch += entry
            entriesWritten += 1
            if (batch.size >= EPG_IMPORT_BATCH_SIZE) flush()
        }

        fun finish() {
            check(!closed) { "XMLTV import writer is closed" }
            flush()
            val db = writableDatabase
            db.beginTransaction()
            try {
                if (replaceExisting) db.delete("epg", "source_id = ?", arrayOf(sourceId))
                db.execSQL(
                    """INSERT OR REPLACE INTO epg(source_id, channel_id, start_ms, end_ms, title, subtitle, description, category)
                        SELECT source_id, channel_id, start_ms, end_ms, title, subtitle, description, category
                        FROM epg_import_staging WHERE import_id = ?""".trimIndent(),
                    arrayOf(importId),
                )
                db.delete("epg_import_staging", "import_id = ?", arrayOf(importId))
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
            committed = true
            closed = true
        }

        override fun close() {
            if (closed) return
            closed = true
            batch.clear()
            if (!committed) writableDatabase.delete("epg_import_staging", "import_id = ?", arrayOf(importId))
        }

        private fun flush() {
            if (batch.isEmpty()) return
            val db = writableDatabase
            db.beginTransaction()
            try {
                batch.forEach { entry ->
                    db.insertWithOnConflict("epg_import_staging", null, ContentValues().apply {
                        put("import_id", importId)
                        put("source_id", sourceId)
                        put("channel_id", entry.channelId)
                        put("start_ms", entry.startMs)
                        put("end_ms", entry.endMs)
                        put("title", entry.title)
                        put("subtitle", entry.subtitle)
                        put("description", entry.description)
                        put("category", entry.category)
                    }, SQLiteDatabase.CONFLICT_REPLACE)
                }
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
            batch.clear()
        }
    }

    fun clearEpg(sourceId: String) {
        writableDatabase.delete("epg", "source_id = ?", arrayOf(sourceId))
    }

    /** Cheap existence check used to avoid scanning every channel on empty guides. */
    fun hasEpg(sourceId: String): Boolean = readableDatabase.rawQuery(
        "SELECT 1 FROM epg WHERE source_id = ? LIMIT 1",
        arrayOf(sourceId),
    ).use { rows -> rows.moveToFirst() }

    fun mergeEpg(sourceId: String, entries: List<TvEpgEntry>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            entries.forEach { entry -> db.insertWithOnConflict("epg", null, ContentValues().apply {
                put("source_id", sourceId); put("channel_id", entry.channelId); put("start_ms", entry.startMs)
                put("end_ms", entry.endMs); put("title", entry.title); put("subtitle", entry.subtitle); put("description", entry.description)
                put("category", entry.category)
            }, SQLiteDatabase.CONFLICT_REPLACE) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    fun getEpg(sourceId: String, channelId: String, fromMs: Long, toMs: Long): List<TvEpgEntry> {
        val result = mutableListOf<TvEpgEntry>()
        readableDatabase.query("epg", arrayOf("channel_id", "start_ms", "end_ms", "title", "subtitle", "description", "category"),
            "source_id = ? AND channel_id = ? AND end_ms > ? AND start_ms < ?", arrayOf(sourceId, channelId, fromMs.toString(), toMs.toString()), null, null, "start_ms ASC").use { rows ->
            while (rows.moveToNext()) result += TvEpgEntry(
                rows.getString(0), rows.getLong(1), rows.getLong(2), rows.getString(3),
                rows.getStringOrNull(4), rows.getStringOrNull(5), rows.getStringOrNull(6),
            )
        }
        return result
    }

    fun getEpgForChannels(
        sourceId: String,
        channelIds: Collection<String>,
        fromMs: Long,
        toMs: Long,
    ): Map<String, List<TvEpgEntry>> {
        val ids = channelIds.asSequence().filter(String::isNotBlank).distinct().toList()
        if (ids.isEmpty()) return emptyMap()
        val result = mutableMapOf<String, MutableList<TvEpgEntry>>()
        // Android SQLite builds commonly cap bound parameters at 999. Leave
        // room for source/time arguments while batching large TV guide pages.
        ids.chunked(800).forEach { batch ->
            val placeholders = List(batch.size) { "?" }.joinToString(",")
            val args = arrayOf(sourceId) + batch + arrayOf(fromMs.toString(), toMs.toString())
            readableDatabase.query(
                "epg",
                arrayOf("channel_id", "start_ms", "end_ms", "title", "subtitle", "description", "category"),
                "source_id = ? AND channel_id IN ($placeholders) AND end_ms > ? AND start_ms < ?",
                args,
                null,
                null,
                "channel_id ASC, start_ms ASC",
            ).use { rows ->
                while (rows.moveToNext()) {
                    val channelId = rows.getString(0)
                    result.getOrPut(channelId) { mutableListOf() } += TvEpgEntry(
                        channelId = channelId,
                        startMs = rows.getLong(1),
                        endMs = rows.getLong(2),
                        title = rows.getString(3),
                        subtitle = rows.getStringOrNull(4),
                        description = rows.getStringOrNull(5),
                        category = rows.getStringOrNull(6),
                    )
                }
            }
        }
        return result
    }

    /** Searches the persisted guide, not only channel/programme pages already materialized in Compose. */
    fun searchEpgPrograms(
        playlistIds: Collection<String>,
        query: String,
        guideFilter: String,
        nowMs: Long,
        limit: Int = 20,
    ): List<StoredEpgSearchHit> {
        val sources = playlistIds.asSequence().map(String::trim).filter(String::isNotEmpty).distinct().toList()
        val term = query.trim()
        if (sources.isEmpty() || term.length < 2 || limit <= 0) return emptyList()

        val scopeClause = when (guideFilter) {
            "Favoritos" -> """
                AND EXISTS (
                    SELECT 1 FROM saved_items AS saved
                    WHERE saved.playlist_id = match.source_id
                      AND saved.item_type = 'CHANNEL' AND saved.is_favorite = 1
                      AND saved.item_key = substr(channel.id, length(match.source_id) + 2)
                )
            """.trimIndent()
            "Recientes" -> """
                AND EXISTS (
                    SELECT 1 FROM saved_items AS saved
                    WHERE saved.playlist_id = match.source_id
                      AND saved.item_type = 'CHANNEL' AND saved.last_played_at IS NOT NULL
                      AND saved.item_key = substr(channel.id, length(match.source_id) + 2)
                )
            """.trimIndent()
            "Todos" -> ""
            else -> "AND channel.group_name = ? COLLATE NOCASE"
        }
        val sourcePlaceholders = List(sources.size) { "?" }.joinToString(",")
        val sql = """
            WITH candidate_channels AS (
                -- Every channel of the programme's own playlist that the guide
                -- entry can belong to, ranked like the live screen resolves it.
                -- Joined explicitly: Android's SQLite cannot resolve outer
                -- columns inside the ORDER BY of a nested correlated subquery.
                SELECT p.rowid AS programme_row, p.source_id, p.channel_id, p.start_ms, p.end_ms,
                    p.title, p.subtitle, p.description, p.category,
                    c.id AS channel_row_id, c.source_order AS channel_order,
                    CASE
                        WHEN mapping.channel_id IS NOT NULL THEN 0
                        WHEN c.id = p.channel_id OR c.id = p.source_id || ':' || p.channel_id THEN 1
                        WHEN c.tvg_id = p.channel_id THEN 2
                        WHEN c.tvg_name = p.channel_id THEN 3
                        ELSE 4
                    END AS channel_priority
                FROM epg AS p
                JOIN channels AS c ON c.playlist_id = p.source_id
                LEFT JOIN epg_mappings AS mapping
                    ON mapping.source_id = p.source_id
                    AND mapping.channel_id = substr(c.id, length(p.source_id) + 2)
                    AND mapping.epg_channel_id = p.channel_id
                WHERE p.source_id IN ($sourcePlaceholders)
                  AND (p.title LIKE ? OR p.subtitle LIKE ? OR p.description LIKE ? OR p.category LIKE ?)
                  AND (
                      mapping.channel_id IS NOT NULL OR
                      c.id = p.channel_id OR c.id = p.source_id || ':' || p.channel_id OR
                      c.tvg_id = p.channel_id OR c.tvg_name = p.channel_id OR c.name = p.channel_id
                  )
            ),
            matched_programmes AS (
                SELECT DISTINCT candidate.programme_row, candidate.source_id, candidate.channel_id,
                    candidate.start_ms, candidate.end_ms, candidate.title, candidate.subtitle,
                    candidate.description, candidate.category,
                    (
                        SELECT best.channel_row_id FROM candidate_channels AS best
                        WHERE best.programme_row = candidate.programme_row
                        ORDER BY best.channel_priority, best.channel_order, best.channel_row_id
                        LIMIT 1
                    ) AS local_channel_id
                FROM candidate_channels AS candidate
            )
            SELECT match.source_id, match.local_channel_id, match.channel_id,
                match.start_ms, match.end_ms, match.title, match.subtitle, match.description, match.category
            FROM matched_programmes AS match
            JOIN channels AS channel ON channel.id = match.local_channel_id
            WHERE 1 = 1 $scopeClause
            ORDER BY
                CASE
                    WHEN match.start_ms <= ? AND match.end_ms > ? THEN 0
                    WHEN match.start_ms > ? THEN 1
                    ELSE 2
                END,
                CASE
                    WHEN match.start_ms <= ? AND match.end_ms > ? THEN 0
                    WHEN match.start_ms > ? THEN match.start_ms - ?
                    ELSE ? - match.end_ms
                END,
                match.start_ms ASC
            LIMIT ?
        """.trimIndent()
        val pattern = "%$term%"
        val args = buildList {
            addAll(sources)
            repeat(4) { add(pattern) }
            if (guideFilter !in setOf("Todos", "Favoritos", "Recientes")) add(guideFilter)
            repeat(8) { add(nowMs.toString()) }
            add(limit.coerceAtMost(100).toString())
        }.toTypedArray()

        data class RawHit(
            val playlistId: String,
            val localChannelId: String,
            val programme: TvEpgEntry,
        )
        val rawHits = readableDatabase.rawQuery(sql, args).use { rows ->
            buildList {
                while (rows.moveToNext()) {
                    add(
                        RawHit(
                            playlistId = rows.getString(0),
                            localChannelId = rows.getString(1).substringAfter("${rows.getString(0)}:"),
                            programme = TvEpgEntry(
                                channelId = rows.getString(2),
                                startMs = rows.getLong(3),
                                endMs = rows.getLong(4),
                                title = rows.getString(5),
                                subtitle = rows.getStringOrNull(6),
                                description = rows.getStringOrNull(7),
                                category = rows.getStringOrNull(8),
                            ),
                        ),
                    )
                }
            }
        }
        return rawHits.groupBy(RawHit::playlistId).flatMap { (sourceId, hits) ->
            val channels = getChannelsByIds(sourceId, hits.map(RawHit::localChannelId)).associateBy(TvChannel::id)
            hits.mapNotNull { hit ->
                channels[hit.localChannelId]?.let { channel ->
                    StoredEpgSearchHit(sourceId, channel, hit.programme)
                }
            }
        }
    }

    fun getEpgMappings(sourceId: String, channelIds: Collection<String>): Map<String, String> {
        val ids = channelIds.asSequence().filter(String::isNotBlank).distinct().toList()
        if (ids.isEmpty()) return emptyMap()
        val result = mutableMapOf<String, String>()
        ids.chunked(800).forEach { batch ->
            val placeholders = List(batch.size) { "?" }.joinToString(",")
            val args = arrayOf(sourceId) + batch
            readableDatabase.query(
                "epg_mappings",
                arrayOf("channel_id", "epg_channel_id"),
                "source_id = ? AND channel_id IN ($placeholders)",
                args,
                null,
                null,
                null,
            ).use { rows ->
                while (rows.moveToNext()) result[rows.getString(0)] = rows.getString(1)
            }
        }
        return result
    }

    fun getEpgMapping(sourceId: String, channelId: String): String? =
        readableDatabase.query(
            "epg_mappings",
            arrayOf("epg_channel_id"),
            "source_id = ? AND channel_id = ?",
            arrayOf(sourceId, channelId),
            null,
            null,
            null,
        ).use { rows -> if (rows.moveToFirst()) rows.getString(0) else null }

    fun setEpgMapping(sourceId: String, channelId: String, epgChannelId: String?) {
        val value = epgChannelId?.trim().orEmpty()
        if (value.isBlank()) {
            writableDatabase.delete("epg_mappings", "source_id = ? AND channel_id = ?", arrayOf(sourceId, channelId))
        } else {
            writableDatabase.insertWithOnConflict(
                "epg_mappings",
                null,
                ContentValues().apply {
                    put("source_id", sourceId)
                    put("channel_id", channelId)
                    put("epg_channel_id", value)
                },
                SQLiteDatabase.CONFLICT_REPLACE,
            )
        }
    }

    private fun getSavedItems(orderBy: String, selection: String): List<TvSavedItem> {
        val result = mutableListOf<TvSavedItem>()
        val query = """
            SELECT saved_items.playlist_id, saved_items.item_type, saved_items.item_key,
                saved_items.title, saved_items.uri, saved_items.cover_url, saved_items.saved_at,
                saved_items.last_played_at, saved_items.is_favorite, saved_items.resume_position_ms,
                saved_items.is_watched, saved_items.global_favorite_order, saved_items.playlist_favorite_order,
                CASE saved_items.item_type
                    WHEN 'CHANNEL' THEN favorite_channel.group_name
                    WHEN 'VOD' THEN COALESCE(
                        favorite_vod.category_id,
                        (SELECT m3u_vod_channel.group_name FROM channels AS m3u_vod_channel
                         WHERE m3u_vod_channel.playlist_id = saved_items.playlist_id
                           AND m3u_vod_channel.url = saved_items.uri
                         ORDER BY m3u_vod_channel.source_order LIMIT 1)
                    )
                    WHEN 'SERIES' THEN favorite_series.category_id
                    ELSE NULL
                END AS category_id
            FROM saved_items
            LEFT JOIN channels AS favorite_channel
                ON saved_items.item_type = 'CHANNEL'
                AND favorite_channel.playlist_id = saved_items.playlist_id
                AND favorite_channel.id = saved_items.playlist_id || ':' || saved_items.item_key
            LEFT JOIN vod AS favorite_vod
                ON saved_items.item_type = 'VOD'
                AND favorite_vod.id = saved_items.playlist_id || ':' || saved_items.item_key
            LEFT JOIN series AS favorite_series
                ON saved_items.item_type = 'SERIES'
                AND favorite_series.id = saved_items.playlist_id || ':' || saved_items.item_key
            WHERE $selection
            ORDER BY $orderBy
        """.trimIndent()
        readableDatabase.rawQuery(query, null).use { rows ->
            while (rows.moveToNext()) result += TvSavedItem(
                playlistId = rows.getString(0),
                itemType = TvSavedItemType.valueOf(rows.getString(1)),
                itemKey = rows.getString(2),
                title = rows.getString(3),
                uri = rows.getString(4),
                coverUrl = rows.getStringOrNull(5),
                savedAt = rows.getLong(6),
                lastPlayedAt = if (rows.isNull(7)) null else rows.getLong(7),
                isFavorite = rows.getInt(8) != 0,
                resumePositionMs = rows.getLong(9),
                isWatched = rows.getInt(10) != 0,
                globalFavoriteOrder = if (rows.isNull(11)) null else rows.getInt(11),
                playlistFavoriteOrder = if (rows.isNull(12)) null else rows.getInt(12),
                categoryId = rows.getStringOrNull(13),
            )
        }
        return result
    }

    private fun getChannels(
        playlistId: String,
        offset: Int = 0,
        limit: Int = Int.MAX_VALUE,
        selection: String = "playlist_id = ?",
        selectionArgs: Array<String> = arrayOf(playlistId),
        orderBy: String = "source_order, id",
    ): List<TvChannel> {
        val result = mutableListOf<TvChannel>()
        readableDatabase.query(
            "channels",
            arrayOf("id", "name", "url", "group_name", "provider_category_id", "logo_url", "tvg_id", "tvg_name", "user_agent", "headers", "provider_command", "stalker_http_tmp", "stalker_load_balancing", "tv_archive", "tv_archive_duration", "catchup_source", "catchup_type", "catchup_days", "radio", "channel_number", "drm_json"),
            selection,
            selectionArgs,
            null,
            null,
            orderBy,
            if (limit == Int.MAX_VALUE) null else "$limit OFFSET $offset",
        ).use { channels ->
            while (channels.moveToNext()) {
                result += TvChannel(
                    id = channels.getString(0).substringAfter("$playlistId:"),
                    name = channels.getString(1),
                    url = channels.getString(2),
                    group = channels.getStringOrNull(3),
                    providerCategoryId = channels.getStringOrNull(4),
                    logoUrl = channels.getStringOrNull(5),
                    tvgId = channels.getStringOrNull(6),
                    tvgName = channels.getStringOrNull(7),
                    userAgent = channels.getStringOrNull(8),
                    headers = channels.getStringOrNull(9)?.let(::parseHeaders) ?: emptyMap(),
                    providerCommand = channels.getStringOrNull(10),
                    useHttpTmpLink = channels.getBooleanOrNull(11),
                    useLoadBalancing = channels.getBooleanOrNull(12),
                    tvArchive = channels.getInt(13) != 0,
                    tvArchiveDurationMinutes = channels.getInt(14),
                    catchupSource = channels.getStringOrNull(15),
                    catchupType = channels.getStringOrNull(16),
                    catchupDays = channels.getInt(17),
                    radio = channels.getInt(18) != 0,
                    channelNumber = if (channels.isNull(19)) null else channels.getInt(19),
                    drm = channels.getStringOrNull(20)?.let(::parseDrm),
                )
            }
        }
        return result
    }

    private fun distinctCategories(table: String, playlistId: String): List<String> {
        val result = mutableListOf<String>()
        readableDatabase.query(
            table,
            arrayOf("category_id"),
            "playlist_id = ? AND category_id IS NOT NULL AND TRIM(category_id) <> ''",
            arrayOf(playlistId),
            "category_id",
            null,
            "category_id COLLATE NOCASE",
        ).use { rows ->
            while (rows.moveToNext()) result += rows.getString(0)
        }
        return result
    }

    private fun distinctCategoryMappings(table: String, playlistId: String): List<TvCatalogCategoryMapping> {
        val result = mutableListOf<TvCatalogCategoryMapping>()
        readableDatabase.query(
            table,
            arrayOf("category_id", "provider_category_id"),
            "playlist_id = ? AND category_id IS NOT NULL AND TRIM(category_id) <> ''",
            arrayOf(playlistId),
            "category_id, provider_category_id",
            null,
            "category_id COLLATE NOCASE",
        ).use { rows ->
            while (rows.moveToNext()) result += TvCatalogCategoryMapping(
                label = rows.getString(0),
                providerId = rows.getStringOrNull(1),
            )
        }
        return result
    }

    private fun getVod(
        playlistId: String,
        offset: Int,
        limit: Int,
        selection: String = "playlist_id = ?",
        orderBy: String = "name COLLATE NOCASE",
        selectionArgs: Array<String> = arrayOf(playlistId),
    ): List<TvVodItem> {
        val result = mutableListOf<TvVodItem>()
        readableDatabase.query(
            "vod",
            arrayOf("xtream_id", "name", "url", "category_id", "provider_category_id", "cover_url", "extension", "rating", "provider_command", "provider_type", "stalker_http_tmp", "stalker_load_balancing", "added_at_ms"),
            selection,
            selectionArgs, null, null, orderBy, "$limit OFFSET $offset",
        ).use { rows ->
            while (rows.moveToNext()) result += TvVodItem(
                id = rows.getInt(0), name = rows.getString(1), url = rows.getString(2),
                categoryId = rows.getStringOrNull(3), providerCategoryId = rows.getStringOrNull(4),
                coverUrl = rows.getStringOrNull(5), extension = rows.getString(6), rating = rows.getDoubleOrNull(7),
                providerCommand = rows.getStringOrNull(8), providerType = rows.getStringOrNull(9),
                useHttpTmpLink = rows.getBooleanOrNull(10), useLoadBalancing = rows.getBooleanOrNull(11),
                addedAtMs = rows.getLongOrNull(12),
            )
        }
        return result
    }

    private fun getSeries(
        playlistId: String,
        offset: Int,
        limit: Int,
        selection: String = "playlist_id = ?",
        orderBy: String = "name COLLATE NOCASE",
        selectionArgs: Array<String> = arrayOf(playlistId),
    ): List<TvSeriesItem> {
        val result = mutableListOf<TvSeriesItem>()
        readableDatabase.query(
            "series",
            arrayOf("xtream_id", "name", "category_id", "provider_category_id", "cover_url", "plot", "rating", "provider_type", "provider_command", "stalker_http_tmp", "stalker_load_balancing", "added_at_ms"),
            selection,
            selectionArgs, null, null, orderBy, "$limit OFFSET $offset",
        ).use { rows ->
            while (rows.moveToNext()) result += TvSeriesItem(
                id = rows.getInt(0), name = rows.getString(1), categoryId = rows.getStringOrNull(2),
                providerCategoryId = rows.getStringOrNull(3), coverUrl = rows.getStringOrNull(4),
                plot = rows.getStringOrNull(5), rating = rows.getDoubleOrNull(6),
                providerType = rows.getStringOrNull(7), providerCommand = rows.getStringOrNull(8),
                useHttpTmpLink = rows.getBooleanOrNull(9), useLoadBalancing = rows.getBooleanOrNull(10),
                addedAtMs = rows.getLongOrNull(11),
            )
        }
        return result
    }

    private fun android.database.Cursor.getStringOrNull(index: Int): String? =
        if (isNull(index)) null else getString(index)

    private fun android.database.Cursor.getDoubleOrNull(index: Int): Double? =
        if (isNull(index)) null else getDouble(index)

    private fun android.database.Cursor.getLongOrNull(index: Int): Long? =
        if (isNull(index)) null else getLong(index)

    private fun android.database.Cursor.getBooleanOrNull(index: Int): Boolean? =
        if (isNull(index)) null else getInt(index) != 0

    private fun parseHeaders(value: String): Map<String, String> = runCatching {
        val json = JSONObject(value)
        buildMap {
            json.keys().forEach { key -> json.optString(key).takeIf(String::isNotBlank)?.let { put(key, it) } }
        }
    }.getOrDefault(emptyMap())

    private fun parseDrm(value: String): TvDrmConfig? = runCatching {
        val root = JSONObject(value)
        val keys = root.optJSONObject("clear_keys")
        val clearKeys = linkedMapOf<String, String>()
        keys?.keys()?.forEach { key -> clearKeys[key] = keys.getString(key) }
        val licenseHeaders = parseJsonStringMap(root.optJSONObject("license_headers")?.toString())
        val additionalProperties = parseJsonStringMap(root.optJSONObject("additional_properties")?.toString())
        TvDrmConfig(
            licenseType = root.optString("license_type"),
            supported = root.optBoolean("supported"),
            clearKeys = clearKeys,
            licenseUrl = root.optString("license_url").takeIf { it.isNotBlank() && it != "null" },
            licenseHeaders = licenseHeaders,
            licenseRequestData = root.optString("license_request_data").takeIf { it.isNotBlank() && it != "null" },
            licenseResponseData = root.optString("license_response_data").takeIf { it.isNotBlank() && it != "null" },
            additionalProperties = additionalProperties,
        )
    }.getOrNull()

    private fun parseJsonStringMap(value: String?): Map<String, String> {
        if (value.isNullOrBlank()) return emptyMap()
        return runCatching {
            val json = JSONObject(value)
            buildMap {
                json.keys().forEach { key -> if (!json.isNull(key)) put(key, json.getString(key)) }
            }
        }.getOrDefault(emptyMap())
    }

    private fun createCatalogTables(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE IF NOT EXISTS vod (
            id TEXT PRIMARY KEY NOT NULL, playlist_id TEXT NOT NULL, xtream_id INTEGER NOT NULL,
            name TEXT NOT NULL, url TEXT NOT NULL, category_id TEXT, provider_category_id TEXT, cover_url TEXT,
            extension TEXT NOT NULL, rating REAL, provider_command TEXT, provider_type TEXT,
            stalker_http_tmp INTEGER, stalker_load_balancing INTEGER, added_at_ms INTEGER,
            FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        )""".trimIndent())
        db.execSQL("""CREATE TABLE IF NOT EXISTS series (
            id TEXT PRIMARY KEY NOT NULL, playlist_id TEXT NOT NULL, xtream_id INTEGER NOT NULL,
            name TEXT NOT NULL, category_id TEXT, provider_category_id TEXT, cover_url TEXT, plot TEXT, rating REAL, provider_type TEXT, provider_command TEXT,
            stalker_http_tmp INTEGER, stalker_load_balancing INTEGER, added_at_ms INTEGER,
            FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        )""".trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS vod_playlist_idx ON vod(playlist_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS series_playlist_idx ON series(playlist_id)")
        createCatalogRecentIndexes(db)
        createCatalogLookupIndexes(db)
    }

    private fun createCatalogRecentIndexes(db: SQLiteDatabase) {
        db.execSQL("CREATE INDEX IF NOT EXISTS vod_recent_idx ON vod(playlist_id, added_at_ms DESC, name COLLATE NOCASE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS series_recent_idx ON series(playlist_id, added_at_ms DESC, name COLLATE NOCASE)")
    }

    private fun createCatalogLookupIndexes(db: SQLiteDatabase) {
        // These are the orderings used by TV search, numeric channel lookup
        // and CH+/CH− zapping. Keep the playlist and radio discriminator first
        // so a large mixed live/radio source does not scan unrelated rows.
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_lookup_idx ON channels(playlist_id, radio, name COLLATE NOCASE, id)")
        createChannelPageIndex(db)
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_number_idx ON channels(playlist_id, radio, channel_number)")
        createChannelUrlLookupIndex(db)
        db.execSQL("CREATE INDEX IF NOT EXISTS vod_name_lookup_idx ON vod(playlist_id, name COLLATE NOCASE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS series_name_lookup_idx ON series(playlist_id, name COLLATE NOCASE)")
    }

    private fun createChannelUrlLookupIndex(db: SQLiteDatabase) {
        // M3U VOD entries are projected from channels and retain their source
        // URL as the saved-item key; resolve their group without scanning a
        // whole playlist when loading Favorites.
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_playlist_url_idx ON channels(playlist_id, url)")
    }

    private fun createChannelPageIndex(db: SQLiteDatabase) {
        // Unfiltered live-TV pages are ordered by name and stable ID. This
        // avoids a temporary sort for each page and keeps equal-name channels
        // from jumping across OFFSET boundaries between loads.
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_page_idx ON channels(playlist_id, name COLLATE NOCASE, id)")
    }

    private fun createChannelSourceOrderIndex(db: SQLiteDatabase) {
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_source_order_idx ON channels(playlist_id, radio, source_order, id)")
        createChannelGroupPageIndex(db)
        createChannelGroupNamePageIndex(db)
    }

    private fun createChannelGroupPageIndex(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS channels_group_page_idx ON channels(" +
                "playlist_id, radio, TRIM(group_name) COLLATE NOCASE, source_order, id)",
        )
    }

    private fun createChannelGroupNamePageIndex(db: SQLiteDatabase) {
        // Name-sorted group pages are used by the TV live list. Keep sorting
        // inside SQLite so pages remain globally ordered without materializing
        // the provider catalogue or resorting it after every D-pad prefetch.
        db.execSQL(
            "CREATE INDEX IF NOT EXISTS channels_group_name_page_idx ON channels(" +
                "playlist_id, radio, TRIM(group_name) COLLATE NOCASE, name COLLATE NOCASE, id)",
        )
    }

    private fun createGroupedChannelPickerIndex(db: SQLiteDatabase) {
        // Match the TV picker ORDER BY exactly so every 200-row page can seek
        // through a large Xtream catalog without sorting it into a temp table.
        db.execSQL(
            """CREATE INDEX IF NOT EXISTS channels_grouped_picker_idx ON channels(
                playlist_id, radio,
                COALESCE(NULLIF(TRIM(group_name), ''), 'Sin grupo') COLLATE NOCASE,
                COALESCE(NULLIF(TRIM(group_name), ''), 'Sin grupo') COLLATE BINARY,
                name COLLATE NOCASE, id
            )""".trimIndent(),
        )
    }

    private fun createUserItemTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE IF NOT EXISTS saved_items (
            id TEXT PRIMARY KEY NOT NULL,
            playlist_id TEXT NOT NULL,
            item_type TEXT NOT NULL,
            item_key TEXT NOT NULL,
            title TEXT NOT NULL,
            uri TEXT NOT NULL,
            cover_url TEXT,
            saved_at INTEGER NOT NULL,
            last_played_at INTEGER,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            resume_position_ms INTEGER NOT NULL DEFAULT 0,
            is_watched INTEGER NOT NULL DEFAULT 0,
            global_favorite_order INTEGER,
            playlist_favorite_order INTEGER,
            UNIQUE(playlist_id, item_type, item_key),
            FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        )""".trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS saved_items_favorite_idx ON saved_items(saved_at DESC)")
        db.execSQL("CREATE INDEX IF NOT EXISTS saved_items_history_idx ON saved_items(last_played_at DESC)")
    }

    private fun createEpgTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE IF NOT EXISTS epg (
            source_id TEXT NOT NULL, channel_id TEXT NOT NULL, start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL, title TEXT NOT NULL, subtitle TEXT, description TEXT, category TEXT,
            PRIMARY KEY(source_id, channel_id, start_ms),
            FOREIGN KEY(source_id) REFERENCES playlists(id) ON DELETE CASCADE
        )""".trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS epg_window_idx ON epg(source_id, channel_id, start_ms)")
    }

    private fun createEpgImportStagingTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE IF NOT EXISTS epg_import_staging (
            import_id TEXT NOT NULL, source_id TEXT NOT NULL, channel_id TEXT NOT NULL,
            start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, title TEXT NOT NULL,
            subtitle TEXT, description TEXT, category TEXT,
            PRIMARY KEY(import_id, channel_id, start_ms)
        )""".trimIndent())
    }

    private fun createEpgMappingTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE IF NOT EXISTS epg_mappings (
            source_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            epg_channel_id TEXT NOT NULL,
            PRIMARY KEY(source_id, channel_id),
            FOREIGN KEY(source_id) REFERENCES playlists(id) ON DELETE CASCADE
        )""".trimIndent())
    }

    private fun createEpgSearchIndexes(db: SQLiteDatabase) {
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_epg_tvg_id_idx ON channels(playlist_id, tvg_id)")
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_epg_tvg_name_idx ON channels(playlist_id, tvg_name)")
        db.execSQL("CREATE INDEX IF NOT EXISTS channels_epg_name_idx ON channels(playlist_id, name)")
        db.execSQL("CREATE INDEX IF NOT EXISTS epg_mappings_reverse_idx ON epg_mappings(source_id, epg_channel_id, channel_id)")
    }

    private fun createEpgSourcesTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE IF NOT EXISTS epg_sources (
            source_id TEXT NOT NULL, url TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1, detected INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(source_id, url),
            FOREIGN KEY(source_id) REFERENCES playlists(id) ON DELETE CASCADE
        )""".trimIndent())
    }

    private fun createEpisodeProgressTable(db: SQLiteDatabase) {
        db.execSQL("""CREATE TABLE IF NOT EXISTS episode_progress (
            playlist_id TEXT NOT NULL, series_id INTEGER NOT NULL, episode_id INTEGER NOT NULL,
            position_ms INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
            completed INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
            PRIMARY KEY(playlist_id, series_id, episode_id),
            FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
        )""".trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS episode_progress_series_idx ON episode_progress(playlist_id, series_id, updated_at)")
    }

    private fun savedItemId(playlistId: String, type: TvSavedItemType, key: String): String =
        "$playlistId:${type.name}:$key"

    companion object {
        private const val DATABASE_NAME = "iptvnator-tv.db"
        private const val DATABASE_VERSION = 43
        private const val EPG_IMPORT_BATCH_SIZE = 1_000
        private val CHANNEL_CATALOG_INDEXES = listOf(
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
        )
        private val CONTENT_CATALOG_INDEXES = listOf(
            "vod_playlist_idx",
            "series_playlist_idx",
            "vod_recent_idx",
            "series_recent_idx",
            "vod_name_lookup_idx",
            "series_name_lookup_idx",
        )
    }
}
