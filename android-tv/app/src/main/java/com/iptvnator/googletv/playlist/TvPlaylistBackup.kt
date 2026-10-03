package com.iptvnator.googletv.playlist

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import com.iptvnator.googletv.xtream.XtreamCredentials

data class TvBackupImportSummary(
    val imported: Int,
    val failed: Int,
    val errors: List<String>,
    val importedPlaylistIds: List<String> = emptyList(),
)

/**
 * Small, versioned backup boundary for the Android TV client.
 *
 * The format deliberately contains source credentials, just like IPTVnator's
 * desktop backup. The caller must only write it to a user-selected document;
 * credentials never pass through logs or URI query strings here.
 */
object TvPlaylistBackup {
    private const val KIND = "iptvnator-playlist-backup"
    private const val ANDROID_TV_KIND = "iptvnator-android-tv-playlist-backup"
    private const val VERSION = 1

    /**
     * Favorites, history and watched rows are projections of the same SQLite
     * saved-item record. Merge them before exporting instead of keeping the
     * first projection and silently dropping resume/watched state.
     */
    fun mergeSavedItems(vararg collections: List<TvSavedItem>): List<TvSavedItem> {
        val merged = linkedMapOf<String, TvSavedItem>()
        collections.asSequence().flatten().forEach { item ->
            val key = "${item.playlistId}\u0000${item.itemType.name}\u0000${item.itemKey}"
            val previous = merged[key]
            if (previous == null) {
                merged[key] = item
            } else {
                val latest = when {
                    (item.lastPlayedAt ?: Long.MIN_VALUE) > (previous.lastPlayedAt ?: Long.MIN_VALUE) -> item
                    else -> previous
                }
                merged[key] = previous.copy(
                    title = item.title.ifBlank { previous.title },
                    uri = item.uri.ifBlank { previous.uri },
                    coverUrl = item.coverUrl ?: previous.coverUrl,
                    savedAt = minOf(previous.savedAt, item.savedAt),
                    lastPlayedAt = maxOfNullable(previous.lastPlayedAt, item.lastPlayedAt),
                    isFavorite = previous.isFavorite || item.isFavorite,
                    resumePositionMs = latest.resumePositionMs,
                    isWatched = previous.isWatched || item.isWatched,
                    globalFavoriteOrder = item.globalFavoriteOrder ?: previous.globalFavoriteOrder,
                    playlistFavoriteOrder = item.playlistFavoriteOrder ?: previous.playlistFavoriteOrder,
                )
            }
        }
        return merged.values.toList()
    }

    private fun maxOfNullable(first: Long?, second: Long?): Long? = when {
        first == null -> second
        second == null -> first
        else -> maxOf(first, second)
    }

    fun export(
        playlists: List<StoredPlaylist>,
        credentials: TvCredentialVault?,
        savedItems: List<TvSavedItem> = emptyList(),
        episodeProgress: List<TvEpisodeProgress> = emptyList(),
        epgSourceStates: Map<String, List<TvEpgSourceState>> = emptyMap(),
        autoRefresh: (String) -> Boolean = { false },
        sourceOrder: List<String> = emptyList(),
    ): String {
        val entries = JSONArray()
        val inputOrder = playlists.mapIndexed { index, playlist -> playlist.id to index }.toMap()
        val explicitOrder = sourceOrder.withIndex().associate { it.value to it.index }
        val orderedPlaylists = playlists.sortedWith(
            compareBy<StoredPlaylist> { explicitOrder[it.id] ?: sourceOrder.size + (inputOrder[it.id] ?: Int.MAX_VALUE) }
                .thenBy { inputOrder[it.id] ?: Int.MAX_VALUE },
        )
        orderedPlaylists.forEachIndexed { position, playlist ->
            val xtream = credentials?.load(playlist.id)
            val stalker = credentials?.loadStalker(playlist.id)
            val saved = savedItems.filter { it.playlistId == playlist.id }
            val progress = episodeProgress.filter { it.playlistId == playlist.id }
            val tvState = JSONObject()
                .put("epgUrl", playlist.epgUrl ?: JSONObject.NULL)
                .put("epgUrls", JSONArray(playlist.epgUrls))
                .put("sourcePosition", position)
                .put("hiddenGroupTitles", JSONArray(playlist.hiddenGroupTitles))
                .put("hiddenCategories", JSONArray().apply {
                    playlist.hiddenCategories.forEach { category ->
                        put(JSONObject().put("type", category.type).put("id", category.id))
                    }
                })
                .put("userState", saved.toTvBackupUserState())
                .put("episodeProgress", progress.toTvBackupEpisodeProgress())
                .put("epgSources", JSONArray().apply {
                val states = epgSourceStates[playlist.id].orEmpty().ifEmpty {
                    playlist.epgUrls.map { TvEpgSourceState(it, true) }
                }
                states.forEach { state ->
                    put(JSONObject().put("url", state.url).put("enabled", state.enabled).put("detected", state.detected))
                }
            })
            val entry = JSONObject()
                .put("exportedId", playlist.id)
                .put("title", playlist.name)
                .put("autoRefresh", autoRefresh(playlist.id))
                .put("position", position)
                .put("androidTvState", tvState)
            when {
                xtream != null -> {
                    entry.put("portalType", "xtream")
                        .put("connection", JSONObject()
                            .put("serverUrl", xtream.serverUrl)
                            .put("username", xtream.username)
                            .put("password", xtream.password))
                        .put("userState", xtreamDesktopUserState(playlist, saved, progress))
                }
                stalker != null -> {
                    entry.put("portalType", "stalker")
                        .put("connection", JSONObject()
                            .put("portalUrl", stalker.portalUrl)
                            .put("macAddress", stalker.macAddress)
                            .put("username", stalker.username)
                            .put("password", stalker.password)
                            .put("stalkerSerialNumber", stalker.serialNumber)
                            .put("stalkerDeviceId1", stalker.deviceId1)
                            .put("stalkerDeviceId2", stalker.deviceId2)
                            .put("stalkerSignature1", stalker.signature1)
                            .put("stalkerSignature2", stalker.signature2))
                        .put("userState", stalkerDesktopUserState(playlist, saved))
                }
                else -> {
                    val url = portableM3uUrl(playlist.sourceUrl)
                    entry.put("portalType", "m3u")
                        .put("source", JSONObject().apply {
                            put("kind", if (url != null) "url" else if (playlist.sourceUrl != null) "file" else "text")
                            put("rawM3u", toM3u(playlist))
                            put("url", url)
                            playlist.sourceUserAgent?.let { put("userAgent", it) }
                            playlist.sourceReferrer?.takeIf(String::isNotBlank)?.let { put("referrer", it) }
                            playlist.sourceOrigin?.takeIf(String::isNotBlank)?.let { put("origin", it) }
                        })
                        .put("userState", m3uDesktopUserState(playlist, saved))
                }
            }
            entries.put(entry)
        }
        return JSONObject()
            .put("kind", KIND)
            .put("version", VERSION)
            .put("exportedAt", Instant.now().toString())
            .put("includeSecrets", true)
            .put("playlists", entries)
            .toString(2)
    }

