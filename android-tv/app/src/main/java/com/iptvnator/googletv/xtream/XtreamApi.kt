package com.iptvnator.googletv.xtream

import org.json.JSONArray
import org.json.JSONObject
import android.util.Base64
import android.util.JsonReader
import android.util.JsonToken
import android.util.Log
import com.iptvnator.googletv.epg.TvEpgEntry
import com.iptvnator.googletv.net.decodeHttpResponseBody
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URI
import java.net.Proxy
import java.io.IOException
import java.io.InputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.HostnameVerifier
import kotlin.math.roundToLong

data class XtreamCredentials(
    val serverUrl: String,
    val username: String,
    val password: String,
)

data class XtreamCategory(
    val id: String,
    val name: String,
    val parentId: String? = null,
)

data class XtreamLiveStream(
    val id: Int,
    val name: String,
    val categoryId: String?,
    val categoryName: String? = null,
    val iconUrl: String?,
    val epgChannelId: String?,
    val tvArchive: Boolean,
    val tvArchiveDuration: Int,
)

/** Xtream's `tv_archive_duration` is in days; the playlist model stores minutes. */
internal fun xtreamArchiveDurationMinutes(days: Int): Int =
    (days.toLong().coerceAtLeast(0L) * 24L * 60L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()

data class XtreamVodStream(
    val id: Int,
    val name: String,
    val categoryId: String?,
    val categoryName: String? = null,
    val iconUrl: String?,
    val containerExtension: String,
    val rating: Double?,
    val addedAtMs: Long? = null,
)

data class XtreamVodDetails(
    val plot: String? = null,
    val description: String? = null,
    val director: String? = null,
    val actors: String? = null,
    val genre: String? = null,
    val releaseDate: String? = null,
    val duration: String? = null,
    val backdropUrl: String? = null,
    val rating: Double? = null,
)

data class XtreamSeriesItem(
    val id: Int,
    val name: String,
    val categoryId: String?,
    val categoryName: String? = null,
    val coverUrl: String?,
    val plot: String?,
    val rating: Double?,
    val addedAtMs: Long? = null,
)

data class XtreamSeriesEpisode(
    val id: Int,
    val title: String,
    val season: Int,
    val episode: Int,
    val extension: String,
    val providerCommand: String? = null,
    val providerType: String? = null,
    val providerEpisode: Int? = null,
    val plot: String? = null,
    val coverUrl: String? = null,
    val rating: Double? = null,
    val duration: String? = null,
)

data class XtreamSeriesDetails(
    val id: Int,
    val name: String,
    val plot: String?,
    val coverUrl: String?,
    val episodes: List<XtreamSeriesEpisode>,
)

data class XtreamAccountInfo(
    val authenticated: Boolean,
    val status: String?,
    val expirationEpochSeconds: Long?,
    val serverTimezone: String?,
    val allowedOutputFormats: List<String>,
    val username: String? = null,
    val serverUrl: String? = null,
    val activeConnections: Int? = null,
    val maxConnections: Int? = null,
)

/** Xtream Codes API client. The response model intentionally tolerates panel variants. */
class XtreamApiClient {
    companion object {
        const val ClientUserAgent = "VLC/3.0.18 LibVLC/3.0.18"
    }
    private val catchupVariantCache = ConcurrentHashMap<String, String>()

    /**
     * Resolves the scheme that actually served the account handshake. This is
     * used by imports so generated live/VOD/series URLs and saved credentials
     * point at the working listener instead of merely succeeding through an
     * internal transport fallback.
     */
    fun resolveWorkingCredentials(credentials: XtreamCredentials): Pair<XtreamCredentials, XtreamAccountInfo> {
        var lastFailure: Exception? = null
        var inactiveAccount: Pair<XtreamCredentials, XtreamAccountInfo>? = null
        xtreamServerCandidates(credentials).forEach { candidate ->
            for (params in listOf(
                mapOf("action" to "get_account_info"),
                emptyMap(),
                mapOf("action" to "get_profile"),
            )) {
                try {
                    val root = JSONObject(readBody(openSingle(candidate, params)))
                    // A few panels answer unsupported actions with a valid
                    // JSON object or an empty array. That is not an account
                    // response; keep trying the compatible action variants.
                    if (!root.has("user_info")) continue
                    val account = root.let(::parseAccountInfo)
                    if (account.authenticated) return candidate to account
                    inactiveAccount = candidate to account
                    break
                } catch (failure: Exception) {
                    lastFailure = failure
                }
            }
        }
        return inactiveAccount
            ?: throw (lastFailure ?: IOException("Xtream account request returned no response"))
    }

    fun getAccountInfo(credentials: XtreamCredentials): XtreamAccountInfo {
        var fallback: JSONObject? = null
        var lastFailure: Exception? = null
        for (params in listOf(
            mapOf("action" to "get_account_info"),
            emptyMap(),
            mapOf("action" to "get_profile"),
        )) {
            val root = try {
                request(credentials, params)
            } catch (failure: IOException) {
                // A transport failure cannot be fixed by changing the API action.
                throw failure
            } catch (failure: Exception) {
                lastFailure = failure
                continue
            }
            if (root.has("user_info")) return parseAccountInfo(root)
            if (fallback == null) fallback = root
        }
        return fallback?.let(::parseAccountInfo)
            ?: throw (lastFailure ?: IllegalStateException("Xtream account request returned no response"))
    }

    private fun parseAccountInfo(root: JSONObject): XtreamAccountInfo {
        val user = root.optJSONObject("user_info") ?: JSONObject()
        val server = root.optJSONObject("server_info") ?: JSONObject()
        val auth = user.optBooleanish("auth")
        val status = user.optStringOrNull("status")
        // Xtream panels conventionally use exp_date=0 for an account with no
        // fixed expiry. Keep that distinct from a genuinely expired Unix
        // timestamp so active unlimited accounts remain importable.
        val expirationEpochSeconds = user.optLongOrNull("exp_date")
            ?.takeIf { it > 0L }
        return XtreamAccountInfo(
            // Several panels keep `auth: 1` after a trial expires and return
            // the same account object for every catalogue action. Treat the
            // explicit status/expiry as authoritative or the streaming parser
            // will receive an object where it expects a catalogue array.
            authenticated = isXtreamAccountAuthenticated(auth, status, expirationEpochSeconds),
            status = status,
            expirationEpochSeconds = expirationEpochSeconds,
            serverTimezone = server.optStringOrNull("timezone"),
            allowedOutputFormats = user.optStringList("allowed_output_formats"),
            username = user.optStringOrNull("username"),
            serverUrl = server.optStringOrNull("url"),
            activeConnections = user.optIntOrNull("active_cons"),
            maxConnections = user.optIntOrNull("max_connections"),
        )
    }

    fun getCategories(
        credentials: XtreamCredentials,
        type: XtreamCatalogType,
        isCancelled: (() -> Boolean)? = null,
    ): List<XtreamCategory> =
        requestArray(credentials, mapOf("action" to type.categoriesAction), isCancelled).mapObjects { item ->
            XtreamCategory(
                id = item.optString("category_id"),
                name = item.optString("category_name", "Unnamed"),
                parentId = item.optStringOrNull("parent_id"),
            )
        }

    fun getLiveStreams(credentials: XtreamCredentials, categoryId: String? = null): List<XtreamLiveStream> =
        requestArray(credentials, buildMap {
            put("action", "get_live_streams")
            categoryId?.let { put("category_id", it) }
        }).mapObjects { item ->
            XtreamLiveStream(
                id = item.optInt("stream_id"),
                name = item.optString("name", "Unnamed"),
                categoryId = item.optStringOrNull("category_id"),
                categoryName = item.optStringOrNull("category_name"),
                iconUrl = item.optStringOrNull("stream_icon"),
                epgChannelId = item.optStringOrNull("epg_channel_id"),
                tvArchive = item.optInt("tv_archive", 0) == 1,
                tvArchiveDuration = item.optInt("tv_archive_duration", 0),
            )
        }

    /**
     * Streams live rows without materialising the complete JSON response.
     * Large panels commonly expose tens of thousands of channels; importing
     * them through JSONArray briefly keeps the raw body, every JSONObject and
     * every mapped row alive at the same time.
     */
    fun forEachLiveStream(
        credentials: XtreamCredentials,
        categoryId: String? = null,
        isCancelled: (() -> Boolean)? = null,
        consumer: (XtreamLiveStream) -> Unit,
    ) = streamArray(credentials, buildMap {
        put("action", "get_live_streams")
        categoryId?.let { put("category_id", it) }
    }, isCancelled) { reader ->
        var id = 0
        var name = "Unnamed"
        var categoryIdValue: String? = null
        var categoryName: String? = null
        var icon: String? = null
        var epgChannelId: String? = null
        var tvArchive = false
        var tvArchiveDuration = 0
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "stream_id" -> id = reader.nextIntOrZero()
                "name" -> name = reader.nextStringOrDefault("Unnamed")
                "category_id" -> categoryIdValue = reader.nextNullableString()
                "category_name" -> categoryName = reader.nextNullableString()
                "stream_icon" -> icon = reader.nextNullableString()
                "epg_channel_id" -> epgChannelId = reader.nextNullableString()
                "tv_archive" -> tvArchive = reader.nextIntOrZero() == 1
                "tv_archive_duration" -> tvArchiveDuration = reader.nextIntOrZero()
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        consumer(XtreamLiveStream(id, name, categoryIdValue, categoryName, icon, epgChannelId, tvArchive, tvArchiveDuration))
    }

    fun getVodStreams(credentials: XtreamCredentials, categoryId: String? = null): List<XtreamVodStream> =
        requestArray(credentials, buildMap {
            put("action", "get_vod_streams")
            categoryId?.let { put("category_id", it) }
        }).mapObjects { item ->
            XtreamVodStream(
                id = item.optInt("stream_id"),
                name = item.optString("name", "Unnamed"),
                categoryId = item.optStringOrNull("category_id"),
                categoryName = item.optStringOrNull("category_name"),
                iconUrl = item.optStringOrNull("stream_icon"),
                containerExtension = item.optString("container_extension", "ts"),
                rating = item.optDoubleOrNull("rating"),
                addedAtMs = item.optEpochMsOrNull("added"),
            )
        }

    fun forEachVodStream(
        credentials: XtreamCredentials,
        categoryId: String? = null,
        consumer: (XtreamVodStream) -> Unit,
    ) = streamArray(credentials, buildMap {
        put("action", "get_vod_streams")
        categoryId?.let { put("category_id", it) }
    }) { reader ->
        var id = 0
        var name = "Unnamed"
        var category: String? = null
        var categoryName: String? = null
        var icon: String? = null
        var extension = "ts"
        var rating: Double? = null
        var addedAtMs: Long? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "stream_id" -> id = reader.nextIntOrZero()
                "name" -> name = reader.nextStringOrDefault("Unnamed")
                "category_id" -> category = reader.nextNullableString()
                "category_name" -> categoryName = reader.nextNullableString()
                "stream_icon" -> icon = reader.nextNullableString()
                "container_extension" -> extension = reader.nextStringOrDefault("ts")
                "rating" -> rating = reader.nextNullableDouble()
                "added" -> addedAtMs = reader.nextNullableLong()?.let(::epochMs)
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        consumer(XtreamVodStream(id, name, category, categoryName, icon, extension, rating, addedAtMs))
    }

    fun getVodInfo(credentials: XtreamCredentials, vodId: Int): XtreamVodDetails {
        val root = request(credentials, mapOf("action" to "get_vod_info", "vod_id" to vodId.toString()))
        val info = root.optJSONObject("info") ?: return XtreamVodDetails()
        val backdrop = info.optJSONArray("backdrop_path")?.optString(0)?.takeIf { it.isNotBlank() }
        return XtreamVodDetails(
            plot = info.optStringOrNull("plot"),
            description = info.optStringOrNull("description"),
            director = info.optStringOrNull("director"),
            actors = info.optStringOrNull("actors") ?: info.optStringOrNull("cast"),
            genre = info.optStringOrNull("genre"),
            releaseDate = info.optStringOrNull("releasedate"),
            duration = info.optStringOrNull("duration") ?: info.optStringOrNull("runtime"),
            backdropUrl = backdrop,
            rating = info.optDoubleOrNull("rating"),
        )
    }

    fun getSeries(credentials: XtreamCredentials, categoryId: String? = null): List<XtreamSeriesItem> =
        requestArray(credentials, buildMap {
            put("action", "get_series")
            categoryId?.let { put("category_id", it) }
        }).mapObjects { item ->
            XtreamSeriesItem(
                id = item.optInt("series_id"),
                name = item.optString("name", "Unnamed"),
                categoryId = item.optStringOrNull("category_id"),
                categoryName = item.optStringOrNull("category_name"),
                coverUrl = item.optStringOrNull("cover"),
                plot = item.optStringOrNull("plot"),
                rating = item.optDoubleOrNull("rating"),
                addedAtMs = item.optEpochMsOrNull("added"),
            )
        }

    fun forEachSeriesItem(
        credentials: XtreamCredentials,
        categoryId: String? = null,
        consumer: (XtreamSeriesItem) -> Unit,
    ) = streamArray(credentials, buildMap {
        put("action", "get_series")
        categoryId?.let { put("category_id", it) }
    }) { reader ->
        var id = 0
        var name = "Unnamed"
        var category: String? = null
        var categoryName: String? = null
        var cover: String? = null
        var plot: String? = null
        var rating: Double? = null
        var addedAtMs: Long? = null
        reader.beginObject()
        while (reader.hasNext()) {
            when (reader.nextName()) {
                "series_id" -> id = reader.nextIntOrZero()
                "name" -> name = reader.nextStringOrDefault("Unnamed")
                "category_id" -> category = reader.nextNullableString()
                "category_name" -> categoryName = reader.nextNullableString()
                "cover" -> cover = reader.nextNullableString()
                "plot" -> plot = reader.nextNullableString()
                "rating" -> rating = reader.nextNullableDouble()
                "added" -> addedAtMs = reader.nextNullableLong()?.let(::epochMs)
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        consumer(XtreamSeriesItem(id, name, category, categoryName, cover, plot, rating, addedAtMs))
    }

    fun getSeriesInfo(credentials: XtreamCredentials, seriesId: Int): XtreamSeriesDetails {
        val root = request(credentials, mapOf("action" to "get_series_info", "series_id" to seriesId.toString()))
        val info = root.optJSONObject("info") ?: JSONObject()
        val episodes = mutableListOf<XtreamSeriesEpisode>()
        val episodeGroups = root.optJSONObject("episodes") ?: JSONObject()
        episodeGroups.keys().forEach { seasonKey ->
            val seasonNumber = seasonKey.toIntOrNull() ?: return@forEach
            val rows = episodeGroups.optJSONArray(seasonKey) ?: return@forEach
            for (index in 0 until rows.length()) {
                val item = rows.optJSONObject(index) ?: continue
                episodes += XtreamSeriesEpisode(
                    id = item.optInt("id"),
                    title = item.optString("title", "Episode ${item.optInt("episode_num", index + 1)}"),
                    season = item.optInt("season", seasonNumber),
                    episode = item.optInt("episode_num", index + 1),
                    extension = item.optString("container_extension", "mp4"),
                    plot = item.optStringOrNull("plot") ?: safeEpisodeInfoText(item.optStringOrNull("info")),
                    coverUrl = item.optStringOrNull("movie_image") ?: item.optStringOrNull("cover_big"),
                    rating = item.optDoubleOrNull("rating"),
                    duration = item.optStringOrNull("duration"),
                )
            }
        }
        return XtreamSeriesDetails(
            id = seriesId,
            name = info.optString("name", "Series"),
            plot = info.optStringOrNull("plot"),
            coverUrl = info.optStringOrNull("cover"),
            episodes = episodes.sortedWith(compareBy({ it.season }, { it.episode })),
        )
}

/**
 * Some Xtream panels put ffprobe/media metadata in the episode `info` field.
 * It is not a synopsis and can be several megabytes of JSON, so never expose
 * that payload directly in the TV detail screen. Plain provider descriptions
 * remain supported, and a JSON object is accepted only when it contains a
 * useful textual `plot` field.
 */
internal fun safeEpisodeInfoText(value: String?): String? {
    val text = value?.trim()?.takeIf { it.isNotBlank() } ?: return null
    if (!text.startsWith("{") && !text.startsWith("[")) return text
    return runCatching {
        JSONObject(text).optStringOrNull("plot")
    }.getOrNull()?.trim()?.takeIf { it.isNotBlank() && !it.startsWith("{") && !it.startsWith("[") }
}

/** Reads the provider's short guide for one live stream. */
    fun getShortEpg(
        credentials: XtreamCredentials,
        streamId: Int,
        channelId: String,
        limit: Int = 10,
    ): List<TvEpgEntry> {
        val root = request(credentials, mapOf(
            "action" to "get_short_epg",
            "stream_id" to streamId.toString(),
            "limit" to limit.coerceIn(1, 100).toString(),
        ))
        val listings = root.optJSONArray("epg_listings") ?: return emptyList()
        return (0 until listings.length()).mapNotNull { index ->
            val item = listings.optJSONObject(index) ?: return@mapNotNull null
            val start = epochMs(item.optStringOrNull("start_timestamp"))
                ?: parseDateEpochMs(item.optStringOrNull("start"))
                ?: return@mapNotNull null
            val end = epochMs(item.optStringOrNull("stop_timestamp"))
                ?: parseDateEpochMs(item.optStringOrNull("end"))
                ?: return@mapNotNull null
            if (end <= start) return@mapNotNull null
            TvEpgEntry(
                channelId = channelId,
                startMs = start,
                endMs = end,
                title = decodeEpgText(item.optStringOrNull("title") ?: "Untitled"),
                description = item.optStringOrNull("description")?.let(::decodeEpgText),
            )
        }.sortedBy { it.startMs }
    }

    fun liveStreamUrl(credentials: XtreamCredentials, streamId: Int, extension: String = "m3u8"): String =
        streamUrl(credentials, "live", streamId, extension)

    /** Matches IPTVnator's automatic live-format negotiation for Xtream panels. */
    fun autoLiveStreamExtension(allowedOutputFormats: List<String>): String {
        val formats = allowedOutputFormats.map(String::lowercase)
        return when {
            "m3u8" in formats -> "m3u8"
            "ts" in formats -> "ts"
            else -> "m3u8"
        }
    }

    fun vodStreamUrl(credentials: XtreamCredentials, streamId: Int, extension: String): String =
        streamUrl(credentials, "movie", streamId, extension)

    fun seriesEpisodeUrl(credentials: XtreamCredentials, episodeId: Int, extension: String): String =
        streamUrl(credentials, "series", episodeId, extension)

    fun catchupStreamUrl(
        credentials: XtreamCredentials,
        streamId: Int,
        startMs: Long,
        endMs: Long,
        serverTimezone: String? = null,
    ): String {
        require(endMs > startMs) { "Catch-up programme must have a positive duration" }
        // Match IPTVnator's Xtream URL builder: round to the nearest minute
        // with a one-minute minimum instead of always rounding upward.
        val durationMinutes = (((endMs - startMs).toDouble() / 60_000.0).roundToLong()).coerceAtLeast(1L)
        val zone = runCatching { ZoneId.of(serverTimezone ?: "UTC") }.getOrDefault(ZoneId.of("UTC"))
        val time = DateTimeFormatter.ofPattern("yyyy-MM-dd:HH-mm")
            .withZone(zone)
            .format(Instant.ofEpochMilli(startMs))
        val base = XtreamRequestBuilder.normalizeServerUrl(credentials.serverUrl)
        return "$base/timeshift/${XtreamRequestBuilder.percentEncode(credentials.username)}/${XtreamRequestBuilder.percentEncode(credentials.password)}/$durationMinutes/$time/$streamId.ts"
    }

    /** Resolves the REST and legacy Xtream catch-up endpoint families. */
    fun resolveCatchupStreamUrl(
        credentials: XtreamCredentials,
        streamId: Int,
        startMs: Long,
        endMs: Long,
        serverTimezone: String? = null,
        allowedOutputFormats: List<String> = emptyList(),
    ): String {
        require(endMs > startMs) { "Catch-up programme must have a positive duration" }
        val key = "${XtreamRequestBuilder.normalizeServerUrl(credentials.serverUrl)}\u0000${credentials.username}\u0000${credentials.password}"
        val formats = allowedOutputFormats.map(String::lowercase)
            .filter { it == "ts" || it == "m3u8" }
            .let { if (it.isEmpty()) listOf("ts", "m3u8") else it.distinct() }
        val candidates = catchupStreamCandidates(credentials, streamId, startMs, endMs, serverTimezone, formats)
        catchupVariantCache[key]?.let { variant ->
            candidates.firstOrNull { it.first == variant }?.let { return it.second }
        }
        candidates.firstOrNull { (_, url) -> probeCatchupUrl(url) }?.let {
            catchupVariantCache[key] = it.first
            return it.second
        }
        val fallback = candidates.firstOrNull { it.first == "rest:ts" }
            ?: ("rest:ts" to catchupStreamUrl(credentials, streamId, startMs, endMs, serverTimezone))
        catchupVariantCache[key] = fallback.first
        return fallback.second
    }

    internal fun catchupStreamCandidates(
        credentials: XtreamCredentials,
        streamId: Int,
        startMs: Long,
        endMs: Long,
        serverTimezone: String? = null,
        preferredFormats: List<String> = listOf("ts", "m3u8"),
    ): List<Pair<String, String>> {
        require(endMs > startMs) { "Catch-up programme must have a positive duration" }
        val durationMinutes = (((endMs - startMs).toDouble() / 60_000.0).roundToLong()).coerceAtLeast(1L)
        val zone = runCatching { ZoneId.of(serverTimezone ?: "UTC") }.getOrDefault(ZoneId.of("UTC"))
        val time = DateTimeFormatter.ofPattern("yyyy-MM-dd:HH-mm")
            .withZone(zone)
            .format(Instant.ofEpochMilli(startMs))
        val base = XtreamRequestBuilder.normalizeServerUrl(credentials.serverUrl)
        val user = XtreamRequestBuilder.percentEncode(credentials.username)
        val password = XtreamRequestBuilder.percentEncode(credentials.password)
        return preferredFormats.flatMap { extension ->
            listOf(
                "rest:$extension" to "$base/timeshift/$user/$password/$durationMinutes/$time/$streamId.$extension",
                "legacy:$extension" to "$base/streaming/timeshift.php?username=$user&password=$password&stream=$streamId&start=${XtreamRequestBuilder.percentEncode(time)}&duration=$durationMinutes&extension=$extension",
            )
        }
    }

    private fun probeCatchupUrl(url: String): Boolean = runCatching {
        // Respect the device's configured proxy for hosted panels; the main
        // API path already bypasses it only for local/site-local endpoints.
        val connection = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 4_000
            connection.readTimeout = 4_000
            connection.instanceFollowRedirects = true
            connection.requestMethod = "GET"
            connection.setRequestProperty("Range", "bytes=0-0")
            connection.setRequestProperty("User-Agent", ClientUserAgent)
            connection.responseCode == 200 || connection.responseCode == 206
        } finally {
            connection.disconnect()
        }
    }.getOrDefault(false)

    private fun streamUrl(credentials: XtreamCredentials, type: String, id: Int, extension: String): String {
        val base = XtreamRequestBuilder.normalizeServerUrl(credentials.serverUrl)
        return "$base/$type/${XtreamRequestBuilder.percentEncode(credentials.username)}/${XtreamRequestBuilder.percentEncode(credentials.password)}/$id.$extension"
    }

    private fun epochMs(value: String?): Long? = value?.toLongOrNull()?.let { seconds ->
        if (seconds > 0) seconds * 1000 else null
    }

    private fun parseDateEpochMs(value: String?): Long? = value?.let {
        runCatching { Instant.parse(it.replace(' ', 'T')).toEpochMilli() }.getOrNull()
    }

    private fun decodeEpgText(value: String): String = runCatching {
        String(Base64.decode(value, Base64.DEFAULT), Charsets.UTF_8).takeIf { it.isNotBlank() } ?: value
    }.getOrDefault(value)

    private fun request(credentials: XtreamCredentials, params: Map<String, String>): JSONObject {
        return JSONObject(readWithRetry(credentials, params))
    }

    private fun requestArray(
        credentials: XtreamCredentials,
        params: Map<String, String>,
        isCancelled: (() -> Boolean)? = null,
    ): JSONArray {
        val body = readWithRetry(credentials, params, isCancelled)
        return if (body.trimStart().startsWith("[")) JSONArray(body) else JSONArray()
    }

    private fun streamArray(
        credentials: XtreamCredentials,
        params: Map<String, String>,
        isCancelled: (() -> Boolean)? = null,
        consumer: (JsonReader) -> Unit,
    ) {
        val cancellation = isCancelled?.let(::XtreamRequestCancellation)
        var lastFailure: IOException? = null
        var deliveredAnyItem = false
        try {
            repeat(3) { attempt ->
                cancellation?.throwIfCancelled()
                try {
                    val connection = open(credentials, params, cancellation?.let { it::track })
                    try {
                        JsonReader(responseInputStream(connection).bufferedReader()).use { reader ->
                            reader.beginArray()
                            while (reader.hasNext()) {
                                cancellation?.throwIfCancelled()
                                // The consumer writes directly into the current
                                // import transaction. Once one item has escaped,
                                // replaying the request after a mid-stream socket
                                // failure would duplicate every item delivered
                                // before the failure. Only retry failures that
                                // happen before the first catalogue object.
                                deliveredAnyItem = true
                                consumer(reader)
                            }
                            reader.endArray()
                        }
                        return
                    } finally {
                        connection.disconnect()
                    }
                } catch (failure: IOException) {
                    cancellation?.throwIfCancelled()
                    lastFailure = failure
                    if (deliveredAnyItem) throw failure
                    if (attempt < 2) Thread.sleep(if (attempt == 0) 1_500 else 4_000)
                }
            }
            throw (lastFailure ?: IOException("Xtream streaming request failed"))
        } finally {
            cancellation?.close()
        }
    }

    private fun JsonReader.nextNullableString(): String? =
        if (peek() == JsonToken.NULL) { nextNull(); null } else nextString()

    private fun JsonReader.nextStringOrDefault(default: String): String =
        nextNullableString() ?: default

    private fun JsonReader.nextIntOrZero(): Int =
        nextNullableString()?.toIntOrNull() ?: 0

    private fun JsonReader.nextNullableDouble(): Double? =
        nextNullableString()?.toDoubleOrNull()

    private fun JsonReader.nextNullableLong(): Long? =
        nextNullableString()?.toLongOrNull()

    private fun readWithRetry(
        credentials: XtreamCredentials,
        params: Map<String, String>,
        isCancelled: (() -> Boolean)? = null,
    ): String {
        val cancellation = isCancelled?.let(::XtreamRequestCancellation)
        var lastFailure: IOException? = null
        try {
            repeat(3) { attempt ->
                cancellation?.throwIfCancelled()
                try {
                    return readBody(open(credentials, params, cancellation?.let { it::track }))
                } catch (failure: IOException) {
                    cancellation?.throwIfCancelled()
                    lastFailure = failure
                    if (attempt < 2) Thread.sleep(if (attempt == 0) 1_500 else 4_000)
                }
            }
            throw (lastFailure ?: IOException("Xtream request failed"))
        } finally {
            cancellation?.close()
        }
    }

    private fun readBody(connection: HttpURLConnection): String = try {
        responseInputStream(connection).bufferedReader().use { it.readText() }
    } finally {
        connection.disconnect()
    }

    /**
     * Large Xtream panels commonly compress their JSON responses. Android's
     * HttpURLConnection does not transparently inflate them, so decode the
     * body at the boundary while keeping JsonReader streaming. This avoids
     * holding the uncompressed 100 MB series response in memory.
     */
    private fun responseInputStream(connection: HttpURLConnection): InputStream {
        return decodeHttpResponseBody(connection.inputStream, connection.contentEncoding)
    }

    /**
     * Some panels advertise an HTTPS URL while only their HTTP listener is
     * reachable (or the TLS endpoint has an expired/mismatched certificate).
     * IPTVnator tests both schemes before importing a catalogue. Keep that
     * compatibility at the transport boundary so account, streaming,
     * catalogue and EPG requests all use the same recovery behaviour.
     */
    private fun open(
        credentials: XtreamCredentials,
        params: Map<String, String>,
        onConnectionOpened: ((HttpURLConnection) -> Unit)? = null,
    ): HttpURLConnection {
        var lastFailure: Exception? = null
        xtreamServerCandidates(credentials).forEach { candidate ->
            try {
                return openSingle(candidate, params, onConnectionOpened)
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                lastFailure = failure
            }
        }
        throw (lastFailure ?: IOException("Xtream request failed"))
    }

    private fun xtreamServerCandidates(credentials: XtreamCredentials): List<XtreamCredentials> {
        val normalized = XtreamRequestBuilder.normalizeServerUrl(credentials.serverUrl)
        val uri = URI(normalized)
        val alternateScheme = when (uri.scheme.lowercase()) {
            "https" -> "http"
            "http" -> "https"
            else -> null
        }
        val alternate = alternateScheme?.let { scheme ->
            XtreamCredentials(
                serverUrl = URI(scheme, null, uri.host, uri.port, uri.path.ifBlank { null }, null, null).toString(),
                username = credentials.username,
                password = credentials.password,
            )
        }
        return listOfNotNull(credentials, alternate).distinctBy {
            XtreamRequestBuilder.normalizeServerUrl(it.serverUrl).lowercase()
        }
    }

    private fun openSingle(
        credentials: XtreamCredentials,
        params: Map<String, String>,
        onConnectionOpened: ((HttpURLConnection) -> Unit)? = null,
    ): HttpURLConnection {
        val url = URI(XtreamRequestBuilder.apiUrl(credentials, params)).toURL()
        val resolved = runCatching { InetAddress.getAllByName(url.host).joinToString { it.hostAddress ?: "unknown" } }
            .getOrDefault("unresolved")
        Log.i("XtreamApi", "GET ${url.protocol}://${url.host ?: ""}${url.path} resolved=$resolved action=${params["action"] ?: "account"}")
        val directLocalConnection = runCatching {
            InetAddress.getAllByName(url.host).any { address ->
                address.isLoopbackAddress || address.isSiteLocalAddress || address.isLinkLocalAddress
            }
        }.getOrDefault(false)
        val rawConnection = if (directLocalConnection) {
            url.openConnection(Proxy.NO_PROXY)
        } else {
            url.openConnection()
        }
        return (rawConnection as HttpURLConnection).apply {
            onConnectionOpened?.invoke(this)
            connectTimeout = 20_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
            // Some IPTV panels close Android's pooled HTTP socket before
            // sending the first response. A short-lived request is more
            // reliable for the account/catalogue handshake than keep-alive.
            setRequestProperty("Connection", "close")
            // Match the original client's compressed catalogue requests. The
            // responseInputStream boundary inflates gzip/deflate while
            // JsonReader still consumes VOD/series incrementally.
            setRequestProperty("Accept-Encoding", "gzip, deflate")
            setRequestProperty("User-Agent", ClientUserAgent)
            if (this is HttpsURLConnection) {
                hostnameVerifier = TvXtreamHostnameVerifier
            }
            connect()
            val code = responseCode
            Log.i("XtreamApi", "response=$code contentType=${contentType ?: "unknown"}")
            if (code !in 200..299) {
                val detail = errorStream?.bufferedReader()?.use { it.readText() }
                    ?.replace(Regex("\\s+"), " ")
                    ?.take(240)
                    .orEmpty()
                disconnect()
                error("Xtream request failed with HTTP $code${detail.takeIf { it.isNotBlank() }?.let { ": $it" }.orEmpty()}")
            }
        }
    }
}

/** Closes a single in-flight Xtream connection when its owning import is cancelled. */
private class XtreamRequestCancellation(private val isCancelled: () -> Boolean) : AutoCloseable {
    private val finished = AtomicBoolean(false)
    private val activeConnection = AtomicReference<HttpURLConnection?>(null)
    private val watcher = Thread({
        while (!finished.get()) {
            if (runCatching(isCancelled).getOrDefault(false)) {
                activeConnection.get()?.disconnect()
                return@Thread
            }
            try {
                Thread.sleep(50)
            } catch (_: InterruptedException) {
                return@Thread
            }
        }
    }, "xtream-cancel-watch").apply {
        isDaemon = true
        start()
    }

    fun track(connection: HttpURLConnection) {
        activeConnection.set(connection)
        throwIfCancelled()
    }

    fun throwIfCancelled() {
        if (isCancelled()) {
            activeConnection.get()?.disconnect()
            throw CancellationException("Xtream import cancelled")
        }
    }

    override fun close() {
        finished.set(true)
        watcher.interrupt()
        activeConnection.getAndSet(null)?.disconnect()
    }
}

internal fun isXtreamAccountAuthenticated(
    auth: Boolean?,
    status: String?,
    expirationEpochSeconds: Long?,
    nowEpochSeconds: Long = Instant.now().epochSecond,
): Boolean {
    val inactiveStatus = status?.trim()?.lowercase() in
        setOf("expired", "inactive", "disabled", "banned", "blocked")
    return auth == true && !inactiveStatus &&
        (expirationEpochSeconds == null || expirationEpochSeconds > nowEpochSeconds)
}

/**
 * Some IPTV panels publish the API on one spelling and the certificate on the
 * other. Keep the normal certificate-chain checks and allow only that exact
 * www/non-www alias; arbitrary certificate bypasses are intentionally avoided.
 */
private object TvXtreamHostnameVerifier : HostnameVerifier {
    private val defaultVerifier = HttpsURLConnection.getDefaultHostnameVerifier()

    override fun verify(hostname: String, session: javax.net.ssl.SSLSession): Boolean {
        if (defaultVerifier.verify(hostname, session)) return true
        val alias = if (hostname.startsWith("www.", ignoreCase = true)) {
            hostname.removePrefix("www.")
        } else {
            "www.$hostname"
        }
        return defaultVerifier.verify(alias, session)
    }
}

enum class XtreamCatalogType(val categoriesAction: String) {
    LIVE("get_live_categories"),
    VOD("get_vod_categories"),
    SERIES("get_series_categories"),
}

object XtreamRequestBuilder {
    fun normalizeServerUrl(value: String): String {
        val uri = URI(value.trim())
        require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) {
            "Xtream server must use HTTP or HTTPS"
        }
        require(uri.userInfo == null) { "Xtream URL credentials are not supported" }
        val path = uri.path.orEmpty().trimEnd('/')
        val trimmed = URI(uri.scheme, null, uri.host, uri.port, path.ifBlank { null }, null, null)
            .toString()
        return when {
            trimmed.endsWith("/player_api.php", ignoreCase = true) -> trimmed.dropLast("/player_api.php".length)
            trimmed.endsWith("/panel_api.php", ignoreCase = true) -> trimmed.dropLast("/panel_api.php".length)
            trimmed.endsWith("/get.php", ignoreCase = true) -> trimmed.dropLast("/get.php".length)
            else -> trimmed
        }
    }

    fun apiUrl(credentials: XtreamCredentials, params: Map<String, String>): String {
        val query = buildMap {
            put("username", credentials.username)
            put("password", credentials.password)
            putAll(params)
        }.entries.joinToString("&") { (key, value) ->
            "${percentEncode(key)}=${percentEncode(value)}"
        }
        return "${normalizeServerUrl(credentials.serverUrl)}/player_api.php?$query"
    }

    internal fun percentEncode(value: String): String = buildString {
        val hex = "0123456789ABCDEF"
        value.toByteArray(Charsets.UTF_8).forEach { byte ->
            val unsigned = byte.toInt() and 0xFF
            val character = unsigned.toChar()
            if (character.isLetterOrDigit() || character in "-._~") {
                append(character)
            } else {
                append('%')
                append(hex[unsigned ushr 4])
                append(hex[unsigned and 0x0F])
            }
        }
    }
}

private inline fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> = buildList {
    for (index in 0 until length()) {
        optJSONObject(index)?.let { add(transform(it)) }
    }
}

private fun JSONObject.optStringOrNull(key: String): String? =
    optString(key, "").orEmpty().takeIf { it.isNotBlank() && it != "null" }

private fun JSONObject.optBooleanish(key: String): Boolean? = when (val value = opt(key)) {
    is Boolean -> value
    is Number -> value.toInt() == 1
    is String -> when (value.trim().lowercase()) {
        "1", "true", "active" -> true
        "0", "false", "inactive" -> false
        else -> null
    }
    else -> null
}

private fun JSONObject.optLongOrNull(key: String): Long? =
    optStringOrNull(key)?.toLongOrNull()

private fun JSONObject.optEpochMsOrNull(key: String): Long? = optLongOrNull(key)?.let(::epochMs)

private fun epochMs(value: Long): Long = if (value in 1L..9_999_999_999L) value * 1_000L else value

private fun JSONObject.optIntOrNull(key: String): Int? =
    optStringOrNull(key)?.toIntOrNull()

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    optStringOrNull(key)?.toDoubleOrNull()

private fun JSONObject.optStringList(key: String): List<String> {
    val values = optJSONArray(key) ?: return emptyList()
    return buildList {
        for (index in 0 until values.length()) add(values.optString(index))
    }
}
