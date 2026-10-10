package com.iptvnator.googletv.stalker

import org.json.JSONArray
import org.json.JSONObject
import com.iptvnator.googletv.epg.TvEpgEntry
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import com.iptvnator.googletv.net.decodeHttpResponseBody
import java.util.concurrent.Callable
import java.util.concurrent.Executors

private const val FALLBACK_CONCURRENCY = 4
private const val MAX_CHANNELS = 30_000
private const val MAX_SHORT_EPG_WINDOW = 50

/** Match IPTVnator's 15-minute provider-clock compensation for short EPG. */
internal fun stalkerShortEpgWindowSize(offsetMinutes: Int, baseSize: Int = 3): Int =
    if (offsetMinutes >= 0) baseSize.coerceIn(1, MAX_SHORT_EPG_WINDOW)
    else (baseSize + kotlin.math.ceil(-offsetMinutes / 15.0).toInt()).coerceAtMost(MAX_SHORT_EPG_WINDOW)

data class StalkerCredentials(
    val portalUrl: String,
    val macAddress: String,
    val serialNumber: String? = null,
    val username: String? = null,
    val password: String? = null,
    val deviceId1: String? = null,
    val deviceId2: String? = null,
    val signature1: String? = null,
    val signature2: String? = null,
)

data class StalkerSession(
    val credentials: StalkerCredentials,
    val token: String,
    val random: String,
    val profileStatus: String? = null,
    val profileMessage: String? = null,
    val accountLogin: String? = null,
    val tariffPlanName: String? = null,
    /** Unix timestamp in seconds, matching the Xtream account model. */
    val expirationEpochSeconds: Long? = null,
)

data class StalkerGenre(val id: String, val title: String)

data class StalkerChannel(
    val id: String,
    val name: String,
    val command: String,
    val genreId: String?,
    val logoUrl: String?,
    val tvgId: String?,
    val useHttpTmpLink: Boolean? = null,
    val useLoadBalancing: Boolean? = null,
    val radio: Boolean = false,
)

data class StalkerCatalogItem(
    val id: Int,
    val name: String,
    val command: String?,
    val categoryId: String?,
    val coverUrl: String?,
    val plot: String?,
    val rating: Double?,
    val isSeries: Boolean,
    val useHttpTmpLink: Boolean? = null,
    val useLoadBalancing: Boolean? = null,
    val addedAtMs: Long? = null,
)

data class StalkerSeriesSeason(
    val id: String,
    val name: String,
    val command: String,
    val episodeNumbers: List<Int>,
    val contentType: String = "series",
    val videoId: String? = null,
)

data class StalkerSeriesDetails(
    val title: String,
    val plot: String?,
    val seasons: List<StalkerSeriesSeason>,
)

/**
 * Ministra panels are inconsistent about season labels: common forms are
 * `s02`, `S2`, `Season 2` and `2 сезон`. Keep the provider's number when it
 * is present and only use the response order as a fallback.
 */
internal fun stalkerSeasonNumber(label: String, fallback: Int): Int {
    val normalized = label.trim()
    val number = Regex("(?i)\\bs(?:eason)?\\s*0*(\\d+)\\b").find(normalized)?.groupValues?.getOrNull(1)?.toIntOrNull()
        ?: Regex("(?i)(?:^|\\s)0*(\\d+)\\s*(?:season|сезон(?:а|ов)?)(?:$|\\s)").find(normalized)?.groupValues?.getOrNull(1)?.toIntOrNull()
    return number?.takeIf { it > 0 } ?: fallback
}

/**
 * Some Ministra panels expose legacy series in the VOD response and mark
 * them with `is_series`, while newer panels expose the same entries through
 * the dedicated series response. Keep both forms and prefer the dedicated
 * row when the provider returns the same id twice.
 */
internal fun mergeStalkerSeriesCatalog(
    vod: List<StalkerCatalogItem>,
    series: List<StalkerCatalogItem>,
): List<StalkerCatalogItem> = (series + vod.filter { it.isSeries })
    .distinctBy { it.id }

/** Pure URL/header rules for the Stalker/Ministra HTTP contract. */
object StalkerRequestBuilder {
    const val MagUserAgent =
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250"

