package com.iptvnator.googletv.epg

/** Chooses the programme a live channel should advertise right now. */
fun selectCurrentOrNextEpgEntry(
    entries: List<TvEpgEntry>,
    nowMs: Long,
): TvEpgEntry? {
    var current: TvEpgEntry? = null
    var next: TvEpgEntry? = null
    entries.forEach { entry ->
        when {
            entry.startMs <= nowMs && entry.endMs > nowMs -> {
                // Stable tie behavior: on overlapping programmes, choose the
                // one that started first, just as the original sorted lookup.
                if (current == null || entry.startMs < current.startMs) current = entry
            }
            entry.endMs > nowMs -> {
                if (next == null || entry.startMs < next.startMs) next = entry
            }
        }
    }
    return current ?: next
}

/** Keeps the current programme visible when the source also contains catch-up history. */
fun selectEpgWindow(
    entries: List<TvEpgEntry>,
    nowMs: Long,
    maxItems: Int,
): List<TvEpgEntry> {
    if (maxItems <= 0) return emptyList()
    val sorted = entries.sortedBy { it.startMs }
    if (sorted.size <= maxItems) return sorted
    val anchor = sorted.indexOfFirst { it.endMs > nowMs }.let { if (it >= 0) it else sorted.lastIndex }
    val before = maxItems / 3
    val start = (anchor - before).coerceIn(0, sorted.size - maxItems)
    return sorted.subList(start, start + maxItems)
}
