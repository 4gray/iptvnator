package com.iptvnator.googletv.playlist

import android.content.ContentResolver
import android.net.Uri
import android.util.Log
import java.io.File
import java.io.BufferedReader
import java.io.FileNotFoundException
import java.io.StringReader
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Future
import java.util.concurrent.ExecutionException

import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeoutException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import com.iptvnator.googletv.xtream.XtreamApiClient
import com.iptvnator.googletv.xtream.XtreamAccountInfo
import com.iptvnator.googletv.xtream.XtreamCredentials
import com.iptvnator.googletv.xtream.XtreamLiveStream
import com.iptvnator.googletv.xtream.xtreamArchiveDurationMinutes
import com.iptvnator.googletv.xtream.XtreamSeriesDetails
import com.iptvnator.googletv.xtream.XtreamSeriesEpisode
import com.iptvnator.googletv.xtream.XtreamSeriesItem
import com.iptvnator.googletv.xtream.XtreamVodDetails
import com.iptvnator.googletv.xtream.XtreamVodStream
import com.iptvnator.googletv.xtream.TvXtreamStreamFormat
import com.iptvnator.googletv.net.decodeHttpResponseBody
import com.iptvnator.googletv.net.decodeGzipPayloadIfPresent
import com.iptvnator.googletv.playback.TvPlaybackRequest
import com.iptvnator.googletv.stalker.StalkerApiClient
import com.iptvnator.googletv.stalker.StalkerCredentials
import com.iptvnator.googletv.stalker.StalkerSession
import com.iptvnator.googletv.stalker.StalkerRequestBuilder
import com.iptvnator.googletv.stalker.stalkerSeasonNumber
import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.epg.TvEpgSearchHit
import com.iptvnator.googletv.epg.TvXmlTvParser
import com.iptvnator.googletv.tmdb.TmdbApiClient
import com.iptvnator.googletv.tmdb.TmdbCache
import com.iptvnator.googletv.tmdb.TmdbDetails
import com.iptvnator.googletv.tmdb.TmdbSearchResult

private const val STALKER_EPG_SESSION_TTL_MS = 120_000L

data class TvPlaylistSource(
    val url: String,
    val name: String = "Remote playlist",
    val userAgent: String? = null,
    val epgUrl: String? = null,
    val referrer: String? = null,
    val origin: String? = null,
)

private fun applyM3uSourceHeaderDefaults(
    channel: TvChannel,
    userAgent: String?,
    referrer: String?,
    origin: String?,
): TvChannel {
    val headers = channel.headers.toMutableMap()
    fun addDefault(name: String, value: String?) {
        val normalized = value?.trim()?.takeIf(String::isNotBlank) ?: return
        if (headers.keys.none { it.equals(name, ignoreCase = true) }) headers[name] = normalized
    }
    addDefault("Referer", referrer)
    addDefault("Origin", origin)
    return channel.copy(
        userAgent = channel.userAgent?.takeIf(String::isNotBlank) ?: userAgent?.trim()?.takeIf(String::isNotBlank),
        headers = headers,
    )
}

data class TvProviderAccount(
    val xtream: XtreamCredentials? = null,
    val stalker: StalkerCredentials? = null,
)

data class TvXtreamImportProgress(
    val phase: String,
    val current: Int = 0,
)

