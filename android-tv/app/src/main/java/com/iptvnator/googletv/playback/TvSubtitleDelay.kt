package com.iptvnator.googletv.playback

private val subtitleCuePattern = Regex(
    "(?m)(\\d{1,2}:\\d{2}:\\d{2}[,.]\\d{3})\\s*-->\\s*(\\d{1,2}:\\d{2}:\\d{2}[,.]\\d{3})",
)

internal fun shiftTvSubtitleCues(text: String, delayMs: Long): String {
    if (delayMs == 0L) return text
    return subtitleCuePattern.replace(text) { match ->
        val first = formatTvSubtitleTimestamp(parseTvSubtitleTimestamp(match.groupValues[1]) + delayMs, match.groupValues[1])
        val second = formatTvSubtitleTimestamp(parseTvSubtitleTimestamp(match.groupValues[2]) + delayMs, match.groupValues[2])
        "$first --> $second"
    }
}

private fun parseTvSubtitleTimestamp(value: String): Long {
    val parts = value.replace(',', '.').split(':')
    val hours = parts.getOrNull(0)?.toLongOrNull() ?: 0L
    val minutes = parts.getOrNull(1)?.toLongOrNull() ?: 0L
    val seconds = parts.getOrNull(2)?.substringBefore('.')?.toLongOrNull() ?: 0L
    val millis = parts.getOrNull(2)?.substringAfter('.', "")?.padEnd(3, '0')?.take(3)?.toLongOrNull() ?: 0L
    return ((hours * 60L + minutes) * 60L + seconds) * 1_000L + millis + 0L
}

private fun formatTvSubtitleTimestamp(value: Long, original: String): String {
    val safe = value.coerceAtLeast(0L)
    val hours = safe / 3_600_000L
    val minutes = (safe / 60_000L) % 60L
    val seconds = (safe / 1_000L) % 60L
    val millis = safe % 1_000L
    val separator = if (original.contains(',')) ',' else '.'
    return "%02d:%02d:%02d%c%03d".format(hours, minutes, seconds, separator, millis)
}
