package com.iptvnator.googletv.playlist

import java.net.URI

private val vodExtensions = setOf(
    "avi", "asf", "divx", "flv", "m2ts", "m4v", "mkv", "mov", "mp4",
    "mpeg", "mpg", "rm", "rmvb", "vob", "webm", "wmv",
)
private val movieSegments = setOf("movie", "movies", "vod")
private val episodeCode = Regex("(?:^|[^a-z0-9])s\\d{1,2}[\\s._-]*e\\d{1,3}(?![a-z0-9])", RegexOption.IGNORE_CASE)
private val crossEpisodeCode = Regex("(?:^|[^0-9])\\d{1,2}x\\d{2,3}(?![0-9])")
private val seasonOrEpisodeWords =
    "season|сезон|staffel|temporada|saison|episode|episodio|folge|серия|эпизод|bölüm|odcinek|aflevering"
private val episodeWord = Regex(
    "(?:^|[^\\p{L}])($seasonOrEpisodeWords)[\\s._-]*\\d{1,3}(?!\\d)",
    RegexOption.IGNORE_CASE,
)
private val numberFirstEpisodeWord = Regex(
    "(?:^|[^\\p{L}\\d])\\d{1,2}[\\s._-]*(?:st|nd|rd|th|й|и|я|ой|ои)?[\\s._-]*($seasonOrEpisodeWords)(?:$|[^\\p{L}])",
    RegexOption.IGNORE_CASE,
)

private fun pathSegments(url: String): List<String> = runCatching {
    URI(url).path.orEmpty().split('/').filter(String::isNotEmpty).map(String::lowercase)
}.getOrDefault(emptyList())

private fun mediaExtension(url: String): String? = runCatching {
    val uri = URI(url)
    val queryValues = uri.query.orEmpty().split('&')
        .mapNotNull { parameter ->
            parameter.split('=', limit = 2).takeIf { it.size == 2 }?.let { parts ->
                parts[0].lowercase() to parts[1].lowercase().removePrefix(".")
            }
        }
    val declared = listOf("extension", "ext", "format", "container")
        .firstNotNullOfOrNull { key -> queryValues.firstOrNull { it.first == key }?.second }
        ?.let { value ->
            when (value) {
                "hls" -> "m3u8"
                "mpegts", "mpeg-ts" -> "ts"
                else -> value
            }
        }
    declared?.takeIf(String::isNotBlank)
        ?: uri.path.orEmpty().substringAfterLast('.', "").lowercase().takeIf(String::isNotBlank)
}.getOrNull()

/** Mirrors IPTVnator's conservative M3U playback VOD heuristic. */
fun isLikelyTvM3uVod(channel: TvChannel?): Boolean {
    if (channel == null || channel.radio || channel.url.isBlank()) return false
    if (mediaExtension(channel.url) == "mpd") return false
    return mediaExtension(channel.url) in vodExtensions || pathSegments(channel.url).any { it in movieSegments || it == "series" }
}

/** Movie metadata gate; series episodes remain VOD playback but are not films. */
fun isLikelyTvM3uMovie(channel: TvChannel?): Boolean {
    if (!isLikelyTvM3uVod(channel)) return false
    val value = channel ?: return false
    val segments = pathSegments(value.url)
    return "series" !in segments &&
        !episodeCode.containsMatchIn(value.name) &&
        !crossEpisodeCode.containsMatchIn(value.name) &&
        !episodeWord.containsMatchIn(value.name) &&
        !numberFirstEpisodeWord.containsMatchIn(value.name)
}