class TvPlaylistRepository(
    private val store: TvPlaylistStore,
    private val xtreamClient: XtreamApiClient = XtreamApiClient(),
    private val credentialVault: TvCredentialVault? = null,
    private val xtreamCredentials: MutableMap<String, XtreamCredentials> = mutableMapOf(),
    private val stalkerClient: StalkerApiClient = StalkerApiClient(),
    private val stalkerCredentials: MutableMap<String, StalkerCredentials> = mutableMapOf(),
    private val tmdbClient: TmdbApiClient = TmdbApiClient(),
    private val tmdbCache: TmdbCache? = null,
    private val contentResolver: ContentResolver? = null,
) {
    private val xtreamAccounts = ConcurrentHashMap<String, XtreamAccountInfo>()
    private data class CachedStalkerEpgSession(
        val credentials: StalkerCredentials,
        val session: StalkerSession,
        val authenticatedAtMs: Long,
    )
    private val stalkerEpgSessions = ConcurrentHashMap<String, CachedStalkerEpgSession>()

    /** Loads only the TV startup window; callers needing a complete snapshot can request it explicitly. */
    fun loadStored(catalogLimit: Int = 500): List<StoredPlaylist> =
        store.getPlaylists(catalogLimit).map { playlist ->
            // Older imports allowed an empty display name. Keep those sources
            // addressable in the TV selector and dashboard instead of drawing
            // a blank card; new imports already apply the same fallback before
            // persistence.
            playlist.copy(
                name = playlist.name.trim().ifBlank {
                if (playlist.sourceUrl.isNullOrBlank() || playlist.sourceUrl.startsWith("content:", true) ||
                    playlist.sourceUrl.startsWith("file:", true)) "Local playlist" else "Remote playlist"
                },
                catalogCounts = store.getPlaylistCounts(playlist.id),
            )
        }

    /**
     * Builds the complete source snapshot required by backup export without
     * making normal startup materialise VOD/series or live catalogues.
     * Backups need every M3U channel; Xtream/Stalker sources are restored from
     * credentials and therefore do not need their cached catalogues serialized.
     */
    fun loadStoredForBackup(pageSize: Int = 500): List<StoredPlaylist> =
        loadStored(pageSize).map { playlist ->
            val account = loadProviderAccount(playlist.id)
            if (account.xtream != null || account.stalker != null) return@map playlist
            val expected = store.getPlaylistCounts(playlist.id).channels
            if (playlist.channels.size >= expected) return@map playlist
            val allChannels = playlist.channels.toMutableList()
            while (allChannels.size < expected) {
                val page = store.getChannelPage(playlist.id, allChannels.size, pageSize)
                if (page.isEmpty()) break
                allChannels += page
            }
            playlist.copy(channels = allChannels)
        }

    fun loadPlaylistCounts(playlistId: String): TvPlaylistCounts = store.getPlaylistCounts(playlistId)

    fun loadChannelPage(
        playlistId: String,
        offset: Int,
        limit: Int = 500,
        radioOnly: Boolean? = null,
        sortByName: Boolean = false,
        descending: Boolean = false,
    ): List<TvChannel> = store.getChannelPage(playlistId, offset, limit, radioOnly, sortByName, descending)

    fun loadGroupedChannelPage(
        playlistId: String,
        offset: Int,
        limit: Int = 500,
        radioOnly: Boolean,
    ): List<TvChannel> = store.getGroupedChannelPage(playlistId, offset, limit, radioOnly)

    fun loadChannelGroupPage(
        playlistId: String,
        groupName: String,
        offset: Int,
        limit: Int = 500,
        radioOnly: Boolean,
        sortByName: Boolean = false,
        descending: Boolean = false,
    ): List<TvChannel> = store.getChannelGroupPage(playlistId, groupName, offset, limit, radioOnly, sortByName, descending)

    fun loadChannelGroupCounts(playlistId: String, radioOnly: Boolean = false): Map<String, Int> =
        store.getChannelGroupCounts(playlistId, radioOnly)

    fun loadHiddenGroupTitles(playlistId: String): List<String> = store.getHiddenGroupTitles(playlistId)

    fun saveHiddenGroupTitles(playlistId: String, titles: List<String>): Boolean =
        store.setHiddenGroupTitles(playlistId, titles)

    fun loadHiddenCategories(playlistId: String): List<TvHiddenCategory> = store.getHiddenCategories(playlistId)

    fun saveHiddenCategories(playlistId: String, categories: List<TvHiddenCategory>): Boolean =
        store.setHiddenCategories(playlistId, categories)

    fun loadChannel(playlistId: String, channelId: String): TvChannel? =
        store.getChannel(playlistId, channelId)

    fun loadChannelsByIds(playlistId: String, channelIds: List<String>, radioOnly: Boolean? = null): List<TvChannel> =
        store.getChannelsByIds(playlistId, channelIds, radioOnly)

    fun loadChannelAtPosition(playlistId: String, position: Int, radioOnly: Boolean? = null): TvChannel? =
        store.getChannelAtPosition(playlistId, position, radioOnly)

    fun loadChannelAtPositionAcrossPlaylists(
        playlistIds: List<String>,
        position: Int,
        radioOnly: Boolean,
    ): Pair<String, TvChannel>? = store.getChannelAtPositionAcrossPlaylists(playlistIds, position, radioOnly)

    fun loadChannelByNumber(playlistId: String, number: Int, radioOnly: Boolean? = null): TvChannel? =
        store.getChannelByNumber(playlistId, number, radioOnly)

    fun loadAdjacentChannel(playlistId: String, channelId: String, delta: Int): TvChannel? =
        store.getAdjacentChannel(playlistId, channelId, delta)

    fun loadAdjacentChannelInScope(
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
    ): TvChannel? = store.getAdjacentChannelInScope(
        playlistId = playlistId,
        channelId = channelId,
        delta = delta,
        groupName = groupName,
        providerCategoryId = providerCategoryId,
        sortByName = sortByName,
        descending = descending,
        wrap = wrap,
        hiddenGroupTitles = hiddenGroupTitles,
        hiddenCategoryIds = hiddenCategoryIds,
    )

    fun loadAdjacentChannelAcrossPlaylists(
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
    ): Pair<String, TvChannel>? = store.getAdjacentChannelAcrossPlaylists(
        playlistIds = playlistIds,
        playlistId = playlistId,
        channelId = channelId,
        delta = delta,
        groupName = groupName,
        providerCategoryId = providerCategoryId,
        sortByName = sortByName,
        descending = descending,
        hiddenGroupTitlesByPlaylist = hiddenGroupTitlesByPlaylist,
        hiddenCategoryIdsByPlaylist = hiddenCategoryIdsByPlaylist,
    )

    fun searchChannels(
        playlistId: String,
        query: String,
        limit: Int = 200,
        radioOnly: Boolean? = null,
        offset: Int = 0,
        sortByName: Boolean = false,
        descending: Boolean = false,
    ): List<TvChannel> = store.searchChannels(playlistId, query, limit, radioOnly, offset, sortByName, descending)

    fun countMatchingChannels(playlistId: String, query: String, radioOnly: Boolean? = null): Int =
        store.countMatchingChannels(playlistId, query, radioOnly)

    fun loadVodPage(playlistId: String, offset: Int, limit: Int = 500): List<TvVodItem> =
        store.getVodPage(playlistId, offset, limit)

    fun loadVodCategories(playlistId: String): List<String> = store.getVodCategories(playlistId)

    fun loadVodCategoryMappings(playlistId: String): List<TvCatalogCategoryMapping> = store.getVodCategoryMappings(playlistId)

    fun loadVodCategoryPage(playlistId: String, categoryId: String, offset: Int, limit: Int = 500): List<TvVodItem> =
        store.getVodCategoryPage(playlistId, categoryId, offset, limit)

    fun loadVodItem(playlistId: String, vodId: Int): TvVodItem? =
        store.getVodItem(playlistId, vodId)

    fun searchVod(playlistId: String, query: String, limit: Int = 200, offset: Int = 0, categoryId: String? = null): List<TvVodItem> =
        store.searchVod(playlistId, query, limit, offset, categoryId)

    fun loadRecentVodPage(playlistId: String, limit: Int = 100): List<TvVodItem> =
        store.getRecentVodPage(playlistId, limit)

    fun loadSeriesPage(playlistId: String, offset: Int, limit: Int = 500): List<TvSeriesItem> =
        store.getSeriesPage(playlistId, offset, limit)

    fun loadSeriesCategories(playlistId: String): List<String> = store.getSeriesCategories(playlistId)

    fun loadSeriesCategoryMappings(playlistId: String): List<TvCatalogCategoryMapping> = store.getSeriesCategoryMappings(playlistId)

    fun loadSeriesCategoryPage(playlistId: String, categoryId: String, offset: Int, limit: Int = 500): List<TvSeriesItem> =
        store.getSeriesCategoryPage(playlistId, categoryId, offset, limit)

    fun loadSeriesItem(playlistId: String, seriesId: Int): TvSeriesItem? =
        store.getSeriesItem(playlistId, seriesId)

    fun searchSeries(playlistId: String, query: String, limit: Int = 200, offset: Int = 0, categoryId: String? = null): List<TvSeriesItem> =
        store.searchSeries(playlistId, query, limit, offset, categoryId)

    fun loadRecentSeriesPage(playlistId: String, limit: Int = 100): List<TvSeriesItem> =
        store.getRecentSeriesPage(playlistId, limit)

    fun loadFavorites(): List<TvSavedItem> = store.getFavorites()

    fun loadHistory(): List<TvSavedItem> = store.getHistory()

    fun loadWatched(): List<TvSavedItem> = store.getWatched()

    fun loadProviderAccount(playlistId: String): TvProviderAccount = TvProviderAccount(
        xtream = xtreamCredentials[playlistId]
            ?: credentialVault?.load(playlistId)?.also { xtreamCredentials[playlistId] = it },
        stalker = stalkerCredentials[playlistId]
            ?: credentialVault?.loadStalker(playlistId)?.also { stalkerCredentials[playlistId] = it },
    )

    /** Builds an Xtream live request using the TV user's preferred container. */
    fun resolveXtreamChannelPlayback(
        playlistId: String,
        channel: TvChannel,
        format: TvXtreamStreamFormat,
    ): TvPlaybackRequest? {
        if (!channel.id.startsWith("xtream:")) return null
        val streamId = channel.id.substringAfter("xtream:").toIntOrNull() ?: return null
        val credentials = loadProviderAccount(playlistId).xtream ?: return null
        val extension = when (format) {
            TvXtreamStreamFormat.TS -> "ts"
            TvXtreamStreamFormat.M3U8 -> "m3u8"
            TvXtreamStreamFormat.AUTO -> channel.url.substringBefore('?').substringAfterLast('.', "m3u8").lowercase()
                .takeIf { it == "ts" || it == "m3u8" } ?: "m3u8"
        }
        return TvPlaybackRequest(
            uri = xtreamClient.liveStreamUrl(credentials, streamId, extension),
            title = channel.name,
            userAgent = channel.userAgent,
            headers = channel.headers,
            isLive = true,
            isAudio = channel.radio,
            drm = channel.drm,
        )
    }

    fun loadXtreamAccountInfo(playlistId: String): com.iptvnator.googletv.xtream.XtreamAccountInfo? {
        val credentials = loadProviderAccount(playlistId).xtream ?: return null
        return xtreamClient.getAccountInfo(credentials)
    }

    fun loadStalkerAccountInfo(playlistId: String): StalkerSession? {
        val credentials = loadProviderAccount(playlistId).stalker ?: return null
        return stalkerClient.authenticate(credentials)
    }

    /** Bounded, session-reusing short-EPG request used only for visible Stalker channels. */
    fun loadStalkerShortEpg(playlistId: String, channelId: String, size: Int = 3): List<TvEpgEntry> {
        val credentials = loadProviderAccount(playlistId).stalker ?: return emptyList()
        val now = System.currentTimeMillis()
        val cached = stalkerEpgSessions[playlistId]
        val session = if (
            cached != null && cached.credentials == credentials &&
            now - cached.authenticatedAtMs < STALKER_EPG_SESSION_TTL_MS
        ) {
            cached.session
        } else {
            synchronized(stalkerEpgSessions) {
                val current = stalkerEpgSessions[playlistId]
                if (
                    current != null && current.credentials == credentials &&
                    System.currentTimeMillis() - current.authenticatedAtMs < STALKER_EPG_SESSION_TTL_MS
                ) {
                    current.session
                } else {
                    stalkerClient.authenticate(credentials).also { authenticated ->
                        stalkerEpgSessions[playlistId] = CachedStalkerEpgSession(
                            credentials,
                            authenticated,
                            System.currentTimeMillis(),
                        )
                    }
                }
            }
        }
        return try {
            stalkerClient.getShortEpgInfo(session, channelId, size)
        } catch (failure: Throwable) {
            if (stalkerEpgSessions[playlistId]?.session === session) stalkerEpgSessions.remove(playlistId)
            throw failure
        }
    }

    fun restoreSavedItem(item: TvSavedItem) = store.restoreSavedItem(item)

    fun recordPlaybackPosition(item: TvSavedItem, positionMs: Long, durationMs: Long) =
        store.recordPlaybackPosition(item, positionMs, durationMs)

    fun setWatched(item: TvSavedItem, watched: Boolean) = store.setWatched(item, watched)

    fun removeFromHistory(item: TvSavedItem) = store.removeFromHistory(item)

    fun clearHistory(playlistId: String? = null) = store.clearHistory(playlistId)

    fun recordEpisodeProgress(playlistId: String, seriesId: Int, episodeId: Int, positionMs: Long, durationMs: Long) =
        store.recordEpisodeProgress(playlistId, seriesId, episodeId, positionMs, durationMs)

    fun loadEpisodeProgress(playlistId: String, seriesId: Int): Map<Int, TvEpisodeProgress> =
        store.getEpisodeProgress(playlistId, seriesId)

    fun loadEpisodeProgressForPlaylist(playlistId: String): List<TvEpisodeProgress> =
        store.getEpisodeProgressForPlaylist(playlistId)

    fun restoreEpisodeProgress(progress: TvEpisodeProgress) = store.restoreEpisodeProgress(progress)

    fun setEpisodesWatched(
        playlistId: String,
        seriesId: Int,
        episodeIds: Collection<Int>,
        watched: Boolean,
    ) = store.setEpisodesWatched(playlistId, seriesId, episodeIds, watched)

    fun deletePlaylist(id: String) {
        store.deletePlaylist(id)
        xtreamCredentials.remove(id)
        xtreamAccounts.remove(id)
        stalkerCredentials.remove(id)
        credentialVault?.remove(id)
    }

    fun updateEpgUrl(playlistId: String, value: String) {
        updateEpgUrls(playlistId, listOf(value))
    }

    fun updateEpgUrls(playlistId: String, values: List<String>) {
        val normalized = values.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        normalized.forEach { value ->
            val uri = URI(value)
            require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true) ||
                uri.scheme.equals("content", true) || uri.scheme.equals("file", true)) {
                "La fuente EPG debe ser HTTP(S) o un archivo local seleccionado en Android TV"
            }
        }
        store.updateEpgSourceConfiguration(playlistId, normalized)
    }

    fun loadEpgSourceStates(playlistId: String): List<TvEpgSourceState> =
        store.getEpgSourceStates(playlistId)

    fun setEpgSourceEnabled(playlistId: String, url: String, enabled: Boolean): Boolean =
        store.setEpgSourceEnabled(playlistId, url, enabled)

    fun restoreEpgSourceStates(playlistId: String, states: List<TvEpgSourceState>) {
        states.forEach { state ->
            val uri = URI(state.url)
            require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true) ||
                uri.scheme.equals("content", true) || uri.scheme.equals("file", true)) {
                "La fuente EPG debe ser HTTP(S) o un archivo local seleccionado en Android TV"
            }
        }
        store.setEpgSourceStates(playlistId, states)
        store.setPrimaryEpgUrl(playlistId, states.firstOrNull(TvEpgSourceState::enabled)?.url)
    }

    fun renamePlaylist(playlistId: String, value: String) {
        val normalized = value.trim()
        require(normalized.isNotBlank()) { "El nombre de la playlist no puede estar vacío" }
        check(store.updatePlaylistName(playlistId, normalized)) { "No se pudo renombrar la playlist" }
    }

    /** Refreshes a provider or a selected M3U file without changing the playlist identity. */
    fun refreshPlaylist(
        playlist: StoredPlaylist,
        onXtreamProgress: (TvXtreamImportProgress) -> Unit = {},
    ): StoredPlaylist {
        // Prefer the in-memory account first. Tests, restored sessions and a
        // repository constructed without a vault can legitimately have valid
        // credentials there; falling straight through to the provider's base
        // URL would treat an Xtream source as a plain M3U URL.
        loadProviderAccount(playlist.id).xtream?.let { credentials ->
            return importXtream(
                credentials,
                playlist.name,
                epgUrl = playlist.epgUrl,
                epgUrls = playlist.epgUrls,
                onProgress = onXtreamProgress,
                playlistIdOverride = playlist.id,
            )
        }
        loadProviderAccount(playlist.id).stalker?.let { credentials ->
            return importStalker(credentials, playlist.name, playlist.epgUrl, playlistIdOverride = playlist.id)
        }
        val sourceUrl = playlist.sourceUrl?.trim()?.takeIf(String::isNotBlank)
            ?: error("Esta lista no conserva un archivo o URL que se pueda actualizar")
        val explicitManualEpgUrl = playlist.epgUrl?.takeIf { url ->
            store.getEpgSourceStates(playlist.id).none { it.url == url && it.detected }
        }
        if (sourceUrl.startsWith("content://", true) || sourceUrl.startsWith("file://", true)) {
            val uri = Uri.parse(sourceUrl)
            val input = try {
                when (uri.scheme?.lowercase()) {
                    "content" -> contentResolver?.openInputStream(uri)
                        ?: throw FileNotFoundException("El proveedor no devolvió el archivo")
                    "file" -> File(uri.path ?: throw FileNotFoundException("Ruta de archivo vacía")).inputStream()
                    else -> error("Tipo de archivo M3U no compatible")
                }
            } catch (failure: FileNotFoundException) {
                throw IllegalStateException("No se encuentra el archivo M3U. Comprueba su ubicación o vuelve a importarlo.", failure)
            } catch (failure: SecurityException) {
                throw IllegalStateException("La app ya no tiene permiso para leer el archivo M3U. Vuelve a seleccionarlo.", failure)
            }
            return input.bufferedReader().use { reader ->
                importM3uReader(
                    reader = reader,
                    name = playlist.name,
                    identitySeed = sourceUrl,
                    sourceUrl = sourceUrl,
                    epgUrl = explicitManualEpgUrl,
                    userAgent = playlist.sourceUserAgent,
                    sourceReferrer = playlist.sourceReferrer,
                    sourceOrigin = playlist.sourceOrigin,
                    playlistIdOverride = playlist.id,
                )
            }
        }
        require(sourceUrl.startsWith("http://", true) || sourceUrl.startsWith("https://", true)) {
            "Esta fuente no tiene una URL o archivo M3U compatible para actualizar"
        }
        return importRemote(
            TvPlaylistSource(
                url = sourceUrl,
                name = playlist.name,
                userAgent = playlist.sourceUserAgent,
                epgUrl = explicitManualEpgUrl,
                referrer = playlist.sourceReferrer,
                origin = playlist.sourceOrigin,
            ),
            playlistIdOverride = playlist.id,
        )
    }

    fun tmdbMovieDetails(title: String, language: String = "es-ES"): TmdbDetails? {
        val apiKey = credentialVault?.loadTmdbApiKey()?.takeIf { it.isNotBlank() } ?: return null
        tmdbCache?.get("movie", title, language)?.let { return it }
        val match = tmdbClient.searchMovie(title, language, apiKey).firstOrNull() ?: return null
        return tmdbClient.getMovieDetails(match.id, language, apiKey).also {
            tmdbCache?.put("movie", title, language, it)
        }
    }

    fun tmdbSeriesDetails(title: String, language: String = "es-ES"): TmdbDetails? {
        val apiKey = credentialVault?.loadTmdbApiKey()?.takeIf { it.isNotBlank() } ?: return null
        tmdbCache?.get("series", title, language)?.let { return it }
        val match = tmdbClient.searchTv(title, language, apiKey).firstOrNull() ?: return null
        return tmdbClient.getTvDetails(match.id, language, apiKey).also {
            tmdbCache?.put("series", title, language, it)
        }
    }

    fun tmdbTrending(language: String = "es-ES"): List<TmdbSearchResult> {
        val apiKey = credentialVault?.loadTmdbApiKey()?.takeIf { it.isNotBlank() } ?: return emptyList()
        tmdbCache?.getTrending(language)?.let { return it }
        return tmdbClient.trending(language, apiKey).also { items ->
            tmdbCache?.putTrending(language, items)
        }
    }

    fun tmdbRecommendations(items: List<TvSavedItem>, language: String = "es-ES"): List<TmdbSearchResult> {
        val apiKey = credentialVault?.loadTmdbApiKey()?.takeIf { it.isNotBlank() } ?: return emptyList()
        return items.asSequence()
            .filter { it.itemType == TvSavedItemType.VOD || it.itemType == TvSavedItemType.SERIES }
            .take(3)
            .flatMap { item ->
                val details = when (item.itemType) {
                    TvSavedItemType.VOD -> tmdbMovieDetails(item.title, language)
                    TvSavedItemType.SERIES -> tmdbSeriesDetails(item.title, language)
                    TvSavedItemType.CHANNEL -> null
                }
                details?.similar.orEmpty().asSequence()
            }
            .filter { it.id > 0 && it.title.isNotBlank() }
            .distinctBy { "${it.mediaType}:${it.id}" }
            .take(20)
            .toList()
    }

    fun xtreamVodDetails(playlistId: String, item: TvVodItem): XtreamVodDetails? {
        val credentials = xtreamCredentials[playlistId]
            ?: credentialVault?.load(playlistId)?.also { xtreamCredentials[playlistId] = it }
            ?: return null
        return runCatching { xtreamClient.getVodInfo(credentials, item.id) }.getOrNull()
    }

    fun importEpg(sourceId: String, url: String, replaceExisting: Boolean = true): Int {
        val parsedUri = URI(url)
        val isHttp = parsedUri.scheme.equals("http", true) || parsedUri.scheme.equals("https", true)
        return store.beginEpgImport(sourceId, replaceExisting).use { writer ->
            if (isHttp) {
                val connection = parsedUri.toURL().openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 15_000
                    connection.readTimeout = 60_000
                    connection.instanceFollowRedirects = true
                    connection.setRequestProperty("Accept-Encoding", "gzip, deflate")
                    connection.connect()
                    check(connection.responseCode in 200..299) { "EPG request failed with HTTP ${connection.responseCode}" }
                    decodeHttpResponseBody(connection.inputStream, connection.contentEncoding).use { input ->
                        TvXmlTvParser.parse(input, writer::add)
                    }
                } finally {
                    connection.disconnect()
                }
            } else {
                val input = when {
                    parsedUri.scheme.equals("content", true) -> contentResolver?.openInputStream(Uri.parse(url))
                    parsedUri.scheme.equals("file", true) -> File(parsedUri.path ?: error("EPG file path is missing")).inputStream()
                    else -> null
                } ?: error("No se pudo abrir el archivo XMLTV local")
                decodeGzipPayloadIfPresent(input).use { xml -> TvXmlTvParser.parse(xml, writer::add) }
            }
            writer.finish()
            Log.i("TvEpg", "parsed=${writer.entriesWritten} source=${parsedUri.host ?: "unknown"}")
            writer.entriesWritten
        }
    }

    fun epgForChannel(sourceId: String, channelId: String, fromMs: Long, toMs: Long): List<TvEpgEntry> =
        store.getEpg(sourceId, channelId, fromMs, toMs)

    fun searchEpgPrograms(
        playlists: Collection<StoredPlaylist>,
        query: String,
        guideFilter: String,
        nowMs: Long,
        limit: Int = 20,
    ): List<TvEpgSearchHit> = store.searchEpgPrograms(
        playlistIds = playlists.map(StoredPlaylist::id),
        query = query,
        guideFilter = guideFilter,
        nowMs = nowMs,
        limit = limit,
    ).map { hit -> TvEpgSearchHit(hit.playlistId, hit.channel, hit.programme) }

    fun loadEpgMapping(sourceId: String, channelId: String): String? =
        store.getEpgMapping(sourceId, channelId)

    fun setEpgMapping(sourceId: String, channelId: String, epgChannelId: String?) =
        store.setEpgMapping(sourceId, channelId, epgChannelId)

    fun loadEpgSnapshot(
        playlists: List<StoredPlaylist>,
        windowMs: Long = 6 * 60 * 60 * 1000L,
        centerMs: Long = System.currentTimeMillis(),
    ): Map<String, List<TvEpgEntry>> {
        val now = centerMs
        return playlists.flatMap { playlist ->
            // Large Xtream playlists commonly have no EPG rows until the
            // user imports or refreshes a guide. Avoid issuing mapping and
            // programme queries for every channel in that common case.
            if (!store.hasEpg(playlist.id)) return@flatMap emptyList()
            // Query guide mappings and programmes in batches rather than
            // performing up to six SQLite queries for every channel. This is
            // especially important when the user pages through a large
            // Xtream catalogue with an XMLTV guide attached.
            val manualMappings = store.getEpgMappings(playlist.id, playlist.channels.map { it.id })
            val candidates = playlist.channels.map { channel ->
                val catchupWindowMs = maxOf(
                    24L * 60L * 60L * 1_000L,
                    channel.catchupDays.toLong().coerceAtLeast(0L) * 24L * 60L * 60L * 1_000L,
                    channel.tvArchiveDurationMinutes.toLong().coerceAtLeast(0L) * 60L * 1_000L,
                )
                // XMLTV providers are inconsistent about their channel key.
                // Keep the stable local id first, then try tvg-id and the
                // visible name, matching IPTVnator's tvg-id/tvg-name/name
                // fallback order for guides that omit a shared identifier.
                val channelIds = listOfNotNull(
                    manualMappings[channel.id]?.takeIf { it.isNotBlank() },
                    channel.id,
                    channel.tvgId?.takeIf { it.isNotBlank() },
                    channel.tvgName?.takeIf { it.isNotBlank() },
                    channel.name.takeIf { it.isNotBlank() },
                ).distinct()
                Triple(channel, catchupWindowMs, channelIds)
            }
            val snapshot = mutableListOf<Pair<String, List<TvEpgEntry>>>()
            // Group equal catch-up windows to avoid broad queries when only a
            // few channels advertise a longer archive duration.
            candidates.groupBy { it.second }.forEach { (catchupWindowMs, batch) ->
                val programmesById = store.getEpgForChannels(
                    playlist.id,
                    batch.flatMap { it.third }.distinct(),
                    now - catchupWindowMs,
                    now + windowMs,
                )
                batch.forEach { (channel, _, channelIds) ->
                    val programmes = channelIds
                        .flatMap { channelId -> programmesById[channelId].orEmpty() }
                        .distinctBy { it.startMs to it.title }
                        .sortedBy { it.startMs }
                    snapshot += "${playlist.id}:${channel.id}" to programmes
                }
            }
            snapshot
        }.toMap()
    }

    /** Refreshes configured XMLTV sources and bulk-capable Stalker guides. */
    fun refreshEpg(playlists: List<StoredPlaylist>): Int = playlists.sumOf { playlist ->
        // One provider's expired XMLTV URL must not prevent the remaining
        // sources from updating. The UI reports the aggregate successful
        // count and keeps the failed source available for a later retry.
        runCatching {
            val xtream = xtreamCredentials[playlist.id]
                ?: credentialVault?.load(playlist.id)?.also { xtreamCredentials[playlist.id] = it }
            val stalker = stalkerCredentials[playlist.id]
                ?: credentialVault?.loadStalker(playlist.id)?.also { stalkerCredentials[playlist.id] = it }
            when {
                // Xtream exposes preview EPG per stream, not a bulk guide.
                // Those previews are fetched only for channels visible in the
                // TV list; sweeping every stream here can mean tens of
                // thousands of requests during startup or an XMLTV refresh.
                xtream != null -> refreshManualEpg(playlist)
                stalker != null -> refreshStalkerEpg(playlist, stalker)
                playlist.epgUrls.isNotEmpty() -> refreshManualEpg(playlist)
                playlist.epgUrl?.isNotBlank() == true -> importEpg(playlist.id, playlist.epgUrl)
                else -> 0
            }
        }.getOrDefault(0)
    }

    private fun refreshManualEpg(playlist: StoredPlaylist): Int {
        if (playlist.epgUrls.isEmpty()) return 0
        var importedAny = false
        var importedCount = 0
        playlist.epgUrls.forEach { url ->
            val count = runCatching {
                importEpg(playlist.id, url, replaceExisting = !importedAny)
            }.getOrDefault(0)
            if (count > 0) {
                importedAny = true
                importedCount += count
            }
        }
        return importedCount
    }

    /** Loads one Xtream preview for a channel currently visible on the TV. */
    fun loadXtreamShortEpg(playlistId: String, channelId: String, limit: Int = 10): List<TvEpgEntry> {
        val credentials = loadProviderAccount(playlistId).xtream ?: return emptyList()
        val streamId = channelId.substringAfter("xtream:", "").toIntOrNull() ?: return emptyList()
        return xtreamClient.getShortEpg(credentials, streamId, channelId, limit)
    }

    private fun refreshStalkerEpg(playlist: StoredPlaylist, credentials: StalkerCredentials): Int {
        val session = stalkerClient.authenticate(credentials)
        val entries = stalkerClient.getEpgInfo(session)
        if (entries.isNotEmpty()) store.replaceEpg(playlist.id, entries)
        return entries.size
    }

    fun recordChannelPlayback(playlistId: String, channel: TvChannel) = store.recordPlayback(
        TvSavedItem(playlistId, TvSavedItemType.CHANNEL, channel.id, channel.name, channel.url, channel.logoUrl, System.currentTimeMillis(), null)
    )

    fun recordVodPlayback(playlistId: String, item: TvVodItem) = store.recordPlayback(
        TvSavedItem(playlistId, TvSavedItemType.VOD, item.id.toString(), item.name, item.url, item.coverUrl, System.currentTimeMillis(), null)
    )

    fun recordSeriesOpened(playlistId: String, item: TvSeriesItem) = store.recordPlayback(
        TvSavedItem(playlistId, TvSavedItemType.SERIES, item.id.toString(), item.name, "", item.coverUrl, System.currentTimeMillis(), null)
    )

    fun importRemote(
        source: TvPlaylistSource,
        playlistIdOverride: String? = null,
        onPhase: (String) -> Unit = {},
    ): StoredPlaylist {
        val parsedUri = URI(source.url)
        require(parsedUri.scheme.equals("http", ignoreCase = true) || parsedUri.scheme.equals("https", ignoreCase = true)) {
            "Playlist URL must use HTTP or HTTPS"
        }
        val connection = parsedUri.toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("Accept-Encoding", "gzip, deflate")
            source.userAgent?.let { connection.setRequestProperty("User-Agent", it) }
            connection.connect()
            check(connection.responseCode in 200..299) {
                "Playlist request failed with HTTP ${connection.responseCode}"
            }
            val id = playlistIdOverride ?: source.url.trim().lowercase().hashCode().toUInt().toString(16)
            val explicitEpgUrls = listOfNotNull(source.epgUrl?.trim()?.takeIf(String::isNotBlank))
            val writer = store.beginM3uCatalog(
                id = id,
                name = source.name,
                sourceUrl = source.url,
                sourceUserAgent = source.userAgent?.trim()?.takeIf(String::isNotBlank),
                sourceReferrer = source.referrer?.trim()?.takeIf(String::isNotBlank),
                sourceOrigin = source.origin?.trim()?.takeIf(String::isNotBlank),
            )
            onPhase("Descargando canales…")
            val parsed = try {
                decodeHttpResponseBody(connection.inputStream, connection.contentEncoding)
                    .bufferedReader(Charsets.UTF_8).use { reader ->
                        M3uPlaylistParser.parseStreaming(reader, source.name) { channel ->
                            writer.addChannelKeepingDuplicates(
                                applyM3uSourceHeaderDefaults(channel, source.userAgent, source.referrer, source.origin),
                            )
                        }
                    }.also { playlist ->
                        writer.setEpgUrl(
                            (explicitEpgUrls + playlist.recommendedEpgUrls).distinct().firstOrNull()
                                ?: playlist.epgUrl,
                        )
                    }
            } catch (failure: Throwable) {
                writer.close()
                throw failure
            }
            writer.finish()
            clearProviderCredentials(id)
            val epgStates = store.reconcileM3uEpgSources(
                sourceId = id,
                detectedUrls = parsed.epgUrls,
                recommendedUrls = explicitEpgUrls + parsed.recommendedEpgUrls,
                manualUrls = explicitEpgUrls,
            )
            val enabledGuides = epgStates.filter(TvEpgSourceState::enabled)
            enabledGuides.forEachIndexed { index, epgSource ->
                onPhase("Descargando guía de programación ${index + 1}/${enabledGuides.size}…")
                runCatching { importEpg(id, epgSource.url, replaceExisting = false) }.onFailure {
                    Log.w("TvEpg", "optional guide import failed: ${it.javaClass.simpleName}")
                }
            }
            return store.getPlaylists(catalogLimit = 500).first { it.id == id }
        } finally {
            connection.disconnect()
        }
    }

    fun importM3uContent(
        content: String,
        name: String,
        sourceUrl: String? = null,
        epgUrl: String? = null,
        userAgent: String? = null,
        playlistIdOverride: String? = null,
        autoImportEpg: Boolean = true,
        sourceReferrer: String? = null,
        sourceOrigin: String? = null,
    ): StoredPlaylist = importM3uReader(
        reader = StringReader(content).buffered(),
        name = name,
        identitySeed = sourceUrl?.trim()?.lowercase() ?: "$name:${content.hashCode()}",
        sourceUrl = sourceUrl,
        epgUrl = epgUrl,
        userAgent = userAgent,
        playlistIdOverride = playlistIdOverride,
        autoImportEpg = autoImportEpg,
        sourceReferrer = sourceReferrer,
        sourceOrigin = sourceOrigin,
    )

    /** Imports local M3U streams without retaining the file or full channel list in memory. */
    fun importM3uReader(
        reader: BufferedReader,
        name: String,
        identitySeed: String,
        sourceUrl: String? = null,
        epgUrl: String? = null,
        userAgent: String? = null,
        playlistIdOverride: String? = null,
        autoImportEpg: Boolean = true,
        sourceReferrer: String? = null,
        sourceOrigin: String? = null,
    ): StoredPlaylist {
        val id = playlistIdOverride ?: identitySeed.hashCode().toUInt().toString(16)
        val defaultUserAgent = userAgent?.trim()?.takeIf(String::isNotBlank)
        val writer = store.beginM3uCatalog(
            id = id,
            name = name,
            sourceUrl = sourceUrl,
            sourceUserAgent = defaultUserAgent,
            sourceReferrer = sourceReferrer?.trim()?.takeIf(String::isNotBlank),
            sourceOrigin = sourceOrigin?.trim()?.takeIf(String::isNotBlank),
        )
        val parsed = try {
            M3uPlaylistParser.parseStreaming(reader, name) { channel ->
                writer.addChannelKeepingDuplicates(
                    applyM3uSourceHeaderDefaults(channel, defaultUserAgent, sourceReferrer, sourceOrigin),
                )
            }.also { playlist ->
                val explicitEpgUrls = listOfNotNull(epgUrl?.trim()?.takeIf(String::isNotBlank))
                writer.setEpgUrl(
                    (explicitEpgUrls + playlist.recommendedEpgUrls).distinct().firstOrNull()
                        ?: playlist.epgUrl,
                )
            }
        } catch (failure: Throwable) {
            writer.close()
            throw failure
        }
        writer.finish()
        clearProviderCredentials(id)
        val explicitEpgUrls = listOfNotNull(epgUrl?.trim()?.takeIf { it.isNotBlank() })
        // Retain every detected URL in the source inventory, but keep only
        // region recommendations enabled by default; prior user choices and
        // manual guide URLs survive refreshes.
        val epgStates = store.reconcileM3uEpgSources(
            sourceId = id,
            detectedUrls = parsed.epgUrls,
            recommendedUrls = explicitEpgUrls + parsed.recommendedEpgUrls,
            manualUrls = explicitEpgUrls,
        )
        if (autoImportEpg && epgStates.isNotEmpty()) {
            epgStates.filter(TvEpgSourceState::enabled).forEach { source ->
                runCatching { importEpg(id, source.url, replaceExisting = false) }.onFailure {
                    Log.w("TvEpg", "optional guide import failed: ${it.javaClass.simpleName}")
                }
            }
        }
        // Keep the result bounded as well as the import itself. Returning the
        // complete SQLite snapshot here would immediately materialise every
        // channel/VOD/series row again and undo the large-catalogue startup
        // optimisation before the caller can reload its normal TV window.
        return store.getPlaylists(catalogLimit = 500).first { it.id == id }
    }

    /** Imports the provider handouts accepted by the web app's auto-detect surface. */
    fun importAutoDetect(text: String, name: String, playlistIdOverride: String? = null): StoredPlaylist {
        return when (val source = detectTvSource(text)) {
            is TvDetectedSource.M3uText -> importM3uContent(source.content, name, playlistIdOverride = playlistIdOverride)
            is TvDetectedSource.M3uUrl -> importRemote(TvPlaylistSource(source.url, name), playlistIdOverride)
            is TvDetectedSource.Xtream -> importXtream(
                XtreamCredentials(source.server, source.username, source.password), name,
                playlistIdOverride = playlistIdOverride,
            )
            is TvDetectedSource.Stalker -> importStalker(
                StalkerCredentials(
                    portalUrl = source.portal,
                    macAddress = source.mac,
                    serialNumber = source.serialNumber,
                    username = source.username,
                    password = source.password,
                    deviceId1 = source.deviceId1,
                    deviceId2 = source.deviceId2,
                    signature1 = source.signature1,
                    signature2 = source.signature2,
                ),
                name,
                playlistIdOverride = playlistIdOverride,
            )
        }
    }

    private fun clearProviderCredentials(playlistId: String) {
        xtreamCredentials.remove(playlistId)
        xtreamAccounts.remove(playlistId)
        stalkerCredentials.remove(playlistId)
        credentialVault?.remove(playlistId)
    }

    private fun XtreamVodStream.toTvVodItem(
        credentials: XtreamCredentials,
        categories: Map<String, String>,
    ) = TvVodItem(
        id = id,
        name = name,
        url = xtreamClient.vodStreamUrl(credentials, id, containerExtension),
        categoryId = categoryId?.let { categories[it] ?: categoryName ?: it } ?: categoryName,
        providerCategoryId = categoryId,
        coverUrl = iconUrl,
        extension = containerExtension,
        rating = rating,
        providerType = "xtream",
        addedAtMs = addedAtMs,
    )

    private fun XtreamSeriesItem.toTvSeriesItem(categories: Map<String, String>) = TvSeriesItem(
        id = id,
        name = name,
        categoryId = categoryId?.let { categories[it] ?: categoryName ?: it } ?: categoryName,
        providerCategoryId = categoryId,
        coverUrl = coverUrl,
        plot = plot,
        rating = rating,
        addedAtMs = addedAtMs,
    )

    fun importXtream(
        credentials: XtreamCredentials,
        name: String,
        epgUrl: String? = null,
        epgUrls: List<String> = emptyList(),
        onProgress: (TvXtreamImportProgress) -> Unit = {},
        isCancelled: () -> Boolean = { false },
        playlistIdOverride: String? = null,
    ): StoredPlaylist {
        require(credentials.username.isNotBlank()) { "Xtream username is required" }
        require(credentials.password.isNotBlank()) { "Xtream password is required" }
        if (isCancelled()) throw CancellationException("Xtream import cancelled")

        onProgress(TvXtreamImportProgress("account"))
        val resolvedCredentials = xtreamClient.resolveWorkingCredentials(credentials)
        val workingCredentials = resolvedCredentials.first
        val account = resolvedCredentials.second
        check(account.authenticated) {
            if (account.status.equals("expired", ignoreCase = true) ||
                account.expirationEpochSeconds?.let { it <= java.time.Instant.now().epochSecond } == true
            ) "Xtream account expired" else "Xtream account authentication failed"
        }
        val liveExtension = xtreamClient.autoLiveStreamExtension(account.allowedOutputFormats)

        // Panels normally return numeric category IDs in the stream rows. Resolve
        // them once during import so the TV rails show the same human labels as
        // IPTVnator instead of exposing provider-internal IDs. These four small
        // metadata requests are independent; doing them serially adds the
        // latency of three extra network round trips before the 100+ MB catalog
        // streams can even begin.
        val metadataExecutor = Executors.newFixedThreadPool(4)
        val liveEvents = LinkedBlockingQueue<LiveImportEvent>(256)
        val liveFailure = AtomicReference<Throwable?>(null)
        val metadataFutures = mutableListOf<Future<*>>()
        fun <T> awaitMetadata(future: Future<T>): T {
            while (true) {
                if (isCancelled()) {
                    future.cancel(true)
                    throw CancellationException("Xtream import cancelled")
                }
                try {
                    return future.get(100, TimeUnit.MILLISECONDS)
                } catch (_: TimeoutException) {
                    // Keep the progress dialog's cancel action responsive
                    // while category metadata requests are still in flight.
                } catch (failure: ExecutionException) {
                    if (isCancelled() || failure.cause is CancellationException) {
                        throw CancellationException("Xtream import cancelled")
                    }
                    throw failure
                }
            }
        }
        val liveFuture = metadataExecutor.submit(Callable {
            fun enqueue(event: LiveImportEvent): Boolean {
                while (!liveEvents.offer(event, 250, TimeUnit.MILLISECONDS)) {
                    if (Thread.currentThread().isInterrupted) return false
                }
                return true
            }
            try {
                xtreamClient.forEachLiveStream(workingCredentials, isCancelled = isCancelled) { stream ->
                    if (isCancelled()) throw CancellationException("Xtream import cancelled")
                    if (!enqueue(LiveImportEvent.Row(stream))) {
                        throw CancellationException("Xtream import cancelled")
                    }
                }
            } catch (failure: Throwable) {
                liveFailure.compareAndSet(null, failure)
            } finally {
                enqueue(LiveImportEvent.End)
            }
        })
        onProgress(TvXtreamImportProgress("metadata"))
        val metadata = try {
            val liveCategoriesFuture = metadataExecutor.submit(Callable {
                try {
                    xtreamClient.getCategories(workingCredentials, com.iptvnator.googletv.xtream.XtreamCatalogType.LIVE, isCancelled)
                } catch (failure: Throwable) {
                    if (isCancelled()) throw CancellationException("Xtream import cancelled")
                    emptyList()
                }
            }).also { metadataFutures += it }
            val vodCategoriesFuture = metadataExecutor.submit(Callable {
                try {
                    xtreamClient.getCategories(workingCredentials, com.iptvnator.googletv.xtream.XtreamCatalogType.VOD, isCancelled)
                } catch (failure: Throwable) {
                    if (isCancelled()) throw CancellationException("Xtream import cancelled")
                    emptyList()
                }
            }).also { metadataFutures += it }
            val seriesCategoriesFuture = metadataExecutor.submit(Callable {
                try {
                    xtreamClient.getCategories(workingCredentials, com.iptvnator.googletv.xtream.XtreamCatalogType.SERIES, isCancelled)
                } catch (failure: Throwable) {
                    if (isCancelled()) throw CancellationException("Xtream import cancelled")
                    emptyList()
                }
            }).also { metadataFutures += it }
            if (isCancelled()) throw CancellationException("Xtream import cancelled")
            ImportMetadata(
                liveCategories = awaitMetadata(liveCategoriesFuture).associate { it.id to it.name },
                vodCategories = awaitMetadata(vodCategoriesFuture).associate { it.id to it.name },
                seriesCategories = awaitMetadata(seriesCategoriesFuture).associate { it.id to it.name },
            )
        } catch (failure: Throwable) {
            metadataFutures.forEach { it.cancel(true) }
            liveFuture.cancel(true)
            metadataExecutor.shutdownNow()
            throw failure
        }
        val id = playlistIdOverride ?: "xtream:${workingCredentials.serverUrl}:${workingCredentials.username}"
            .lowercase()
            .hashCode()
            .toUInt()
            .toString(16)
        val existingEpgSourceStates = if (playlistIdOverride != null) {
            store.getEpgSourceStates(id)
        } else {
            emptyList()
        }

        // Large panels can return hundreds of thousands of rows. Parse and
        // persist each object while the response is streaming so the TV
        // process never holds the JSON, mapped catalogues and DB transaction
        // inputs at the same time.
        var vodCount = 0
        var seriesCount = 0
        onProgress(TvXtreamImportProgress("vod"))
        val preservedEpgUrls = (epgUrls + listOfNotNull(epgUrl))
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
        val preserveExistingEpgPreferences = existingEpgSourceStates.isNotEmpty() &&
            existingEpgSourceStates.filter(TvEpgSourceState::enabled).map(TvEpgSourceState::url) == preservedEpgUrls
        try {
            store.beginXtreamCatalog(
                id,
                TvPlaylist(name = name.ifBlank { "Xtream playlist" }, channels = emptyList()),
                workingCredentials.serverUrl,
                preservedEpgUrls.firstOrNull(),
            ).use { catalog ->
                var liveCount = 0
                onProgress(TvXtreamImportProgress("live"))
                while (true) {
                    if (isCancelled()) throw CancellationException("Xtream import cancelled")
                    when (val event = liveEvents.take()) {
                        is LiveImportEvent.Row -> {
                            val stream = event.stream
                            catalog.addChannel(
                                TvChannel(
                                    id = "xtream:${stream.id}",
                                    name = stream.name,
                                    url = xtreamClient.liveStreamUrl(workingCredentials, stream.id, liveExtension),
                                    group = stream.categoryId?.let { metadata.liveCategories[it] ?: stream.categoryName ?: it }
                                        ?: stream.categoryName,
                                    providerCategoryId = stream.categoryId,
                                    logoUrl = stream.iconUrl,
                                    tvgId = stream.epgChannelId,
                                    userAgent = XtreamApiClient.ClientUserAgent,
                                    tvArchive = stream.tvArchive,
                                    tvArchiveDurationMinutes = xtreamArchiveDurationMinutes(stream.tvArchiveDuration),
                                ),
                            )
                            liveCount += 1
                            if (liveCount == 1 || liveCount % 500 == 0) {
                                onProgress(TvXtreamImportProgress("live", liveCount))
                            }
                        }
                        LiveImportEvent.End -> break
                    }
                }
                liveFailure.get()?.let { throw it }
                liveFuture.get()
                xtreamClient.forEachVodStream(workingCredentials) { item ->
                    if (isCancelled()) throw CancellationException("Xtream import cancelled")
                    catalog.addVod(item.toTvVodItem(workingCredentials, metadata.vodCategories))
                    vodCount += 1
                    if (vodCount == 1 || vodCount % 500 == 0) {
                        onProgress(TvXtreamImportProgress("vod", vodCount))
                    }
                }
                onProgress(TvXtreamImportProgress("series"))
                xtreamClient.forEachSeriesItem(workingCredentials) { item ->
                    if (isCancelled()) throw CancellationException("Xtream import cancelled")
                    catalog.addSeries(item.toTvSeriesItem(metadata.seriesCategories))
                    seriesCount += 1
                    if (seriesCount == 1 || seriesCount % 500 == 0) {
                        onProgress(TvXtreamImportProgress("series", seriesCount))
                    }
                }
                catalog.finish()
            }
        } finally {
            metadataExecutor.shutdownNow()
        }
        // An existing source's EPG URL list contains only enabled entries.
        // If that list is unchanged, retain the full inventory too, including
        // disabled sources and whether each URL was detected or user-added.
        // Replacing it with setEpgUrls here would silently re-enable or erase
        // the user's per-source choices every time Xtream is refreshed.
        if (preservedEpgUrls.isNotEmpty() && !preserveExistingEpgPreferences) {
            store.setEpgUrls(id, preservedEpgUrls)
        }
        onProgress(TvXtreamImportProgress("complete", seriesCount))
        stalkerCredentials.remove(id)
        xtreamCredentials[id] = workingCredentials
        xtreamAccounts[id] = account
        credentialVault?.save(id, workingCredentials)
        // Do not rehydrate a potentially very large Xtream catalogue merely
        // to return the newly imported playlist to the UI.
        return store.getPlaylists(catalogLimit = 500).first { it.id == id }
    }

    private data class ImportMetadata(
        val liveCategories: Map<String, String>,
        val vodCategories: Map<String, String>,
        val seriesCategories: Map<String, String>,
    )

    private sealed interface LiveImportEvent {
        data class Row(val stream: XtreamLiveStream) : LiveImportEvent
        data object End : LiveImportEvent
    }

    fun getSeriesDetails(playlistId: String, seriesId: Int): XtreamSeriesDetails {
        val stored = store.getSeriesItem(playlistId, seriesId)
        if (stored?.providerType == "stalker" || stored?.providerType == "stalker-vod-series") {
            val credentials = stalkerCredentials[playlistId] ?: credentialVault?.loadStalker(playlistId)?.also {
                stalkerCredentials[playlistId] = it
            } ?: error("Stalker credentials are not available for this session")
            val session = stalkerClient.authenticate(credentials)
            val details = if (stored.providerType == "stalker-vod-series") {
                stalkerClient.getVodSeriesDetails(session, seriesId, stored.providerCommand)
            } else {
                stalkerClient.getSeriesDetails(session, seriesId)
            }
            val episodes = details.seasons.flatMapIndexed { seasonIndex, season ->
                season.episodeNumbers.map { number ->
                    XtreamSeriesEpisode(
                        id = "stalker:$seriesId:${season.id}:$number".hashCode(),
                        title = "${season.name} · Episodio $number",
                        season = stalkerSeasonNumber(season.name, seasonIndex + 1),
                        episode = number,
                        extension = "mp4",
                        providerCommand = season.command,
                        providerType = if (season.contentType == "vod") "stalker-vod-series" else "stalker",
                        providerEpisode = number,
                    )
                }
            }
            return XtreamSeriesDetails(
                id = seriesId,
                name = details.title.ifBlank { stored.name },
                plot = stored.plot,
                coverUrl = stored.coverUrl,
                episodes = episodes,
            )
        }
        val credentials = xtreamCredentials[playlistId] ?: credentialVault?.load(playlistId)?.also {
            xtreamCredentials[playlistId] = it
        }
            ?: error("Xtream credentials are not available for this session")
        return xtreamClient.getSeriesInfo(credentials, seriesId)
    }

    /** Imports the live catalogue while retaining Stalker's native commands.
     * `create_link` is deliberately deferred: portals mint short-lived URLs. */
    fun importStalker(
        credentials: StalkerCredentials,
        name: String,
        epgUrl: String? = null,
        playlistIdOverride: String? = null,
    ): StoredPlaylist {
        require(credentials.macAddress.isNotBlank()) { "Stalker MAC address is required" }
        val session = stalkerClient.authenticate(credentials)
        val genreNames = runCatching { stalkerClient.getGenres(session) }
            .getOrDefault(emptyList())
            .associate { it.id to it.title }
        val id = playlistIdOverride ?: "stalker:${session.credentials.portalUrl}:${session.credentials.macAddress}"
            .lowercase().hashCode().toUInt().toString(16)
        val playlist = TvPlaylist(
            name = name.ifBlank { "Stalker / Ministra" },
            channels = emptyList(),
        )
        val writer = store.beginXtreamCatalog(
            id = id,
            playlist = playlist,
            sourceUrl = session.credentials.portalUrl,
            epgUrl = epgUrl,
        )
        try {
            (stalkerClient.getLiveChannels(session) + stalkerClient.getRadioChannels(session)).forEach { channel ->
                writer.addChannel(
                    TvChannel(
                        id = "stalker:${channel.id}",
                        name = channel.name,
                        // This sentinel is never sent to Media3; it makes a
                        // persisted row distinguishable from a static M3U URL.
                        url = "stalker://$id/${channel.id}",
                        group = channel.genreId?.let { genreNames[it] ?: it },
                        providerCategoryId = channel.genreId,
                        logoUrl = channel.logoUrl,
                        tvgId = channel.tvgId,
                        providerCommand = channel.command,
                        useHttpTmpLink = channel.useHttpTmpLink,
                        useLoadBalancing = channel.useLoadBalancing,
                        radio = channel.radio,
                    ),
                )
            }
            stalkerClient.forEachCatalogItem(session, "vod") { item ->
                if (item.isSeries) {
                    writer.addSeries(
                        TvSeriesItem(
                            id = item.id,
                            name = item.name,
                            categoryId = item.categoryId,
                            coverUrl = item.coverUrl,
                            plot = item.plot,
                            rating = item.rating,
                            providerType = "stalker-vod-series",
                            providerCommand = item.command,
                            useHttpTmpLink = item.useHttpTmpLink,
                            useLoadBalancing = item.useLoadBalancing,
                            addedAtMs = item.addedAtMs,
                        ),
                    )
                } else {
                    writer.addVod(
                        TvVodItem(
                            id = item.id,
                            name = item.name,
                            url = "stalker://$id/vod/${item.id}",
                            categoryId = item.categoryId,
                            coverUrl = item.coverUrl,
                            extension = "",
                            rating = item.rating,
                            providerCommand = item.command,
                            providerType = "vod",
                            useHttpTmpLink = item.useHttpTmpLink,
                            useLoadBalancing = item.useLoadBalancing,
                            addedAtMs = item.addedAtMs,
                        ),
                    )
                }
            }
            // Many Ministra portals also return series through the legacy VOD
            // endpoint. INSERT OR REPLACE lets the dedicated series response
            // take precedence without retaining all legacy IDs in memory.
            stalkerClient.forEachCatalogItem(session, "series") { item ->
                writer.addSeries(
                    TvSeriesItem(
                        id = item.id,
                        name = item.name,
                        categoryId = item.categoryId,
                        coverUrl = item.coverUrl,
                        plot = item.plot,
                        rating = item.rating,
                        providerType = "stalker",
                        providerCommand = item.command,
                        useHttpTmpLink = item.useHttpTmpLink,
                        useLoadBalancing = item.useLoadBalancing,
                        addedAtMs = item.addedAtMs,
                    ),
                )
            }
            writer.finish()
        } catch (failure: Throwable) {
            writer.close()
            throw failure
        }
        xtreamCredentials.remove(id)
        xtreamAccounts.remove(id)
        stalkerCredentials[id] = session.credentials
        credentialVault?.saveStalker(id, session.credentials)
        return store.getPlaylists(catalogLimit = 500).first { it.id == id }
    }

    fun resolveStalkerChannel(playlistId: String, channel: TvChannel): TvPlaybackRequest {
        val credentials = stalkerCredentials[playlistId] ?: credentialVault?.loadStalker(playlistId)?.also {
            stalkerCredentials[playlistId] = it
        } ?: error("Stalker credentials are not available for this session")
        val session = stalkerClient.authenticate(credentials)
        val command = channel.providerCommand ?: error("Stalker channel command is missing")
        val link = StalkerRequestBuilder.resolveStaticPlaybackUrl(
            channel.useHttpTmpLink,
            channel.useLoadBalancing,
            command,
        ) ?: if (channel.radio && StalkerRequestBuilder.isDirectHttpStream(command)) {
            command.trim()
        } else {
            stalkerClient.createLink(session, command, if (channel.radio) "radio" else "itv")
        }
        return TvPlaybackRequest(
            uri = link,
            title = channel.name,
            userAgent = com.iptvnator.googletv.stalker.StalkerRequestBuilder.MagUserAgent,
            headers = com.iptvnator.googletv.stalker.StalkerRequestBuilder.playbackHeaders(session.credentials, session.token, link),
            isLive = true,
            isAudio = channel.radio,
        )
    }

    fun resolveStalkerVod(playlistId: String, item: TvVodItem): TvPlaybackRequest {
        val credentials = stalkerCredentials[playlistId] ?: credentialVault?.loadStalker(playlistId)?.also {
            stalkerCredentials[playlistId] = it
        } ?: error("Stalker credentials are not available for this session")
        val session = stalkerClient.authenticate(credentials)
        val command = item.providerCommand ?: error("Stalker VOD command is missing")
        val link = StalkerRequestBuilder.resolveStaticPlaybackUrl(
            item.useHttpTmpLink,
            item.useLoadBalancing,
            command,
        ) ?: stalkerClient.createLink(session, command, item.providerType ?: "vod")
        return TvPlaybackRequest(
            uri = link,
            title = item.name,
            userAgent = com.iptvnator.googletv.stalker.StalkerRequestBuilder.MagUserAgent,
            headers = com.iptvnator.googletv.stalker.StalkerRequestBuilder.playbackHeaders(session.credentials, session.token, link),
            isLive = false,
        )
    }

    fun seriesEpisodeUrl(playlistId: String, episode: XtreamSeriesEpisode): String {
        if (episode.providerType == "stalker" || episode.providerType == "stalker-vod-series") {
            val credentials = stalkerCredentials[playlistId] ?: credentialVault?.loadStalker(playlistId)?.also {
                stalkerCredentials[playlistId] = it
            } ?: error("Stalker credentials are not available for this session")
            val session = stalkerClient.authenticate(credentials)
            val link = stalkerClient.createSeriesEpisodeLink(
                session,
                episode.providerCommand ?: error("Stalker episode command is missing"),
                episode.providerEpisode ?: episode.episode,
                contentType = if (episode.providerType == "stalker-vod-series") "vod" else "series",
            )
            return link
        }
        val credentials = xtreamCredentials[playlistId] ?: credentialVault?.load(playlistId)?.also {
            xtreamCredentials[playlistId] = it
        }
            ?: error("Xtream credentials are not available for this session")
        return xtreamClient.seriesEpisodeUrl(credentials, episode.id, episode.extension)
    }

    /** Builds the provider-aware playback request for a series episode. */
    fun resolveSeriesEpisodePlayback(
        playlistId: String,
        episode: XtreamSeriesEpisode,
    ): TvPlaybackRequest {
        if (episode.providerType == "stalker" || episode.providerType == "stalker-vod-series") {
            val credentials = stalkerCredentials[playlistId] ?: credentialVault?.loadStalker(playlistId)?.also {
                stalkerCredentials[playlistId] = it
            } ?: error("Stalker credentials are not available for this session")
            val session = stalkerClient.authenticate(credentials)
            val link = stalkerClient.createSeriesEpisodeLink(
                session,
                episode.providerCommand ?: error("Stalker episode command is missing"),
                episode.providerEpisode ?: episode.episode,
                contentType = if (episode.providerType == "stalker-vod-series") "vod" else "series",
            )
            return TvPlaybackRequest(
                uri = link,
                title = episode.title,
                userAgent = com.iptvnator.googletv.stalker.StalkerRequestBuilder.MagUserAgent,
                headers = com.iptvnator.googletv.stalker.StalkerRequestBuilder.playbackHeaders(session.credentials, session.token, link),
                isLive = false,
            )
        }
        val credentials = xtreamCredentials[playlistId] ?: credentialVault?.load(playlistId)?.also {
            xtreamCredentials[playlistId] = it
        } ?: error("Xtream credentials are not available for this session")
        return TvPlaybackRequest(
            uri = xtreamClient.seriesEpisodeUrl(credentials, episode.id, episode.extension),
            title = episode.title,
            userAgent = XtreamApiClient.ClientUserAgent,
            isLive = false,
        )
    }

    fun resolveCatchup(
        playlistId: String,
        channel: TvChannel,
        program: TvEpgEntry,
        nowMs: Long = System.currentTimeMillis(),
    ): String? {
        resolveM3uCatchupUrl(channel, program, nowMs)?.let { return it }
        val availableUntilMs = minOf(program.endMs, nowMs)
        if (!channel.tvArchive || availableUntilMs <= program.startMs) return null
        val streamId = channel.id.substringAfter("xtream:", "").toIntOrNull() ?: return null
        val credentials = xtreamCredentials[playlistId]
            ?: credentialVault?.load(playlistId)?.also { xtreamCredentials[playlistId] = it }
            ?: return null
        val account = xtreamAccounts[playlistId] ?: synchronized(xtreamAccounts) {
            xtreamAccounts[playlistId] ?: runCatching { xtreamClient.getAccountInfo(credentials) }
                .getOrNull()
                ?.also { xtreamAccounts[playlistId] = it }
        }
        return xtreamClient.resolveCatchupStreamUrl(
            credentials,
            streamId,
            program.startMs,
            availableUntilMs,
            account?.serverTimezone,
            account?.allowedOutputFormats.orEmpty(),
        )
    }
}