    private fun List<TvSavedItem>.toTvBackupUserState(): JSONArray = JSONArray().apply {
        forEach { item ->
            put(JSONObject()
                .put("type", item.itemType.name)
                .put("key", item.itemKey)
                .put("title", item.title)
                .put("uri", item.uri)
                .put("coverUrl", item.coverUrl)
                .put("savedAt", item.savedAt)
                .put("lastPlayedAt", item.lastPlayedAt)
                .put("favorite", item.isFavorite)
                .put("resumePositionMs", item.resumePositionMs)
                .put("watched", item.isWatched)
                .put("globalFavoriteOrder", item.globalFavoriteOrder)
                .put("playlistFavoriteOrder", item.playlistFavoriteOrder))
        }
    }

    private fun List<TvEpisodeProgress>.toTvBackupEpisodeProgress(): JSONArray = JSONArray().apply {
        forEach { item ->
            put(JSONObject()
                .put("seriesId", item.seriesId)
                .put("episodeId", item.episodeId)
                .put("positionMs", item.positionMs)
                .put("durationMs", item.durationMs)
                .put("completed", item.completed)
                .put("updatedAt", item.updatedAt))
        }
    }

    private fun m3uDesktopUserState(playlist: StoredPlaylist, items: List<TvSavedItem>) = JSONObject()
        .put("favorites", JSONArray().apply {
            items.filter { it.itemType == TvSavedItemType.CHANNEL && it.isFavorite }
                .sortedBy { it.playlistFavoriteOrder ?: Int.MAX_VALUE }
                .forEach { put(it.itemKey) }
        })
        .put("recentlyViewed", JSONArray().apply {
            items.filter { it.itemType == TvSavedItemType.CHANNEL && it.lastPlayedAt != null }
                .sortedByDescending { it.lastPlayedAt }
                .forEach { item ->
                    val channel = playlist.channels.firstOrNull { it.id == item.itemKey }
                    put(JSONObject()
                        .put("source", "m3u")
                        .put("id", item.itemKey)
                        .put("url", item.uri)
                        .put("title", item.title)
                        .put("channel_id", item.itemKey)
                        .put("poster_url", item.coverUrl)
                        .put("tvg_id", channel?.tvgId)
                        .put("tvg_name", channel?.tvgName)
                        .put("group_title", channel?.group)
                        .put("category_id", "live")
                        .put("added_at", item.lastPlayedAt))
                }
        })
        .put("hiddenGroupTitles", JSONArray(playlist.hiddenGroupTitles))