    fun normalizeEndpoint(raw: String): String {
        val uri = URI(raw.trim())
        require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) {
            "Stalker portal must use HTTP or HTTPS"
        }
        val path = uri.path.trimEnd('/')
        val endpoint = when {
            path.endsWith("/server/load.php", true) || path.endsWith("/portal.php", true) -> path
            path.endsWith("/c", true) -> path.removeSuffix("/c") + "/server/load.php"
            path.endsWith("/stalker_portal", true) -> "$path/server/load.php"
            else -> "$path/server/load.php"
        }
        return URI(uri.scheme, uri.userInfo, uri.host, uri.port, endpoint, null, null).toString()
    }

    /**
     * Returns the API paths commonly used by Ministra installations. Providers
     * often give users a landing page or a reseller alias rather than the
     * endpoint that actually answers the MAG contract.
     */
    fun endpointCandidates(raw: String): List<String> {
        val uri = URI(raw.trim())
        require(uri.scheme.equals("http", true) || uri.scheme.equals("https", true)) {
            "Stalker portal must use HTTP or HTTPS"
        }
        val path = uri.path.trimEnd('/')
        val base = when {
            path.endsWith("/server/load.php", true) -> path.removeSuffix("/server/load.php")
            path.endsWith("/portal.php", true) -> path.removeSuffix("/portal.php")
            path.endsWith("/c", true) -> path.removeSuffix("/c")
            path.endsWith(".php", true) -> path.substringBeforeLast('/')
            else -> path
        }
        val paths = buildList {
            add(StalkerRequestBuilder.normalizeEndpoint(raw).let { URI(it).path })
            add("$base/portal.php")
            add("$base/server/load.php")
            if (!base.endsWith("/stalker_portal", true)) {
                add("$base/stalker_portal/server/load.php")
            }
        }.distinct()
        return paths.map { endpoint ->
            URI(uri.scheme, uri.userInfo, uri.host, uri.port, endpoint, null, null).toString()
        }.distinct()
    }

    fun requestUrl(endpoint: String, params: Map<String, String>): String =
        endpoint + "?" + params.entries.joinToString("&") { "${encode(it.key)}=${encode(it.value)}" }

    /** Legacy radio rows may already contain the final HTTP stream URL. */
    fun isDirectHttpStream(raw: String): Boolean = runCatching {
        URI(raw.trim()).let { it.scheme.equals("http", true) || it.scheme.equals("https", true) }
    }.getOrDefault(false)

    /**
     * Mirrors IPTVnator's static-command decision. A portal must explicitly
     * expose both link flags before Android trusts a catalog command as a
     * playable URL; absent flags remain the conservative create_link path.
     */
    fun resolveStaticPlaybackUrl(
        useHttpTmpLink: Boolean?,
        useLoadBalancing: Boolean?,
        command: String,
    ): String? {
        if (useHttpTmpLink == null && useLoadBalancing == null) return null
        if (useHttpTmpLink == true || useLoadBalancing == true) return null
        val normalized = command.trim()
            .removePrefix("ffmpeg ")
            .removePrefix("ffrt3 ")
            .removePrefix("ffrt4 ")
            .trim()
        return runCatching {
            URI(normalized).takeIf {
                (it.scheme.equals("http", true) || it.scheme.equals("https", true)) &&
                    !it.host.isNullOrBlank() &&
                    !it.host.equals("localhost", true) &&
                    !it.host.equals("127.0.0.1")
            }?.toString()
        }.getOrNull()
    }

    fun headers(credentials: StalkerCredentials, token: String? = null): Map<String, String> = buildMap {
        put("Accept", "*/*")
        put("Accept-Language", "en-US,en;q=0.9")
        put("Connection", "keep-alive")
        put("User-Agent", MagUserAgent)
        put("X-User-Agent", MagUserAgent)
        put("Cookie", "mac=${credentials.macAddress}; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin")
        credentials.serialNumber?.takeIf { it.isNotBlank() }?.let { put("SN", it) }
        token?.takeIf { it.isNotBlank() }?.let { put("Authorization", "Bearer $it") }
    }

    /**
     * Playback headers follow IPTVnator's origin policy. A portal may mint a
     * stream on a completely different host; in that case forwarding the MAC
     * cookie/Bearer token is both rejected by some panels and unsafe.
     */
    fun playbackHeaders(
        credentials: StalkerCredentials,
        token: String?,
        streamUrl: String,
    ): Map<String, String> {
        val portal = runCatching { URI(credentials.portalUrl) }.getOrNull()
        val stream = runCatching { URI(streamUrl) }.getOrNull()
        val crossOrigin = portal != null && stream != null && (
            !portal.host.equals(stream.host, ignoreCase = true) ||
                (portal.scheme.equals("https", ignoreCase = true) && stream.scheme.equals("http", ignoreCase = true))
            )
        if (crossOrigin) {
            return mapOf(
                "User-Agent" to "KSPlayer",
                "Accept" to "*/*",
                "Connection" to "keep-alive",
                "Icy-MetaData" to "1",
            )
        }
        return headers(credentials, token) + mapOf(
            "Origin" to URI(credentials.portalUrl).let { "${it.scheme}://${it.authority}" },
            "Referer" to URI(credentials.portalUrl).let { "${it.scheme}://${it.authority}" },
        )
    }

    fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    /** Accepts the common 001A79AABBCC, 00:1A:79:AA:BB:CC and hyphenated forms. */
    fun normalizeMac(raw: String): String {
        val compact = raw.trim().replace(":", "").replace("-", "")
        require(compact.length == 12 && compact.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
            "La MAC debe tener 12 dígitos hexadecimales (por ejemplo 00:1A:79:AA:BB:CC)"
        }
        return compact.uppercase().chunked(2).joinToString(":")
    }

    fun isValidMac(raw: String): Boolean = runCatching { normalizeMac(raw) }.isSuccess

    fun prehash(macAddress: String): String = MessageDigest.getInstance("SHA-1")
        .digest(macAddress.uppercase().toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
        .uppercase()
}

