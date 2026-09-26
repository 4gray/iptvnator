package com.iptvnator.googletv.epg

import com.iptvnator.googletv.playlist.TvChannel

data class TvEpgSearchChannel(
    val playlistId: String,
    val channel: TvChannel,
    val programmes: List<TvEpgEntry>,
)

data class TvEpgSearchHit(
    val playlistId: String,
    val channel: TvChannel,
    val programme: TvEpgEntry,
)

const val TV_EPG_SEARCH_MIN_QUERY_LENGTH = 2
const val TV_EPG_SEARCH_RESULT_LIMIT = 20

/** Searches an in-memory guide window and puts live/soonest matches first. */
fun searchTvEpgPrograms(
    channels: List<TvEpgSearchChannel>,
    query: String,
    nowMs: Long,
    limit: Int = TV_EPG_SEARCH_RESULT_LIMIT,
): List<TvEpgSearchHit> {
    val term = query.trim()
    if (term.length < TV_EPG_SEARCH_MIN_QUERY_LENGTH || limit <= 0) return emptyList()

    val hits = channels.asSequence()
        .flatMap { row ->
            row.programmes.asSequence()
                .map { programme -> TvEpgSearchHit(row.playlistId, row.channel, programme) }
        }
        .toList()
    return rankTvEpgSearchHits(hits, term, nowMs, limit)
}

/** Merges persisted XMLTV matches with transient provider previews using a single result order. */
fun rankTvEpgSearchHits(
    hits: Iterable<TvEpgSearchHit>,
    query: String,
    nowMs: Long,
    limit: Int = TV_EPG_SEARCH_RESULT_LIMIT,
): List<TvEpgSearchHit> {
    val term = query.trim()
    if (term.length < TV_EPG_SEARCH_MIN_QUERY_LENGTH || limit <= 0) return emptyList()
    return hits.asSequence()
        .filter { hit ->
            sequenceOf(
                hit.programme.title,
                hit.programme.subtitle,
                hit.programme.description,
                hit.programme.category,
            ).filterNotNull().any { it.contains(term, ignoreCase = true) }
        }
        .distinctBy { hit ->
            listOf(hit.playlistId, hit.channel.id, hit.programme.startMs.toString(), hit.programme.title)
        }
        .sortedWith(
            compareBy<TvEpgSearchHit> { hit ->
                when {
                    hit.programme.startMs <= nowMs && hit.programme.endMs > nowMs -> 0
                    hit.programme.startMs > nowMs -> 1
                    else -> 2
                }
            }.thenBy { hit ->
                when {
                    hit.programme.startMs <= nowMs && hit.programme.endMs > nowMs -> 0L
                    hit.programme.startMs > nowMs -> hit.programme.startMs - nowMs
                    else -> nowMs - hit.programme.endMs
                }
            },
        )
        .take(limit)
        .toList()
}
