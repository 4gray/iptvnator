package com.iptvnator.googletv.playlist

import com.iptvnator.googletv.TvDrmConfig
import com.iptvnator.googletv.parseTvDrmProperties
import java.io.BufferedReader
import java.io.StringReader

data class TvPlaylist(
    val name: String,
    val channels: List<TvChannel>,
    val epgUrl: String? = null,
    val epgUrls: List<String> = emptyList(),
    /** Region-matched guides to auto-import; every detected URL remains in [epgUrls]. */
    val recommendedEpgUrls: List<String> = emptyList(),
)

data class TvChannel(
    val id: String,
    val name: String,
    val url: String,
    val group: String? = null,
    val logoUrl: String? = null,
    val tvgId: String? = null,
    val tvgName: String? = null,
    val userAgent: String? = null,
    val headers: Map<String, String> = emptyMap(),
    val tvArchive: Boolean = false,
    val tvArchiveDurationMinutes: Int = 0,
    val catchupSource: String? = null,
    val catchupType: String? = null,
    val catchupDays: Int = 0,
    /** Provider-native command (e.g. Stalker `cmd`), resolved just before playback. */
    val providerCommand: String? = null,
    /** Stalker link flags; null means the provider did not expose provenance. */
    val useHttpTmpLink: Boolean? = null,
    val useLoadBalancing: Boolean? = null,
    val radio: Boolean = false,
    val channelNumber: Int? = null,
    val drm: TvDrmConfig? = null,
    /** Xtream/Stalker category id; null for plain M3U entries. */
    val providerCategoryId: String? = null,
)

/**
 * Tolerant M3U parser for IPTV sources. It intentionally preserves the
 * provider metadata needed by the TV client instead of normalising it away.
 */
object M3uPlaylistParser {
    private val attributePattern = Regex("([\\w-]+)=(?:\\\"([^\\\"]*)\\\"|([^\\s]+))")
    private val remoteEpgUrlPattern = Regex("https?://[^\\s,\\\"]+", RegexOption.IGNORE_CASE)

    fun parse(content: String, fallbackName: String = "Playlist"): TvPlaylist {
        val channels = mutableListOf<TvChannel>()
        val parsed = parse(StringReader(content).buffered(), fallbackName, channels::add)
        return parsed.copy(channels = channels)
    }

    /** Parses a remote playlist line-by-line without retaining its full catalogue in memory. */
    fun parse(reader: BufferedReader, fallbackName: String = "Playlist", onChannel: (TvChannel) -> Unit): TvPlaylist {
        return parseInternal(reader, fallbackName, deduplicateChannelIds = true, onChannel)
    }

    /**
     * Streaming storage imports can delegate duplicate-ID resolution to their
     * persistent sink instead of retaining every channel ID in heap memory.
     */
    fun parseStreaming(
        reader: BufferedReader,
        fallbackName: String = "Playlist",
        onChannel: (TvChannel) -> Unit,
    ): TvPlaylist {
        return parseInternal(reader, fallbackName, deduplicateChannelIds = false, onChannel)
    }