class StalkerApiClient(
    private val connectTimeoutMs: Int = 15_000,
    private val readTimeoutMs: Int = 30_000,
) {
    fun authenticate(credentials: StalkerCredentials): StalkerSession {
        val normalized = credentials.copy(
            macAddress = StalkerRequestBuilder.normalizeMac(credentials.macAddress),
        )
        var lastFailure: Throwable? = null
        for (endpoint in StalkerRequestBuilder.endpointCandidates(credentials.portalUrl)) {
            try {
                return authenticateAt(normalized.copy(portalUrl = endpoint))
            } catch (failure: Throwable) {
                lastFailure = failure
            }
        }
        throw (lastFailure ?: error("No valid Stalker portal endpoint found"))
    }

    private fun authenticateAt(normalized: StalkerCredentials): StalkerSession {
        val handshake = request(normalized, mapOf("type" to "stb", "action" to "handshake", "token" to "", "prehash" to StalkerRequestBuilder.prehash(normalized.macAddress)))
        val token = handshake.optJSONObject("js")?.optString("token").orEmpty()
        check(token.isNotBlank()) { "Stalker handshake did not return a token" }
        val random = handshake.optJSONObject("js")?.optString("random").orEmpty().ifBlank { "0000000000000000000000000000000000000000" }
        val metrics = JSONObject()
            .put("mac", normalized.macAddress)
            .put("model", "MAG250")
            .put("type", "STB")
            .put("random", random)
            .apply { normalized.serialNumber?.takeIf(String::isNotBlank)?.let { put("sn", it) } }
        val profileIdentity = buildMap {
            normalized.serialNumber?.takeIf(String::isNotBlank)?.let { put("sn", it) }
            normalized.deviceId1?.takeIf(String::isNotBlank)?.let { put("device_id", it) }
            normalized.deviceId2?.takeIf(String::isNotBlank)?.let { put("device_id2", it) }
            normalized.signature1?.takeIf(String::isNotBlank)?.let { put("signature", it) }
            normalized.signature2?.takeIf(String::isNotBlank)?.let { put("signature2", it) }
        }
        fun getProfile(authSecondStep: Boolean): JSONObject = request(normalized, mapOf(
            "type" to "stb", "action" to "get_profile", "hd" to "1", "ver" to "ImageVersion: 0.2.18-r23-250;ImageDescription: 0.2.18-r23;ImageDate: 2013-10-31",
            "stb_type" to "MAG250", "not_valid_token" to "0",
            "auth_second_step" to if (authSecondStep) "1" else "0",
            "metrics" to metrics.toString(), "prehash" to StalkerRequestBuilder.prehash(normalized.macAddress),
        ) + profileIdentity, token)
        var profile = getProfile(authSecondStep = false)
        val profileJs = profile.optJSONObject("js")
        var status = profileJs?.optString("status").orEmpty()
        if (status == "2") {
            val user = normalized.username.orEmpty()
            val password = normalized.password.orEmpty()
            require(user.isNotBlank() && password.isNotBlank()) { "This Stalker portal requires username and password" }
            val authIdentity = buildMap {
                normalized.deviceId1?.takeIf(String::isNotBlank)?.let { put("device_id", it) }
                normalized.deviceId2?.takeIf(String::isNotBlank)?.let { put("device_id2", it) }
            }
            val auth = request(normalized, mapOf("type" to "stb", "action" to "do_auth", "login" to user, "password" to password) + authIdentity, token)
            check(auth.opt("js") == true) { "Stalker portal rejected credentials" }
            profile = getProfile(authSecondStep = true)
            val authenticatedProfile = profile.optJSONObject("js")
            status = authenticatedProfile?.optString("status").orEmpty()
        } else if (status == "1") {
            error(profileJs?.optString("msg")?.ifBlank { "Stalker account is blocked" } ?: "Stalker account is blocked")
        }
        if (status == "1") {
            val authenticatedProfile = profile.optJSONObject("js")
            error(authenticatedProfile?.optString("msg")?.ifBlank { "Stalker account is blocked" } ?: "Stalker account is blocked")
        }
        val finalProfile = profile.optJSONObject("js")
        val accountInfo = finalProfile?.optJSONObject("account_info")
        return StalkerSession(
            credentials = normalized,
            token = token,
            random = random,
            profileStatus = status.takeIf { it.isNotBlank() },
            profileMessage = finalProfile?.optString("msg").takeIf { !it.isNullOrBlank() },
            accountLogin = accountInfo?.optString("login").takeIf { !it.isNullOrBlank() },
            tariffPlanName = accountInfo?.optString("tariff_plan_name")
                ?.takeIf { it.isNotBlank() }
                ?: accountInfo?.optString("tariff_plan")?.takeIf { it.isNotBlank() },
            expirationEpochSeconds = accountInfo?.optEpochSeconds("expire_date")
                ?: accountInfo?.optEpochSeconds("expire_billing_date"),
        )
    }

    fun getGenres(session: StalkerSession): List<StalkerGenre> =
        jsArray(request(session.credentials, mapOf("type" to "itv", "action" to "get_genres"), session.token))
            .mapNotNull { item ->
                val id = item.optString("id").ifBlank { item.optString("category_id") }
                id.takeIf { it.isNotBlank() }?.let { StalkerGenre(it, item.optString("title").ifBlank { item.optString("name") }) }
            }

    fun getLiveChannels(session: StalkerSession, maxPages: Int = 100): List<StalkerChannel> = getChannels(session, "itv", maxPages)

    fun getRadioChannels(session: StalkerSession, maxPages: Int = 100): List<StalkerChannel> = getChannels(session, "radio", maxPages)

    /** Loads the portal's native bulk guide, keyed by the same channel ids used by the import. */
    fun getEpgInfo(session: StalkerSession, periodHours: Int = 168): List<TvEpgEntry> {
        val response = request(
            session.credentials,
            mapOf(
                "type" to "itv",
                "action" to "get_epg_info",
                "period" to periodHours.coerceIn(1, 336).toString(),
            ),
            session.token,
        )
        val data = response.optJSONObject("js")?.optJSONObject("data") ?: return emptyList()
        val entries = mutableListOf<TvEpgEntry>()
        data.keys().forEach { rawChannelId ->
            val programmes = data.optJSONArray(rawChannelId) ?: return@forEach
            val channelId = "stalker:$rawChannelId"
            for (index in 0 until programmes.length()) {
                val item = programmes.optJSONObject(index) ?: continue
                val start = item.optLongish("start_timestamp") ?: item.optEpochMs("start") ?: continue
                val end = item.optLongish("stop_timestamp") ?: item.optEpochMs("stop") ?: continue
                if (end <= start) continue
                val title = item.optString("name").ifBlank { item.optString("title") }.ifBlank { "Programa" }
                entries += TvEpgEntry(
                    channelId = channelId,
                    startMs = start,
                    endMs = end,
                    title = title,
                    description = item.optString("descr").takeIf { it.isNotBlank() },
                )
            }
        }
        return entries.sortedWith(compareBy({ it.channelId }, { it.startMs }))
    }

    /** Fetches a channel's current/near-future guide when a portal's bulk EPG omits it. */
    fun getShortEpgInfo(session: StalkerSession, channelId: String, size: Int = 3): List<TvEpgEntry> {
        val normalizedId = channelId.removePrefix("stalker:").takeIf(String::isNotBlank) ?: return emptyList()
        val response = request(
            session.credentials,
            mapOf(
                "type" to "itv",
                "action" to "get_short_epg",
                "ch_id" to normalizedId,
                "size" to size.coerceIn(1, MAX_SHORT_EPG_WINDOW).toString(),
            ),
            session.token,
        )
        return jsArray(response).mapNotNull { item ->
            val start = item.optLongish("start_timestamp") ?: item.optEpochMs("start") ?: item.optEpochMs("time")
                ?: return@mapNotNull null
            val end = item.optLongish("stop_timestamp") ?: item.optEpochMs("stop") ?: item.optEpochMs("time_to")
                ?: return@mapNotNull null
            if (end <= start) return@mapNotNull null
            TvEpgEntry(
                channelId = "stalker:$normalizedId",
                startMs = start,
                endMs = end,
                title = item.optString("name").ifBlank { item.optString("title") }.ifBlank { "Programa" },
                description = item.optString("descr").takeIf(String::isNotBlank),
            )
        }.sortedBy(TvEpgEntry::startMs)
    }

    private fun getChannels(session: StalkerSession, type: String, maxPages: Int): List<StalkerChannel> {
        // Ministra/MAG portals commonly expose the complete ITV/radio list in
        // one response. Prefer that contract to avoid needlessly crawling up
        // to 100 pages; older portals return an empty/error shape and continue
        // through the compatible ordered-list fallback below.
        val bulk = runCatching {
            jsArray(
                request(
                    session.credentials,
                    mapOf("type" to type, "action" to "get_all_channels"),
                    session.token,
                ),
            )
        }.getOrDefault(emptyList())
        if (bulk.isNotEmpty()) {
            return bulk.mapNotNull { parseChannel(it, type == "radio") }.distinctBy { it.id }
        }

        val firstResponse = orderedChannelPage(session, type, 1)
            ?: error("Failed to load Stalker $type channel page 1 after retry")
        val firstItems = jsArray(firstResponse)
        if (firstItems.isEmpty()) return emptyList()

        val pageSize = firstResponse.optJSONObject("js")
            ?.optString("max_page_items")?.toIntOrNull()
            ?.takeIf { it > 0 } ?: firstItems.size.coerceAtLeast(1)
        val totalItems = firstResponse.optJSONObject("js")
            ?.optString("total_items")?.toIntOrNull()
            ?.takeIf { it > 0 }
            ?.coerceAtMost(MAX_CHANNELS)
            ?: (pageSize * maxPages).coerceAtMost(MAX_CHANNELS)
        val totalPages = ((totalItems + pageSize - 1) / pageSize)
            .coerceIn(1, maxPages)

        val rawItems = mutableListOf<JSONObject>()
        val seenIds = mutableSetOf<String>()
        fun appendUnique(items: List<JSONObject>): Int {
            var added = 0
            items.forEach { item ->
                val id = item.optString("id").ifBlank { item.optString("stream_id") }
                if (id.isNotBlank() && seenIds.add(id)) {
                    rawItems += item
                    added += 1
                }
            }
            return added
        }
        appendUnique(firstItems)
        if (totalPages > 1 && rawItems.size >= pageSize) {
            val executor = Executors.newFixedThreadPool(FALLBACK_CONCURRENCY)
            try {
                var page = 2
                while (page <= totalPages && rawItems.size < totalItems) {
                    val end = (page + FALLBACK_CONCURRENCY - 1).coerceAtMost(totalPages)
                    val futures = (page..end).map { requestedPage ->
                        requestedPage to executor.submit(Callable { orderedChannelPage(session, type, requestedPage) })
                    }
                    var reachedEnd = false
                    futures.forEach { (requestedPage, future) ->
                        val response = runCatching { future.get() }.getOrNull()
                            ?: error("Failed to load Stalker $type channel page $requestedPage after retry")
                        val pageItems = jsArray(response)
                        if (pageItems.isEmpty() || appendUnique(pageItems) == 0) {
                            reachedEnd = true
                        }
                    }
                    if (reachedEnd) break
                    page = end + 1
                }
            } finally {
                executor.shutdownNow()
            }
        }
        return rawItems.mapNotNull { parseChannel(it, type == "radio") }.distinctBy { it.id }
    }

    private fun orderedChannelPage(
        session: StalkerSession,
        type: String,
        page: Int,
    ): JSONObject? {
        val params = mapOf(
            "type" to type,
            "action" to "get_ordered_list",
            "category" to "*",
            "genre" to "*",
            "sortby" to "number",
            "p" to page.toString(),
        )
        return runCatching { request(session.credentials, params, session.token) }
            .recoverCatching { request(session.credentials, params, session.token) }
            .getOrNull()
    }

    fun createLink(session: StalkerSession, command: String, contentType: String = "itv"): String {
        val response = request(session.credentials, mapOf("type" to contentType, "action" to "create_link", "cmd" to command), session.token)
        val link = response.optJSONObject("js")?.optString("cmd").orEmpty()
        check(link.isNotBlank()) { "Stalker portal did not return a playable link" }
        val cleaned = link.removePrefix("ffmpeg ").removePrefix("ffrt3 ").removePrefix("ffrt4 ").trim()
        return URI(session.credentials.portalUrl).resolve(cleaned).toString()
    }

    fun createSeriesEpisodeLink(
        session: StalkerSession,
        command: String,
        episodeNumber: Int,
        contentType: String = "series",
    ): String {
        val response = request(session.credentials, mapOf(
            "type" to contentType, "action" to "create_link", "cmd" to command, "series" to episodeNumber.toString(),
        ), session.token)
        val link = response.optJSONObject("js")?.optString("cmd").orEmpty()
        check(link.isNotBlank()) { "Stalker portal did not return a playable episode link" }
        val cleaned = link.removePrefix("ffmpeg ").removePrefix("ffrt3 ").removePrefix("ffrt4 ").trim()
        return URI(session.credentials.portalUrl).resolve(cleaned).toString()
    }

    fun getSeriesDetails(session: StalkerSession, seriesId: Int): StalkerSeriesDetails {
        val response = request(session.credentials, mapOf(
            "type" to "series", "action" to "get_ordered_list", "movie_id" to seriesId.toString(),
        ), session.token)
        val seasons = jsArray(response).mapNotNull { item ->
            val command = item.optString("cmd").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val numbers = item.optJSONArray("series")?.let { array ->
                (0 until array.length()).mapNotNull { array.optString(it).toIntOrNull() }
            }.orEmpty()
            StalkerSeriesSeason(
                id = item.optString("id").ifBlank { item.optString("season_id") },
                name = item.optString("name").ifBlank { "Temporada" },
                command = command,
                episodeNumbers = numbers,
            )
        }
        return StalkerSeriesDetails(
            title = response.optJSONObject("js")?.optString("name").orEmpty().ifBlank { "Serie" },
            plot = null,
            seasons = seasons,
        )
    }

    /** Loads Ministra's legacy `is_series=1` VOD-series seasons. */
    fun getVodSeriesDetails(session: StalkerSession, seriesId: Int, fallbackCommand: String? = null): StalkerSeriesDetails {
        val response = request(
            session.credentials,
            mapOf("type" to "vod", "action" to "get_ordered_list", "movie_id" to seriesId.toString(), "p" to "1"),
            session.token,
        )
        val seasons = jsArray(response).mapNotNull { item ->
            val seasonId = item.optString("id").ifBlank { item.optString("season_id") }.takeIf { it.isNotBlank() }
                ?: return@mapNotNull null
            val videoId = item.optString("video_id").ifBlank { seriesId.toString() }
            val numbers = item.optJSONArray("series")?.let { array ->
                (0 until array.length()).mapNotNull { array.optString(it).toIntOrNull() }.filter { it > 0 }
            }.orEmpty().ifEmpty {
                getVodSeriesEpisodeNumbers(session, videoId, seasonId)
            }
            val command = item.optString("cmd").ifBlank { fallbackCommand ?: videoId }
            StalkerSeriesSeason(
                id = seasonId,
                name = item.optString("name").ifBlank { "Temporada" },
                command = command,
                episodeNumbers = numbers,
                contentType = "vod",
                videoId = videoId,
            )
        }
        return StalkerSeriesDetails(
            title = "Serie",
            plot = null,
            seasons = seasons,
        )
    }

    private fun getVodSeriesEpisodeNumbers(session: StalkerSession, videoId: String, seasonId: String): List<Int> {
        val response = request(
            session.credentials,
            mapOf(
                "type" to "vod",
                "action" to "get_ordered_list",
                "movie_id" to videoId,
                "season_id" to seasonId,
                "p" to "1",
            ),
            session.token,
        )
        return jsArray(response).mapNotNull { item ->
            item.optInt("series_number", 0).takeIf { it > 0 }
                ?: item.optInt("episode_num", 0).takeIf { it > 0 }
                ?: item.optInt("number", 0).takeIf { it > 0 }
        }.distinct().sorted()
    }

    fun getCatalog(session: StalkerSession, contentType: String, maxPages: Int = 100): List<StalkerCatalogItem> {
        val items = mutableListOf<StalkerCatalogItem>()
        forEachCatalogItem(session, contentType, maxPages, items::add)
        return items
    }

    /** Loads one provider page at a time so large imports need not retain the full catalogue. */
    fun forEachCatalogItem(
        session: StalkerSession,
        contentType: String,
        maxPages: Int = 100,
        onItem: (StalkerCatalogItem) -> Unit,
    ) {
        require(contentType == "vod" || contentType == "series")
        require(maxPages > 0)
        val seenIds = mutableSetOf<Int>()
        fun requestCatalogPage(page: Int): JSONObject {
            val params = mutableMapOf(
                "type" to contentType,
                "action" to "get_ordered_list",
                "sortby" to "added",
                "p" to page.toString(),
                "category" to "*",
            )
            if (contentType == "vod") params["genre"] = "0"
            return request(session.credentials, params, session.token)
        }
        fun declaredPageCount(response: JSONObject): Int? {
            val js = response.optJSONObject("js")
            return js?.optString("total_pages")?.toIntOrNull()?.takeIf { it > 0 }
                ?: run {
                    val total = js?.optString("total_items")?.toIntOrNull()?.takeIf { it > 0 }
                    val size = js?.optString("max_page_items")?.toIntOrNull()?.takeIf { it > 0 }
                    if (total != null && size != null) (total + size - 1) / size else null
                }
        }
        fun appendPage(response: JSONObject): Pair<Int, Boolean> {
            val pageItems = jsArray(response)
            val pageCatalog = pageItems.mapNotNull(::parseCatalogItem)
            val newItems = pageCatalog.filter { seenIds.add(it.id) }
            newItems.forEach(onItem)
            return newItems.size to pageItems.isEmpty()
        }

        val firstPage = requestCatalogPage(1)
        val (firstAdded, firstEmpty) = appendPage(firstPage)
        if (firstEmpty || firstAdded == 0) return
        val pageCount = declaredPageCount(firstPage)?.coerceAtMost(maxPages)
        if (pageCount == null) {
            for (page in 2..maxPages) {
                val (added, empty) = appendPage(requestCatalogPage(page))
                if (empty || added == 0) break
            }
            return
        }

        // Fetch only a small window ahead, then persist each page in provider
        // order. This keeps memory bounded while avoiding one network roundtrip
        // per page on portals that declare their catalogue size.
        val executor = Executors.newFixedThreadPool(FALLBACK_CONCURRENCY)
        try {
            var page = 2
            while (page <= pageCount) {
                val end = (page + FALLBACK_CONCURRENCY - 1).coerceAtMost(pageCount)
                val futures = (page..end).map { requestedPage ->
                    requestedPage to executor.submit(Callable { requestCatalogPage(requestedPage) })
                }
                var reachedEnd = false
                futures.forEach { (requestedPage, future) ->
                    val response = runCatching { future.get() }.getOrNull()
                        ?: error("Failed to load Stalker $contentType catalogue page $requestedPage")
                    val (added, empty) = appendPage(response)
                    if (empty || added == 0) reachedEnd = true
                }
                if (reachedEnd) break
                page = end + 1
            }
        } finally {
            executor.shutdownNow()
        }
    }

    private fun request(credentials: StalkerCredentials, params: Map<String, String>, token: String? = null): JSONObject {
        val query = params + ("JsHttpRequest" to "1-xml")
        val connection = URI(StalkerRequestBuilder.requestUrl(credentials.portalUrl, query)).toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("Accept-Encoding", "gzip, deflate")
            StalkerRequestBuilder.headers(credentials, token).forEach { (key, value) -> connection.setRequestProperty(key, value) }
            connection.connect()
            check(connection.responseCode in 200..299) { "Stalker request failed with HTTP ${connection.responseCode}" }
            return JSONObject(decodeHttpResponseBody(connection.inputStream, connection.contentEncoding).bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    private fun jsArray(response: JSONObject): List<JSONObject> {
        val js = response.opt("js")
        val array = when (js) {
            is JSONArray -> js
            is JSONObject -> js.optJSONArray("data") ?: JSONArray()
            else -> JSONArray()
        }
        return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    }

    private fun parseChannel(item: JSONObject, radio: Boolean = false): StalkerChannel? {
        val id = item.optString("id").ifBlank { item.optString("stream_id") }
        val command = item.optString("cmd")
        if (id.isBlank() || command.isBlank()) return null
        return StalkerChannel(
            id = id,
            name = item.optString("name").ifBlank { item.optString("title").ifBlank { "Channel $id" } },
            command = command,
            genreId = nonBlank(item.optString("tv_genre_id").ifBlank { item.optString("category_id") }),
            logoUrl = nonBlank(item.optString("logo").ifBlank { item.optString("cover") }),
            tvgId = nonBlank(item.optString("xmltv_id")),
            useHttpTmpLink = item.optPortalFlag("use_http_tmp_link"),
            useLoadBalancing = item.optPortalFlag("use_load_balancing"),
            radio = radio || item.optBoolean("radio") || item.optString("radio") == "1",
        )
    }

    private fun parseCatalogItem(item: JSONObject): StalkerCatalogItem? {
        val id = item.optString("id").ifBlank { item.optString("movie_id") }.toIntOrNull() ?: return null
        val name = item.optString("name").ifBlank { item.optString("title") }.ifBlank { "Item $id" }
        val rating = item.optString("rating_imdb").toDoubleOrNull() ?: item.optString("rating_kinopoisk").toDoubleOrNull()
        return StalkerCatalogItem(
            id = id,
            name = name,
            command = item.optString("cmd").takeIf { it.isNotBlank() },
            categoryId = nonBlank(item.optString("category_name").ifBlank { item.optString("category_id") }),
            coverUrl = nonBlank(item.optString("cover").ifBlank { item.optString("screenshot_uri") }),
            plot = nonBlank(item.optString("description")),
            rating = rating,
            isSeries = item.optBoolean("is_series") || item.optString("is_series") == "1",
            useHttpTmpLink = item.optPortalFlag("use_http_tmp_link"),
            useLoadBalancing = item.optPortalFlag("use_load_balancing"),
            addedAtMs = item.optLongish("added") ?: item.optLongish("added_at"),
        )
    }

    private fun nonBlank(value: String): String? = value.takeIf { it.isNotBlank() }

    /** Preserve presence as well as truthiness; absence means legacy/unknown. */
    private fun JSONObject.optPortalFlag(key: String): Boolean? = if (!has(key) || isNull(key)) {
        null
    } else {
        when (val value = opt(key)) {
            is Boolean -> value
            is Number -> value.toInt() != 0
            else -> value?.toString().orEmpty().trim().let { it.isNotEmpty() && it != "0" && !it.equals("false", true) }
        }
    }

    private fun JSONObject.optLongish(key: String): Long? = when (val value = opt(key)) {
        is Number -> value.toLong()
        is String -> value.trim().toLongOrNull()
        else -> null
    }?.let { if (it in 1L..9_999_999_999L) it * 1_000L else it }

    private fun JSONObject.optEpochSeconds(key: String): Long? = parseStalkerEpochSeconds(opt(key))

    private fun parseStalkerEpochSeconds(value: Any?): Long? = when (value) {
        is Number -> value.toLong()
        is String -> value.trim().toLongOrNull()
        else -> null
    }?.let { if (it > 32_503_680_000L) it / 1_000L else it }
        ?.takeIf { it > 0L }
        ?: (value as? String)?.trim()?.let { text ->
            if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(text)) return@let null
            runCatching {
                SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }
                    .parse(text)?.time?.div(1_000L)
            }.getOrNull()
        }?.takeIf { it > 0L }

    private fun JSONObject.optEpochMs(key: String): Long? = optLongish(key)
}