    private fun xtreamDesktopUserState(
        playlist: StoredPlaylist,
        items: List<TvSavedItem>,
        progress: List<TvEpisodeProgress>,
    ) = JSONObject()
        .put("hiddenCategories", JSONArray().apply {
            playlist.hiddenCategories.forEach { category ->
                val type = when (category.type.lowercase()) {
                    "live", "channel" -> "live"
                    "movies", "movie", "vod" -> "movies"
                    "series" -> "series"
                    else -> null
                }
                val id = category.id.toIntOrNull()
                if (type != null && id != null) {
                    put(JSONObject().put("categoryType", type).put("xtreamId", id))
                }
            }
        })
        .put("favorites", JSONArray().apply {
            items.filter { it.isFavorite }.forEach { item ->
                val type = item.itemType.toDesktopXtreamType() ?: return@forEach
                val id = item.itemKey.substringAfterLast(':').toIntOrNull() ?: return@forEach
                put(JSONObject()
                    .put("contentType", type)
                    .put("xtreamId", id)
                    .put("addedAt", Instant.ofEpochMilli(item.savedAt).toString())
                    .put("position", item.playlistFavoriteOrder))
            }
        })
        .put("recentlyViewed", JSONArray().apply {
            items.filter { it.lastPlayedAt != null }.forEach { item ->
                val type = item.itemType.toDesktopXtreamType() ?: return@forEach
                val id = item.itemKey.substringAfterLast(':').toIntOrNull() ?: return@forEach
                put(JSONObject()
                    .put("contentType", type)
                    .put("xtreamId", id)
                    .put("viewedAt", Instant.ofEpochMilli(item.lastPlayedAt!!).toString()))
            }
        })
        .put("playbackPositions", JSONArray().apply {
            items.filter { it.itemType == TvSavedItemType.VOD && it.resumePositionMs > 0L }
                .forEach { item ->
                    val id = item.itemKey.toIntOrNull() ?: return@forEach
                    put(JSONObject()
                        .put("contentXtreamId", id)
                        .put("contentType", "vod")
                        .put("positionSeconds", item.resumePositionMs / 1000.0)
                        .put("playlistId", playlist.id)
                        .put("updatedAt", Instant.ofEpochMilli(item.lastPlayedAt ?: item.savedAt).toString()))
                }
            progress.forEach { item ->
                put(JSONObject()
                    .put("contentXtreamId", item.episodeId)
                    .put("contentType", "episode")
                    .put("seriesXtreamId", item.seriesId)
                    .put("positionSeconds", item.positionMs / 1000.0)
                    .put("durationSeconds", item.durationMs / 1000.0)
                    .put("playlistId", playlist.id)
                    .put("updatedAt", Instant.ofEpochMilli(item.updatedAt).toString()))
            }
        })

    private fun stalkerDesktopUserState(playlist: StoredPlaylist, items: List<TvSavedItem>) = JSONObject()
        .put("favorites", items.filter(TvSavedItem::isFavorite).toStalkerItems(playlist))
        .put("recentlyViewed", items.filter { it.lastPlayedAt != null }.toStalkerItems(playlist))

    private fun List<TvSavedItem>.toStalkerItems(playlist: StoredPlaylist) = JSONArray().apply {
        forEach { item ->
            val id = item.itemKey.substringAfterLast(':')
            val channel = playlist.channels.firstOrNull { it.id == "stalker:$id" }
            val vod = playlist.vod.firstOrNull { it.id.toString() == id }
            val series = playlist.series.firstOrNull { it.id.toString() == id }
            val type = when (item.itemType) {
                TvSavedItemType.CHANNEL -> "itv"
                TvSavedItemType.VOD -> "vod"
                TvSavedItemType.SERIES -> "series"
            }
            put(JSONObject()
                .put("id", id)
                .put("stream_id", id)
                .put("series_id", if (item.itemType == TvSavedItemType.SERIES) id else null)
                .put("movie_id", if (item.itemType == TvSavedItemType.VOD) id else null)
                .put("title", item.title)
                .put("name", item.title)
                .put("cover", item.coverUrl ?: channel?.logoUrl ?: vod?.coverUrl ?: series?.coverUrl)
                .put("poster_url", item.coverUrl ?: channel?.logoUrl ?: vod?.coverUrl ?: series?.coverUrl)
                .put("category_id", channel?.providerCategoryId ?: vod?.providerCategoryId ?: series?.providerCategoryId ?: type)
                .put("stream_type", type)
                .put("cmd", channel?.providerCommand ?: vod?.providerCommand ?: series?.providerCommand ?: item.uri)
                .put("added_at", item.lastPlayedAt ?: item.savedAt))
        }
    }

    private fun TvSavedItemType.toDesktopXtreamType(): String? = when (this) {
        TvSavedItemType.CHANNEL -> "live"
        TvSavedItemType.VOD -> "movie"
        TvSavedItemType.SERIES -> "series"
    }