    private fun parseInternal(
        reader: BufferedReader,
        fallbackName: String,
        deduplicateChannelIds: Boolean,
        onChannel: (TvChannel) -> Unit,
    ): TvPlaylist {
        var pending: PendingEntry? = null
        var channelCount = 0
        val usedChannelIds: MutableSet<String>? = if (deduplicateChannelIds) mutableSetOf() else null
        var currentGroup: String? = null
        var currentUserAgent: String? = null
        var currentHeaders: MutableMap<String, String> = mutableMapOf()
        var epgUrl: String? = null
        var parsedEpgUrls: List<String> = emptyList()
        val playlistCountries = linkedSetOf<String>()
        val playlistLanguages = linkedSetOf<String>()
        var headerCatchupSource: String? = null
        var headerCatchupType: String? = null
        var headerCatchupDays = 0
        var pendingDrm = linkedMapOf<String, String>()

        generateSequence(reader::readLine)
            .map { it.trim().removePrefix("\uFEFF").trim() }
            .filter(String::isNotEmpty)
            .forEach { line ->
                when {
                    line.startsWith("#EXTM3U", ignoreCase = true) -> {
                        val attributes = attributePattern.findAll(line).associate {
                            it.groupValues[1].lowercase() to it.groupValues[2].ifEmpty { it.groupValues[3] }
                        }
                        // IPTVnator and common providers use all three of
                        // these equivalent XMLTV header names. Keep the
                        // first declared URL so importing a playlist through
                        // Android TV has the same automatic EPG behavior as
                        // the web client.
                        parsedEpgUrls = listOf("x-tvg-url", "url-tvg", "tvg-url")
                            .asSequence()
                            .mapNotNull { attributes[it] }
                            .flatMap { value -> remoteEpgUrlPattern.findAll(value).map { it.value } }
                            .distinct()
                            .toList()
                        epgUrl = parsedEpgUrls.firstOrNull()
                        headerCatchupSource = attributes["catchup-source"]?.takeIf(String::isNotBlank)
                        headerCatchupType = attributes["catchup"]?.takeIf(String::isNotBlank)
                        headerCatchupDays = catchupDays(attributes)
                    }
                    line.startsWith("#EXTINF", ignoreCase = true) -> {
                        pending = parseEntry(line)
                    }
                    line.startsWith("#EXTGRP:", ignoreCase = true) -> {
                        currentGroup = line.substringAfter(':').trim().ifEmpty { null }
                    }
                    line.startsWith("#EXTVLCOPT:http-user-agent=", ignoreCase = true) -> {
                        currentUserAgent = line.substringAfter('=').trim()
                    }
                    line.startsWith("#EXTVLCOPT:http-referrer=", ignoreCase = true) -> {
                        currentHeaders["Referer"] = line.substringAfter('=').trim()
                    }
                    line.startsWith("#EXTVLCOPT:http-origin=", ignoreCase = true) -> {
                        currentHeaders["Origin"] = line.substringAfter('=').trim()
                    }
                    line.startsWith("#KODIPROP:", ignoreCase = true) -> {
                        val assignment = line.substringAfter(':')
                        val separator = assignment.indexOf('=')
                        if (separator > 0) {
                            val key = assignment.substring(0, separator).trim().lowercase()
                            if (key == "inputstream.adaptive.drm_legacy" ||
                                key.startsWith("inputstream.adaptive.license_") ||
                                key == "inputstream.adaptive.server_certificate" ||
                                key == "inputstream.adaptive.pre_init_data"
                            ) {
                                pendingDrm[key] = assignment.substring(separator + 1).trim()
                            }
                        }
                    }
                    line.startsWith("#") -> Unit
                    pending != null -> {
                        val entry = pending ?: return@forEach
                        val (streamUrl, inlineHeaders) = parseStreamOptions(line)
                        val group = entry.group ?: currentGroup
                        addDelimitedRegionCodes(playlistCountries, entry.tvgCountry)
                        entry.tvgId?.trim()?.lowercase()?.substringAfterLast('.')
                            ?.takeIf { it.matches(Regex("[a-z]{2}")) }
                            ?.let(playlistCountries::add)
                        normalizeLanguageCode(entry.tvgLanguage)?.let(playlistLanguages::add)
                        val effectiveCatchupDays = entry.catchupDays.takeIf { it > 0 } ?: headerCatchupDays
                        val baseId = entry.tvgId ?: "${channelCount}:$line"
                        val channelId = usedChannelIds?.let { ids ->
                            var candidate = baseId
                            var duplicateSuffix = 1
                            while (!ids.add(candidate)) {
                                duplicateSuffix += 1
                                candidate = "$baseId#duplicate-$duplicateSuffix"
                            }
                            candidate
                        } ?: baseId
                        onChannel(TvChannel(
                            id = channelId,
                            name = entry.name,
                            url = streamUrl,
                            group = group,
                            logoUrl = entry.logoUrl,
                            tvgId = entry.tvgId,
                            tvgName = entry.tvgName,
                            userAgent = inlineHeaders["User-Agent"] ?: currentUserAgent ?: entry.userAgent,
                            headers = entry.headers + currentHeaders + inlineHeaders.filterKeys { it != "User-Agent" },
                            tvArchive = effectiveCatchupDays > 0,
                            tvArchiveDurationMinutes = effectiveCatchupDays * 24 * 60,
                            catchupSource = entry.catchupSource ?: headerCatchupSource,
                            catchupType = entry.catchupType ?: headerCatchupType,
                            catchupDays = effectiveCatchupDays,
                            radio = entry.radio,
                            channelNumber = entry.channelNumber,
                            drm = parseTvDrmProperties(pendingDrm),
                        ))
                        channelCount += 1
                        pending = null
                        // #EXTGRP is scoped to the entry whose URL follows it;
                        // do not let it silently categorise later channels.
                        currentGroup = null
                        currentUserAgent = null
                        currentHeaders = mutableMapOf()
                        pendingDrm = linkedMapOf()
                    }
                }
            }

        return TvPlaylist(
            name = fallbackName,
            channels = emptyList(),
            epgUrl = epgUrl,
            epgUrls = parsedEpgUrls,
            recommendedEpgUrls = selectRecommendedEpgUrls(
                parsedEpgUrls,
                playlistCountries,
                playlistLanguages,
            ),
        )
    }

