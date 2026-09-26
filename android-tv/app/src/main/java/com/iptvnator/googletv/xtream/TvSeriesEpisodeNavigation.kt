package com.iptvnator.googletv.xtream

data class TvSeriesEpisodeNeighbors(
    val previous: XtreamSeriesEpisode?,
    val next: XtreamSeriesEpisode?,
)

/** Resolve adjacent episodes without crossing the current season boundary. */
fun tvSeriesEpisodeNeighbors(
    episodes: List<XtreamSeriesEpisode>,
    currentEpisodeId: Int,
): TvSeriesEpisodeNeighbors {
    val currentEpisode = episodes.firstOrNull { it.id == currentEpisodeId }
        ?: return TvSeriesEpisodeNeighbors(previous = null, next = null)
    val seasonEpisodes = episodes.filter { it.season == currentEpisode.season }
    val currentIndex = seasonEpisodes.indexOfFirst { it.id == currentEpisodeId }
    if (currentIndex < 0) return TvSeriesEpisodeNeighbors(previous = null, next = null)

    return TvSeriesEpisodeNeighbors(
        previous = seasonEpisodes.getOrNull(currentIndex - 1),
        next = seasonEpisodes.getOrNull(currentIndex + 1),
    )
}