    fun import(
        json: String,
        repository: TvPlaylistRepository,
        onAutoRefresh: (String, Boolean) -> Unit = { _, _ -> },
        onSourcePosition: (String, Int) -> Unit = { _, _ -> },
    ): TvBackupImportSummary {
        val root = JSONObject(json)
        if (root.optString("kind") == KIND) {
            return importDesktopBackup(root, repository, onAutoRefresh, onSourcePosition)
        }
        require(root.optString("kind") == ANDROID_TV_KIND) { "No es un backup de IPTVnator" }
        require(root.optInt("version") == VERSION) { "Versión de backup no compatible" }
        val sources = root.optJSONArray("sources") ?: JSONArray()
        var imported = 0
        val errors = mutableListOf<String>()
        val importedPlaylistIds = mutableListOf<String>()
        for (index in 0 until sources.length()) {
            val source = sources.optJSONObject(index) ?: continue
            val title = source.optString("title").ifBlank { "Playlist restaurada" }
            var restoredPlaylistId: String? = null
            runCatching {
                val restoredPlaylist = when (source.optString("type")) {
                    "m3u" -> repository.importM3uContent(
                        content = source.getString("content"),
                        name = title,
                        sourceUrl = portableM3uUrl(source.optNullableString("sourceUrl")),
                        epgUrl = source.optNullableString("epgUrl"),
                        userAgent = source.optNullableString("userAgent"),
                        autoImportEpg = false,
                    )
                    "xtream" -> repository.importXtream(
                        com.iptvnator.googletv.xtream.XtreamCredentials(
                            serverUrl = source.getString("serverUrl"),
                            username = source.getString("username"),
                            password = source.getString("password"),
                        ),
                        title,
                        source.optNullableString("epgUrl"),
                    )
                    "stalker" -> repository.importStalker(
                        com.iptvnator.googletv.stalker.StalkerCredentials(
                            portalUrl = source.getString("portalUrl"),
                            macAddress = source.getString("macAddress"),
                            serialNumber = source.optNullableString("serialNumber"),
                            username = source.optNullableString("username"),
                            password = source.optNullableString("password"),
                            deviceId1 = source.optNullableString("stalkerDeviceId1")
                                ?: source.optNullableString("deviceId1"),
                            deviceId2 = source.optNullableString("stalkerDeviceId2")
                                ?: source.optNullableString("deviceId2"),
                            signature1 = source.optNullableString("stalkerSignature1")
                                ?: source.optNullableString("signature1"),
                            signature2 = source.optNullableString("stalkerSignature2")
                                ?: source.optNullableString("signature2"),
                        ),
                        title,
                        source.optNullableString("epgUrl"),
                    )
                    else -> error("Tipo de fuente no compatible")
                }
                restoredPlaylistId = restoredPlaylist.id
                restoreHiddenGroups(source, restoredPlaylist, repository)
                restoreHiddenCategories(source, restoredPlaylist, repository)
                restoreUserState(source.optJSONArray("userState"), restoredPlaylist, repository)
                restoreEpisodeProgress(source.optJSONArray("episodeProgress"), restoredPlaylist, repository)
                val epgSources = source.optJSONArray("epgSources")?.let { array ->
                    (0 until array.length()).mapNotNull { index ->
                        val item = array.optJSONObject(index) ?: return@mapNotNull null
                        item.optString("url").trim().takeIf(String::isNotBlank)?.let { url ->
                            TvEpgSourceState(
                                url = url,
                                enabled = item.optBoolean("enabled", true),
                                detected = item.optBoolean("detected", false),
                            )
                        }
                    }
                }.orEmpty()
                val epgUrls = source.optJSONArray("epgUrls")?.let { array ->
                    (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }
                }.orEmpty()
                val restoredEpgSources = epgSources.ifEmpty { epgUrls.map { TvEpgSourceState(it, true) } }
                if (restoredEpgSources.isNotEmpty()) {
                    repository.restoreEpgSourceStates(restoredPlaylist.id, restoredEpgSources)
                }
                onAutoRefresh(restoredPlaylist.id, source.optBoolean("autoRefresh", false))
                onSourcePosition(restoredPlaylist.id, source.optInt("position", index))
            }.onSuccess {
                imported++
                restoredPlaylistId?.let(importedPlaylistIds::add)
            }
                .onFailure { errors += "$title: ${it.message ?: "error desconocido"}" }
        }
        return TvBackupImportSummary(imported, errors.size, errors, importedPlaylistIds)
    }

