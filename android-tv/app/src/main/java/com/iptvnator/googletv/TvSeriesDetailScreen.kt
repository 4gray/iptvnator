package com.iptvnator.googletv

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.CardDefaults
import coil.compose.AsyncImage
import com.iptvnator.googletv.playlist.TvEpisodeProgress
import com.iptvnator.googletv.tmdb.TmdbDetails
import com.iptvnator.googletv.xtream.XtreamSeriesDetails
import com.iptvnator.googletv.xtream.XtreamSeriesEpisode
import kotlinx.coroutines.delay

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TvSeriesDetailScreen(
    details: XtreamSeriesDetails,
    tmdb: TmdbDetails? = null,
    episodeProgress: Map<Int, TvEpisodeProgress> = emptyMap(),
    onBack: () -> Unit,
    onPlayEpisode: (XtreamSeriesEpisode) -> Unit,
    onDownloadEpisode: ((XtreamSeriesEpisode) -> Unit)? = null,
    onDownloadEpisodes: ((List<XtreamSeriesEpisode>) -> Unit)? = null,
    onToggleEpisodesWatched: ((List<XtreamSeriesEpisode>, Boolean) -> Unit)? = null,
    isFavorite: Boolean = false,
    onToggleFavorite: (() -> Unit)? = null,
    downloadMessage: String? = null,
) {
    val seasons = remember(details) { details.episodes.groupBy { it.season }.toSortedMap() }
    // Resume where the viewer left off: the first episode that is started but
    // unfinished, else the first unwatched one, else the very first episode.
    val resumeEpisode = remember(details, episodeProgress) {
        details.episodes.sortedWith(compareBy({ it.season }, { it.episode })).let { ordered ->
            ordered.firstOrNull { episodeProgress[it.id]?.let { p -> !p.completed && p.positionMs > 0L } == true }
                ?: ordered.firstOrNull { episodeProgress[it.id]?.completed != true }
                ?: ordered.firstOrNull()
        }
    }
    var selectedSeason by remember(details) {
        mutableIntStateOf(resumeEpisode?.season ?: seasons.keys.firstOrNull() ?: 0)
    }
    val episodes = seasons[selectedSeason].orEmpty()
    var selectedEpisodeId by remember(details) { mutableIntStateOf(0) }
    val selectedEpisode = episodes.firstOrNull { it.id == selectedEpisodeId } ?: episodes.firstOrNull()
    val playFocusRequester = remember(details) { FocusRequester() }
    val seasonFocusRequester = remember(details) { FocusRequester() }
    val firstEpisodeFocusRequester = remember(details) { FocusRequester() }

    LaunchedEffect(details) {
        delay(100)
        if (resumeEpisode != null) playFocusRequester.requestFocus() else seasonFocusRequester.requestFocus()
    }

    BackHandler(onBack = onBack)
    val poster = tmdb?.posterPath?.let { "https://image.tmdb.org/t/p/w500$it" } ?: details.coverUrl
    val backdrop = tmdb?.backdropPath?.let { "https://image.tmdb.org/t/p/w1280$it" }
    TvDetailBackdrop(backdropUrl = backdrop, posterUrl = poster) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 56.dp, vertical = 36.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.CenterVertically) {
                TvDetailPoster(poster, details.name, Modifier.width(170.dp).height(255.dp))
                Column(Modifier.widthIn(max = 640.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    TvEyebrow("Serie")
                    Text(
                        tmdb?.title ?: details.name,
                        color = tvTone(TvTone.Text),
                        fontFamily = TvType.Display,
                        fontSize = 36.sp,
                        lineHeight = 38.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val watchedCount = details.episodes.count { episodeProgress[it.id]?.completed == true }
                    TvDetailFacts(
                        listOfNotNull(
                            "${seasons.size} ${if (seasons.size == 1) "temporada" else "temporadas"}",
                            "${details.episodes.size} episodios",
                            tmdb?.genres?.takeIf { it.isNotEmpty() }?.joinToString(" · "),
                            if (watchedCount > 0) "$watchedCount vistos" else null,
                        ),
                        rating = tmdb?.rating,
                    )
                    (tmdb?.overview ?: details.plot)?.takeIf(String::isNotBlank)?.let {
                        Text(it, color = tvTone(TvTone.TextSoft), fontSize = 12.sp, lineHeight = 18.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                    tmdb?.director?.let { TvDetailCredit("Dirección", it) }
                    tmdb?.cast?.takeIf { it.isNotEmpty() }?.let { TvDetailCredit("Reparto", it.joinToString(", ")) }
                    downloadMessage?.let { Text(it, color = tvTone(TvTone.Accent), fontSize = 11.sp) }
                    FlowRow(
                        modifier = Modifier.padding(top = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        resumeEpisode?.let { episode ->
                            val started = (episodeProgress[episode.id]?.positionMs ?: 0L) > 0L
                            TvButton(
                                onClick = { onPlayEpisode(episode) },
                                colors = tvPrimaryButtonColors(),
                                modifier = Modifier
                                    .focusRequester(playFocusRequester)
                                    .focusProperties { down = seasonFocusRequester }
                                    .tvDpadClick { onPlayEpisode(episode) },
                            ) {
                                Text("▶  ${if (started) "Continuar" else "Reproducir"} T${episode.season} · E${episode.episode}")
                            }
                        }
                        onToggleFavorite?.let { toggle ->
                            TvButton(onClick = toggle, modifier = Modifier.focusProperties { down = seasonFocusRequester }.tvDpadClick(toggle)) {
                                Text(if (isFavorite) "♥  Quitar de favoritos" else "♡  Añadir a favoritos")
                            }
                        }
                        onToggleEpisodesWatched?.let { toggle ->
                            val seriesWatched = details.episodes.isNotEmpty() && details.episodes.all { episodeProgress[it.id]?.completed == true }
                            TvButton(
                                onClick = { toggle(details.episodes, !seriesWatched) },
                                modifier = Modifier.focusProperties { down = seasonFocusRequester }.tvDpadClick { toggle(details.episodes, !seriesWatched) },
                            ) {
                                Text(if (seriesWatched) "Marcar serie como no vista" else "Marcar serie como vista")
                            }
                        }
                        TvTextButton(onClick = onBack, modifier = Modifier.focusProperties { down = seasonFocusRequester }.tvDpadClick(onBack)) { Text("Atrás") }
                    }
                }
            }

            // Seasons as pills; the selected one is filled amber.
            Row(verticalAlignment = Alignment.CenterVertically) {
                TvRailTitle("Temporadas", seasons.size)
                Spacer(Modifier.weight(1f))
                if (onDownloadEpisodes != null) {
                    TvButton(
                        onClick = { onDownloadEpisodes(episodes) },
                        modifier = Modifier.tvDpadClick { onDownloadEpisodes(episodes) },
                    ) { Text("Descargar temporada (${episodes.size})", fontSize = 11.sp) }
                }
                onToggleEpisodesWatched?.let { toggle ->
                    val seasonWatched = episodes.isNotEmpty() && episodes.all { episodeProgress[it.id]?.completed == true }
                    TvButton(
                        onClick = { toggle(episodes, !seasonWatched) },
                        modifier = Modifier.padding(start = 10.dp).tvDpadClick { toggle(episodes, !seasonWatched) },
                    ) { Text(if (seasonWatched) "Marcar temporada como no vista" else "Marcar temporada como vista", fontSize = 11.sp) }
                }
            }
            CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    itemsIndexed(seasons.keys.toList()) { _, season ->
                        val selected = season == selectedSeason
                        val select = { selectedSeason = season; selectedEpisodeId = 0 }
                        TvCard(
                            onClick = select,
                            modifier = Modifier
                                .height(36.dp)
                                .then(if (selected) Modifier.focusRequester(seasonFocusRequester) else Modifier)
                                .focusProperties { down = firstEpisodeFocusRequester }
                                .tvDpadClick(select),
                            shape = CardDefaults.shape(RoundedCornerShape(50)),
                            scale = CardDefaults.scale(focusedScale = 1f),
                            colors = CardDefaults.colors(
                                containerColor = if (selected) tvTone(TvTone.Accent) else tvTone(TvTone.Surface).copy(alpha = 0.9f),
                                focusedContainerColor = if (selected) tvTone(TvTone.AccentSoft) else tvTone(TvTone.Focused),
                            ),
                        ) {
                            Box(Modifier.fillMaxHeight().padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
                                val seasonEpisodes = seasons[season].orEmpty()
                                val done = seasonEpisodes.isNotEmpty() && seasonEpisodes.all { episodeProgress[it.id]?.completed == true }
                                Text(
                                    "Temporada $season${if (done) "  ✓" else ""}",
                                    color = if (selected) tvTone(TvTone.AccentInk) else tvTone(TvTone.TextSoft),
                                    fontFamily = if (selected) TvType.BodyMedium else TvType.Body,
                                    fontSize = 11.sp,
                                )
                            }
                        }
                    }
                }
            }

            // Episodes: OK plays; focus previews the episode below.
            LazyRow(
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                itemsIndexed(episodes, key = { _, episode -> episode.id }) { index, episode ->
                    val progress = episodeProgress[episode.id]
                    Column(Modifier.width(220.dp)) {
                        TvCard(
                            onClick = { onPlayEpisode(episode) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(124.dp)
                                .then(if (index == 0) Modifier.focusRequester(firstEpisodeFocusRequester) else Modifier)
                                .focusProperties { up = seasonFocusRequester }
                                .tvDpadClick(
                                    action = { onPlayEpisode(episode) },
                                    onFocusChange = { focused -> if (focused) selectedEpisodeId = episode.id },
                                ),
                            shape = CardDefaults.shape(RoundedCornerShape(12.dp)),
                            scale = CardDefaults.scale(focusedScale = 1f),
                            colors = CardDefaults.colors(
                                containerColor = tvTone(TvTone.SurfaceHigh),
                                focusedContainerColor = tvTone(TvTone.SurfaceHigh),
                            ),
                        ) {
                            Box(Modifier.fillMaxSize()) {
                                val still = episode.coverUrl?.takeIf(String::isNotBlank) ?: details.coverUrl
                                still?.let {
                                    AsyncImage(
                                        model = it,
                                        contentDescription = episode.title,
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Crop,
                                    )
                                }
                                Box(
                                    Modifier.fillMaxSize().background(
                                        Brush.verticalGradient(listOf(Color.Transparent, Color(0xD9000000))),
                                    ),
                                )
                                Text(
                                    "E${episode.episode}",
                                    modifier = Modifier
                                        .align(Alignment.TopStart)
                                        .padding(8.dp)
                                        .background(Color(0xCC09090C), RoundedCornerShape(6.dp))
                                        .padding(horizontal = 7.dp, vertical = 2.dp),
                                    color = tvTone(TvTone.Accent),
                                    fontFamily = TvType.Display,
                                    fontSize = 12.sp,
                                )
                                if (progress?.completed == true) {
                                    Text(
                                        "✓ Visto",
                                        modifier = Modifier
                                            .align(Alignment.TopEnd)
                                            .padding(8.dp)
                                            .background(tvTone(TvTone.Good).copy(alpha = 0.2f), RoundedCornerShape(6.dp))
                                            .padding(horizontal = 7.dp, vertical = 2.dp),
                                        color = tvTone(TvTone.Good),
                                        fontSize = 9.sp,
                                    )
                                }
                                Text(
                                    "▶",
                                    modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
                                    color = Color(0xFFF4EFE6),
                                    fontSize = 12.sp,
                                )
                                if (progress != null && !progress.completed && progress.positionMs > 0L) {
                                    Box(
                                        Modifier
                                            .align(Alignment.BottomStart)
                                            .fillMaxWidth(0.4f)
                                            .height(3.dp)
                                            .background(tvTone(TvTone.Accent)),
                                    )
                                }
                            }
                        }
                        Text(
                            episode.title,
                            modifier = Modifier.padding(top = 8.dp, start = 2.dp),
                            color = tvTone(TvTone.Text),
                            fontFamily = TvType.BodyMedium,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            listOfNotNull(
                                episode.duration?.takeIf(String::isNotBlank),
                                progress?.takeIf { !it.completed && it.positionMs > 0L }?.let { "Quedó en ${formatEpisodePosition(it.positionMs)}" },
                            ).joinToString(" · ").ifBlank { "Temporada ${episode.season}" },
                            modifier = Modifier.padding(start = 2.dp),
                            color = tvTone(TvTone.Muted),
                            fontSize = 9.sp,
                            maxLines = 1,
                        )
                    }
                }
            }

            // Focused-episode panel with its own secondary actions.
            selectedEpisode?.let { episode ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(tvTone(TvTone.Surface).copy(alpha = 0.85f), RoundedCornerShape(16.dp))
                        .padding(18.dp),
                    horizontalArrangement = Arrangement.spacedBy(20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        TvEyebrow("T${episode.season} · Episodio ${episode.episode}")
                        Text(episode.title, color = tvTone(TvTone.Text), fontFamily = TvType.Display, fontSize = 18.sp, maxLines = 1)
                        val progress = episodeProgress[episode.id]
                        val facts = listOfNotNull(
                            episode.duration?.takeIf(String::isNotBlank),
                            episode.rating?.takeIf { it > 0.0 }?.let { "★ ${"%.1f".format(it)}" },
                            when {
                                progress?.completed == true -> "Visto"
                                (progress?.positionMs ?: 0L) > 0L -> "Continuar desde ${formatEpisodePosition(progress!!.positionMs)}"
                                else -> "Sin empezar"
                            },
                        )
                        Text(facts.joinToString("  ·  "), color = tvTone(TvTone.Muted), fontSize = 10.sp)
                        episode.plot?.takeIf(String::isNotBlank)?.let { plot ->
                            Text(plot, color = tvTone(TvTone.TextSoft), fontSize = 11.sp, lineHeight = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.End) {
                        TvButton(
                            onClick = { onPlayEpisode(episode) },
                            colors = tvPrimaryButtonColors(),
                            modifier = Modifier.tvDpadClick { onPlayEpisode(episode) },
                        ) { Text("▶  Reproducir episodio") }
                        onToggleEpisodesWatched?.let { toggle ->
                            val watched = episodeProgress[episode.id]?.completed == true
                            TvButton(
                                onClick = { toggle(listOf(episode), !watched) },
                                modifier = Modifier.tvDpadClick { toggle(listOf(episode), !watched) },
                            ) { Text(if (watched) "Marcar como no visto" else "Marcar como visto") }
                        }
                        if (onDownloadEpisode != null) {
                            TvButton(
                                onClick = { onDownloadEpisode(episode) },
                                modifier = Modifier.tvDpadClick { onDownloadEpisode(episode) },
                            ) { Text("Descargar episodio") }
                        }
                    }
                }
            }
        }
    }
}

private fun formatEpisodePosition(positionMs: Long): String {
    val totalSeconds = positionMs / 1_000L
    return "${totalSeconds / 60}:${(totalSeconds % 60).toString().padStart(2, '0')}"
}