    private fun parseEntry(line: String): PendingEntry {
        val titleDelimiter = findTitleDelimiter(line)
        val metadata = if (titleDelimiter >= 0) {
            line.substring(titleDelimiter + 1).trim().ifEmpty { "Untitled" }
        } else {
            "Untitled"
        }
        // M3U providers are inconsistent about attribute casing. The web
        // parser treats metadata keys case-insensitively, so normalize them
        // here before looking up tvg/group/catch-up fields.
        val attributeText = if (titleDelimiter >= 0) line.substring(0, titleDelimiter) else line
        val attributes = attributePattern.findAll(attributeText).associate {
            it.groupValues[1].lowercase() to (it.groupValues[2].ifEmpty { it.groupValues[3] })
        }
        return PendingEntry(
            name = metadata,
            group = attributes["group-title"]?.ifEmpty { null },
            logoUrl = attributes["tvg-logo"]?.ifEmpty { null },
            tvgId = attributes["tvg-id"]?.ifEmpty { null },
            tvgName = attributes["tvg-name"]?.ifEmpty { null },
            tvgCountry = attributes["tvg-country"]?.ifEmpty { null },
            tvgLanguage = attributes["tvg-language"]?.ifEmpty { null },
            userAgent = attributes["http-user-agent"]?.ifEmpty { null },
            headers = buildMap {
                attributes["http-referrer"]?.takeIf(String::isNotBlank)?.let { put("Referer", it) }
                attributes["http-origin"]?.takeIf(String::isNotBlank)?.let { put("Origin", it) }
            },
            catchupSource = attributes["catchup-source"]?.ifEmpty { null },
            catchupType = attributes["catchup"]?.ifEmpty { null },
            catchupDays = catchupDays(attributes),
            radio = attributes["radio"]?.let(::isTrue) == true,
            channelNumber = sequenceOf(attributes["tvg-chno"], attributes["channel-number"], attributes["number"])
                .mapNotNull { it?.toIntOrNull() }
                .firstOrNull(),
        )
    }

    /** EXTINF attribute values may contain commas; only an unquoted comma starts the title. */
    private fun findTitleDelimiter(line: String): Int {
        var quoted = false
        var index = 0
        while (index < line.length) {
            when (line[index]) {
                '"' -> {
                    // An escaped quote inside a quoted value is data, not the end of that value.
                    if (quoted && index > 0 && line[index - 1] == '\\') {
                        index++
                        continue
                    }
                    quoted = !quoted
                }
                ',' -> if (!quoted) return index
            }
            index++
        }
        return -1
    }

    private fun catchupDays(attributes: Map<String, String>): Int = sequenceOf(
        attributes["catchup-days"], attributes["timeshift"], attributes["tvg-rec"],
    ).mapNotNull { it?.toIntOrNull() }.firstOrNull { it > 0 } ?: 0