    /** Reads the version-1 backup emitted by the original desktop/web client. */
    private fun importDesktopBackup(
        root: JSONObject,
        repository: TvPlaylistRepository,
        onAutoRefresh: (String, Boolean) -> Unit,
        onSourcePosition: (String, Int) -> Unit,
    ): TvBackupImportSummary {
        require(root.optInt("version") == 1) { "Versión de backup de IPTVnator no compatible" }
        val entries = root.optJSONArray("playlists") ?: JSONArray()
        var imported = 0
        val errors = mutableListOf<String>()
        val ids = mutableListOf<String>()
        for (index in 0 until entries.length()) {
            val entry = entries.optJSONObject(index) ?: continue
            val title = entry.optString("title").ifBlank { "Playlist restaurada" }
            runCatching {
                val restored = when (entry.optString("portalType")) {
                    "m3u" -> {
                        val source = entry.optJSONObject("source") ?: error("La fuente M3U no tiene datos")
                        repository.importM3uContent(
                            content = source.getString("rawM3u"),
                            name = title,
                            sourceUrl = portableM3uUrl(source.optNullableString("url")),
                            userAgent = source.optNullableString("userAgent"),
                            sourceReferrer = source.optNullableString("referrer"),
                            sourceOrigin = source.optNullableString("origin"),
                        )
                    }
                    "xtream" -> {
                        val connection = entry.optJSONObject("connection") ?: error("La fuente Xtream no tiene conexión")
                        repository.importXtream(
                            XtreamCredentials(
                                serverUrl = connection.getString("serverUrl"),
                                username = connection.getString("username"),
                                password = connection.optNullableString("password") ?: "",
                            ),
                            title,
                        )
                    }
                    "stalker" -> {
                        val connection = entry.optJSONObject("connection") ?: error("La fuente Stalker no tiene conexión")
                        repository.importStalker(
                            com.iptvnator.googletv.stalker.StalkerCredentials(
                                portalUrl = connection.getString("portalUrl"),
                                macAddress = connection.getString("macAddress"),
                                serialNumber = connection.optNullableString("stalkerSerialNumber"),
                                username = connection.optNullableString("username"),
                                password = connection.optNullableString("password"),
                                deviceId1 = connection.optNullableString("stalkerDeviceId1"),
                                deviceId2 = connection.optNullableString("stalkerDeviceId2"),
                                signature1 = connection.optNullableString("stalkerSignature1"),
                                signature2 = connection.optNullableString("stalkerSignature2"),
                            ),
                            title,
                        )
                    }
                    else -> error("Tipo de fuente no compatible")
                }
                onAutoRefresh(restored.id, entry.optBoolean("autoRefresh", false))
                val tvState = entry.optJSONObject("androidTvState")
                if (tvState == null) {
                    restoreHiddenGroups(entry, restored, repository)
                    restoreHiddenCategories(entry, restored, repository)
                    restoreDesktopUserState(entry, restored, repository)
                } else {
                    restoreAndroidTvState(tvState, restored, repository)
                }
                onSourcePosition(
                    restored.id,
                    tvState?.optInt("sourcePosition", entry.optInt("position", index))
                        ?: entry.optInt("position", index),
                )
                imported++
                ids += restored.id
            }.onFailure { failure -> errors += "$title: ${failure.message ?: "error desconocido"}" }
        }
        return TvBackupImportSummary(imported, errors.size, errors, ids)
    }

    internal fun mergeSourceOrder(
        currentOrder: List<String>,
        restoredPositions: List<Pair<String, Int>>,
    ): List<String> {
        val restoredIds = restoredPositions.sortedBy { it.second }.map { it.first }.distinct()
        return (currentOrder.filterNot { it in restoredIds } + restoredIds).distinct()
    }

    private fun restoreHiddenGroups(source: JSONObject, playlist: StoredPlaylist, repository: TvPlaylistRepository) {
        val values = source.optJSONArray("hiddenGroupTitles")
            ?: source.optJSONObject("userState")?.optJSONArray("hiddenGroupTitles")
            ?: source.optJSONObject("androidTvState")?.optJSONArray("hiddenGroupTitles")
            ?: return
        val groups = (0 until values.length())
            .mapNotNull { values.optString(it).trim().takeIf(String::isNotBlank) }
            .distinct()
        repository.saveHiddenGroupTitles(playlist.id, groups)
    }

    private fun restoreHiddenCategories(source: JSONObject, playlist: StoredPlaylist, repository: TvPlaylistRepository) {
        val values = source.optJSONArray("hiddenCategories")
            ?: source.optJSONObject("userState")?.optJSONArray("hiddenCategories")
            ?: source.optJSONObject("androidTvState")?.optJSONArray("hiddenCategories")
            ?: return
        val categories = (0 until values.length()).mapNotNull { index ->
            val item = values.optJSONObject(index) ?: return@mapNotNull null
            val type = item.optString("type").ifBlank { item.optString("categoryType") }.trim().lowercase()
            val id = item.optString("id").ifBlank { item.optString("xtreamId") }.trim()
            if (type.isBlank() || id.isBlank()) null else TvHiddenCategory(type, id)
        }.distinct()
        repository.saveHiddenCategories(playlist.id, categories)
    }

    private fun restoreAndroidTvState(
        state: JSONObject,
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
    ) {
        restoreHiddenGroups(state, playlist, repository)
        restoreHiddenCategories(state, playlist, repository)
        restoreUserState(state.optJSONArray("userState"), playlist, repository)
        restoreEpisodeProgress(state.optJSONArray("episodeProgress"), playlist, repository)
        val sources = state.optJSONArray("epgSources")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                val source = array.optJSONObject(index) ?: return@mapNotNull null
                source.optString("url").trim().takeIf(String::isNotBlank)?.let { url ->
                    TvEpgSourceState(
                        url = url,
                        enabled = source.optBoolean("enabled", true),
                        detected = source.optBoolean("detected", false),
                    )
                }
            }
        }.orEmpty()
        val urls = state.optJSONArray("epgUrls")?.let { array ->
            (0 until array.length()).mapNotNull { array.optString(it).trim().takeIf(String::isNotBlank) }
        }.orEmpty()
        val primaryUrl = state.optNullableString("epgUrl")
        val restoredSources = sources.ifEmpty {
            (urls + listOfNotNull(primaryUrl)).distinct().map { TvEpgSourceState(it, true) }
        }
        if (restoredSources.isNotEmpty()) repository.restoreEpgSourceStates(playlist.id, restoredSources)
    }

    private fun restoreDesktopUserState(
        entry: JSONObject,
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
    ) {
        when (entry.optString("portalType")) {
            "m3u" -> restoreDesktopM3uState(entry.optJSONObject("userState"), playlist, repository)
            "xtream" -> restoreDesktopXtreamState(entry.optJSONObject("userState"), playlist, repository)
            "stalker" -> restoreDesktopStalkerState(entry.optJSONObject("userState"), playlist, repository)
        }
    }

    private fun restoreDesktopM3uState(
        state: JSONObject?,
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
    ) {
        if (state == null) return
        val items = linkedMapOf<String, TvSavedItem>()
        val favorites = state.optJSONArray("favorites") ?: JSONArray()
        for (index in 0 until favorites.length()) {
            val key = favorites.optString(index).takeIf(String::isNotBlank) ?: continue
            desktopM3uItem(playlist, repository, key)?.let { item ->
            items[item.itemKey] = item.copy(isFavorite = true, playlistFavoriteOrder = index)
            }
        }
        val recent = state.optJSONArray("recentlyViewed") ?: JSONArray()
        for (index in 0 until recent.length()) {
            val row = recent.optJSONObject(index) ?: continue
            val key = sequenceOf("id", "channel_id", "tvg_id", "url")
                .mapNotNull { row.optString(it).takeIf(String::isNotBlank) }
                .firstOrNull() ?: continue
            val item = desktopM3uItem(playlist, repository, key) ?: continue
            val previous = items[item.itemKey]
            items[item.itemKey] = (previous ?: item).copy(
                lastPlayedAt = desktopTimestamp(row.opt("added_at")) ?: System.currentTimeMillis(),
            )
        }
        items.values.forEach(repository::restoreSavedItem)
    }

    private fun desktopM3uItem(
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
        key: String,
    ): TvSavedItem? {
        val channel = repository.loadChannel(playlist.id, key)
            ?: playlist.channels.firstOrNull { it.id == key || it.url == key || it.tvgId == key }
            ?: return null
        return TvSavedItem(
            playlistId = playlist.id,
            itemType = TvSavedItemType.CHANNEL,
            itemKey = channel.id,
            title = channel.name,
            uri = channel.url,
            coverUrl = channel.logoUrl,
            savedAt = System.currentTimeMillis(),
            lastPlayedAt = null,
        )
    }

    private fun restoreDesktopXtreamState(
        state: JSONObject?,
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
    ) {
        if (state == null) return
        val items = linkedMapOf<String, TvSavedItem>()
        val favorites = state.optJSONArray("favorites") ?: JSONArray()
        for (index in 0 until favorites.length()) {
            val row = favorites.optJSONObject(index) ?: continue
            desktopXtreamItem(playlist, repository, row)?.let { item ->
                items["${item.itemType}:${item.itemKey}"] = item.copy(
                    isFavorite = true,
                    resumePositionMs = (row.optDouble("position", 0.0) * 1000.0).toLong().coerceAtLeast(0L),
                    playlistFavoriteOrder = if (item.itemType == TvSavedItemType.CHANNEL) index else null,
                )
            }
        }
        val recent = state.optJSONArray("recentlyViewed") ?: JSONArray()
        for (index in 0 until recent.length()) {
            val row = recent.optJSONObject(index) ?: continue
            desktopXtreamItem(playlist, repository, row)?.let { item ->
                val key = "${item.itemType}:${item.itemKey}"
                val previous = items[key]
                items[key] = (previous ?: item).copy(
                    lastPlayedAt = desktopTimestamp(row.opt("viewedAt")) ?: System.currentTimeMillis(),
                )
            }
        }
        items.values.forEach(repository::restoreSavedItem)
        val positions = state.optJSONArray("playbackPositions") ?: JSONArray()
        for (index in 0 until positions.length()) {
            val row = positions.optJSONObject(index) ?: continue
            if (row.optString("contentType") != "episode") continue
            val seriesId = row.optInt("seriesXtreamId", 0)
            val episodeId = row.optInt("contentXtreamId", 0)
            if (seriesId <= 0 || episodeId <= 0) continue
            repository.restoreEpisodeProgress(
                TvEpisodeProgress(
                    playlistId = playlist.id,
                    seriesId = seriesId,
                    episodeId = episodeId,
                    positionMs = (row.optDouble("positionSeconds", 0.0) * 1000.0).toLong().coerceAtLeast(0L),
                    durationMs = (row.optDouble("durationSeconds", 0.0) * 1000.0).toLong().coerceAtLeast(0L),
                    completed = false,
                    updatedAt = desktopTimestamp(row.opt("updatedAt")) ?: System.currentTimeMillis(),
                ),
            )
        }
    }

    private fun desktopXtreamItem(
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
        row: JSONObject,
    ): TvSavedItem? {
        val id = row.optInt("xtreamId", 0).takeIf { it > 0 } ?: return null
        val type = when (row.optString("contentType")) {
            "live" -> TvSavedItemType.CHANNEL
            "movie" -> TvSavedItemType.VOD
            "series" -> TvSavedItemType.SERIES
            else -> return null
        }
        return when (type) {
            TvSavedItemType.CHANNEL -> repository.loadChannel(playlist.id, "xtream:$id")?.let { channel ->
                TvSavedItem(playlist.id, type, channel.id, channel.name, channel.url, channel.logoUrl, System.currentTimeMillis(), null)
            }
            TvSavedItemType.VOD -> repository.loadVodItem(playlist.id, id)?.let { vod ->
                TvSavedItem(playlist.id, type, id.toString(), vod.name, vod.url, vod.coverUrl, System.currentTimeMillis(), null)
            }
            TvSavedItemType.SERIES -> repository.loadSeriesItem(playlist.id, id)?.let { series ->
                TvSavedItem(playlist.id, type, id.toString(), series.name, "xtream://$id", series.coverUrl, System.currentTimeMillis(), null)
            }
        }
    }

    private fun restoreDesktopStalkerState(
        state: JSONObject?,
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
    ) {
        if (state == null) return
        val items = linkedMapOf<String, TvSavedItem>()
        val arrays = listOf("favorites" to true, "recentlyViewed" to false)
        arrays.forEach { (name, favorite) ->
            val rows = state.optJSONArray(name) ?: return@forEach
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                val id = sequenceOf("id", "stream_id", "movie_id", "series_id")
                    .mapNotNull { row.optString(it).takeIf(String::isNotBlank) }
                    .firstOrNull() ?: continue
                val type = when {
                    row.optString("category_id").equals("itv", true) || row.optString("stream_type").equals("itv", true) -> TvSavedItemType.CHANNEL
                    row.optBoolean("is_series") || row.optString("stream_type").equals("series", true) -> TvSavedItemType.SERIES
                    else -> TvSavedItemType.VOD
                }
                val key = "$type:$id"
                val base = items[key] ?: TvSavedItem(
                    playlistId = playlist.id,
                    itemType = type,
                    itemKey = id,
                    title = row.optString("title").ifBlank { row.optString("name").ifBlank { "Stalker $id" } },
                    uri = "stalker://$id",
                    coverUrl = row.optString("cover").ifBlank { row.optString("logo") }.takeIf(String::isNotBlank),
                    savedAt = System.currentTimeMillis(),
                    lastPlayedAt = null,
                )
                items[key] = base.copy(
                    isFavorite = base.isFavorite || favorite,
                    lastPlayedAt = if (favorite) base.lastPlayedAt else desktopTimestamp(row.opt("added_at")) ?: System.currentTimeMillis(),
                    playlistFavoriteOrder = if (favorite && type == TvSavedItemType.CHANNEL) index else base.playlistFavoriteOrder,
                )
            }
        }
        items.values.forEach(repository::restoreSavedItem)
    }

    private fun desktopTimestamp(value: Any?): Long? = when (value) {
        is Number -> value.toLong().let { if (it < 10_000_000_000L) it * 1000L else it }
        is String -> value.toLongOrNull()?.let { if (it < 10_000_000_000L) it * 1000L else it }
            ?: runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
        else -> null
    }

    private fun JSONObject.optNullableString(key: String): String? =
        optString(key).takeIf { it.isNotBlank() && it != "null" }

    private fun restoreUserState(
        state: JSONArray?,
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
    ) {
        for (index in 0 until (state?.length() ?: 0)) {
            val item = state?.optJSONObject(index) ?: continue
            val type = runCatching { TvSavedItemType.valueOf(item.getString("type")) }.getOrNull() ?: continue
            repository.restoreSavedItem(
                TvSavedItem(
                    playlistId = playlist.id,
                    itemType = type,
                    itemKey = item.getString("key"),
                    title = item.optString("title"),
                    uri = item.optString("uri"),
                    coverUrl = item.optNullableString("coverUrl"),
                    savedAt = item.optLong("savedAt", System.currentTimeMillis()),
                    lastPlayedAt = item.optNullableLong("lastPlayedAt"),
                    isFavorite = item.optBoolean("favorite"),
                    resumePositionMs = item.optLong("resumePositionMs", 0L),
                    isWatched = item.optBoolean("watched"),
                    globalFavoriteOrder = item.optNullableInt("globalFavoriteOrder"),
                    playlistFavoriteOrder = item.optNullableInt("playlistFavoriteOrder"),
                ),
            )
        }
    }

    private fun JSONObject.optNullableLong(key: String): Long? =
        if (isNull(key)) null else optLong(key)

    private fun JSONObject.optNullableInt(key: String): Int? =
        if (isNull(key)) null else optInt(key)

    private fun restoreEpisodeProgress(
        progress: JSONArray?,
        playlist: StoredPlaylist,
        repository: TvPlaylistRepository,
    ) {
        for (index in 0 until (progress?.length() ?: 0)) {
            val item = progress?.optJSONObject(index) ?: continue
            repository.restoreEpisodeProgress(
                TvEpisodeProgress(
                    playlistId = playlist.id,
                    seriesId = item.optInt("seriesId"),
                    episodeId = item.optInt("episodeId"),
                    positionMs = item.optLong("positionMs", 0L),
                    durationMs = item.optLong("durationMs", 0L),
                    completed = item.optBoolean("completed"),
                    updatedAt = item.optLong("updatedAt", System.currentTimeMillis()),
                ),
            )
        }
    }

    private fun toM3u(playlist: StoredPlaylist): String = buildString {
        append("#EXTM3U")
        playlist.epgUrl?.let { append(" url-tvg=\"").append(attribute(it)).append('"') }
        append('\n')
        playlist.channels.forEach { channel ->
            append("#EXTINF:-1")
            channel.tvgId?.let { append(" tvg-id=\"").append(attribute(it)).append('"') }
            channel.tvgName?.let { append(" tvg-name=\"").append(attribute(it)).append('"') }
            channel.logoUrl?.let { append(" tvg-logo=\"").append(attribute(it)).append('"') }
            channel.group?.let { append(" group-title=\"").append(attribute(it)).append('"') }
            channel.channelNumber?.let { append(" tvg-chno=\"").append(it).append('"') }
            if (channel.radio) append(" radio=\"true\"")
            channel.catchupSource?.let { append(" catchup-source=\"").append(attribute(it)).append('"') }
            channel.catchupType?.let { append(" catchup=\"").append(attribute(it)).append('"') }
            if (channel.catchupDays > 0) append(" catchup-days=\"").append(channel.catchupDays).append('"')
            append(',').append(channel.name).append('\n')
            channel.userAgent?.let { append("#EXTVLCOPT:http-user-agent=").append(it).append('\n') }
            channel.headers["Referer"]?.let { append("#EXTVLCOPT:http-referrer=").append(it).append('\n') }
            channel.headers["Origin"]?.let { append("#EXTVLCOPT:http-origin=").append(it).append('\n') }
            val drm = channel.drm
            drm?.clearKeys?.takeIf { it.isNotEmpty() }?.let { keys ->
                val license = keys.entries.joinToString(",") { (key, value) -> "$key:$value" }
                append("#KODIPROP:inputstream.adaptive.license_type=clearkey\n")
                append("#KODIPROP:inputstream.adaptive.license_key=").append(license).append('\n')
            }
            drm?.takeIf { it.clearKeys.isEmpty() }?.let { config ->
                append("#KODIPROP:inputstream.adaptive.license_type=").append(config.licenseType).append('\n')
                config.additionalProperties.toSortedMap().forEach { (key, value) ->
                    append("#KODIPROP:").append(key).append('=').append(value).append('\n')
                }
                if (config.licenseUrl != null || config.licenseHeaders.isNotEmpty() ||
                    config.licenseRequestData != null || config.licenseResponseData != null
                ) {
                    val encodedHeaders = config.licenseHeaders.entries.joinToString("&") { (name, value) ->
                        "${encodeLicenseHeaderComponent(name)}=${encodeLicenseHeaderComponent(value)}"
                    }
                    append("#KODIPROP:inputstream.adaptive.license_key=")
                        .append(config.licenseUrl.orEmpty())
                    if (config.licenseHeaders.isNotEmpty() || config.licenseRequestData != null ||
                        config.licenseResponseData != null
                    ) {
                        append('|').append(encodedHeaders)
                            .append('|').append(config.licenseRequestData.orEmpty())
                            .append('|').append(config.licenseResponseData.orEmpty())
                    }
                    append('\n')
                }
            }
            append(channel.url).append('\n')
        }
    }

    private fun encodeLicenseHeaderComponent(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name())

    private fun portableM3uUrl(url: String?): String? = url?.trim()?.takeIf {
        it.startsWith("http://", ignoreCase = true) || it.startsWith("https://", ignoreCase = true)
    }

    private fun attribute(value: String): String = value.replace('"', '\'')
}