    private fun selectRecommendedEpgUrls(
        urls: List<String>,
        countries: Set<String>,
        languages: Set<String>,
    ): List<String> {
        if (urls.size <= AUTO_IMPORT_EPG_URL_LIMIT) return urls
        val matching = urls.filter { url ->
            val path = runCatching { java.net.URI(url).path }.getOrNull() ?: url
            val segments = path.split('/').map { it.trim().lowercase() }.filter(String::isNotEmpty)
            val guideIndex = segments.indexOf("guides")
            val guideCodes = segments.getOrNull(guideIndex + 1)?.split('-').orEmpty()
            val country = guideCodes.getOrNull(0)?.takeIf { it.matches(Regex("[a-z]{2}")) }
            val language = guideCodes.getOrNull(1)?.takeIf { it.matches(Regex("[a-z]{2}")) }
            // epgshare01-style files carry the country in the file name
            // (epg_ripper_ES1.xml.gz, epg_ripper_RAKUTEN_ES1.xml.gz).
            val fileCountries = if (guideIndex >= 0) emptyList() else epgFileNameTokens(url)
                .map { it.trimEnd(Char::isDigit) }
                .filter { it.matches(Regex("[a-z]{2}")) }
            (country != null && country in countries) ||
                fileCountries.any { it in countries } ||
                (countries.isEmpty() && language != null && language in languages)
        }.take(RECOMMENDED_EPG_URL_LIMIT)
        // Without a regional match, never auto-import catch-all aggregates
        // (epg_ripper_ALL_SOURCES is hundreds of MB): a TV would spend the
        // whole import parsing a worldwide guide.
        return matching.ifEmpty { urls.filterNot(::isAggregateEpgUrl).take(AUTO_IMPORT_EPG_URL_LIMIT) }
    }

    private fun epgFileNameTokens(url: String): List<String> {
        val path = runCatching { java.net.URI(url).path }.getOrNull() ?: url
        return path.substringAfterLast('/').lowercase().substringBefore('.')
            .split('_', '-').filter(String::isNotEmpty)
    }

    private fun isAggregateEpgUrl(url: String): Boolean {
        val tokens = epgFileNameTokens(url).map { it.trimEnd(Char::isDigit) }
        return "all" in tokens || "sources" in tokens || "world" in tokens || "global" in tokens
    }

    private fun addDelimitedRegionCodes(target: MutableSet<String>, value: String?) {
        value.orEmpty().split(Regex("[;,\\s]+")).forEach { code ->
            code.trim().lowercase().takeIf { it.matches(Regex("[a-z]{2}")) }?.let(target::add)
        }
    }

    private fun normalizeLanguageCode(value: String?): String? {
        val normalized = value?.trim()?.lowercase() ?: return null
        if (normalized.matches(Regex("[a-z]{2}"))) return normalized
        return LANGUAGE_CODES[normalized]
    }

    private fun isTrue(value: String): Boolean = value.equals("true", true) || value == "1" || value.equals("yes", true)

    /** IPTV providers commonly append VLC-style request headers after a pipe. */
    private fun parseStreamOptions(line: String): Pair<String, Map<String, String>> {
        val parts = line.split('|', limit = 2)
        if (parts.size == 1) return line to emptyMap()
        val headers = buildMap {
            parts[1].split('&').forEach { assignment ->
                val separator = assignment.indexOf('=')
                if (separator <= 0) return@forEach
                val key = assignment.substring(0, separator).trim().lowercase()
                val value = assignment.substring(separator + 1).trim()
                if (value.isBlank()) return@forEach
                when (key) {
                    "user-agent" -> put("User-Agent", value)
                    "referer", "referrer" -> put("Referer", value)
                    "origin" -> put("Origin", value)
                }
            }
        }
        return parts[0].trim() to headers
    }

    private data class PendingEntry(
        val name: String,
        val group: String?,
        val logoUrl: String?,
        val tvgId: String?,
        val tvgName: String?,
        val userAgent: String?,
        val tvgCountry: String?,
        val tvgLanguage: String?,
        val headers: Map<String, String>,
        val catchupSource: String?,
        val catchupType: String?,
        val catchupDays: Int,
        val radio: Boolean,
        val channelNumber: Int?,
    )

    private const val AUTO_IMPORT_EPG_URL_LIMIT = 5
    private const val RECOMMENDED_EPG_URL_LIMIT = 12
    private val LANGUAGE_CODES = mapOf(
        "arabic" to "ar",
        "english" to "en",
        "french" to "fr",
        "german" to "de",
        "italian" to "it",
        "polish" to "pl",
        "portuguese" to "pt",
        "russian" to "ru",
        "spanish" to "es",
        "turkish" to "tr",
        "ukrainian" to "uk",
    )
}
