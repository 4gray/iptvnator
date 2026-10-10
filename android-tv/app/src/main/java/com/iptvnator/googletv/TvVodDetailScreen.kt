package com.iptvnator.googletv

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.iptvnator.googletv.playlist.TvVodItem
import com.iptvnator.googletv.tmdb.TmdbDetails
import com.iptvnator.googletv.xtream.XtreamVodDetails
import kotlinx.coroutines.delay

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun TvVodDetailScreen(
    item: TvVodItem,
    tmdb: TmdbDetails?,
    providerDetails: XtreamVodDetails? = null,
    onBack: () -> Unit,
    onPlay: () -> Unit,
    onTrailer: (() -> Unit)? = null,
    onDownload: (() -> Unit)? = null,
    onCancelDownload: (() -> Unit)? = null,
    isFavorite: Boolean = false,
    onToggleFavorite: (() -> Unit)? = null,
    isWatched: Boolean = false,
    onToggleWatched: (() -> Unit)? = null,
    downloadMessage: String? = null,
) {
    val playFocusRequester = remember(item.id) { FocusRequester() }
    LaunchedEffect(item.id) {
        delay(100)
        playFocusRequester.requestFocus()
    }
    BackHandler(onBack = onBack)
    val poster = item.coverUrl?.takeIf(String::isNotBlank)
        ?: tmdb?.posterPath?.let { "https://image.tmdb.org/t/p/w500$it" }
    val backdrop = tmdb?.backdropPath?.let { "https://image.tmdb.org/t/p/w1280$it" }
        ?: providerDetails?.backdropUrl?.takeIf { it.isNotBlank() && it != item.coverUrl }
    val year = (tmdb?.releaseDate ?: providerDetails?.releaseDate)?.takeIf { it.isNotBlank() }?.take(4)
    val genres = tmdb?.genres?.takeIf { it.isNotEmpty() }?.joinToString(" · ")
        ?: providerDetails?.genre?.takeIf(String::isNotBlank)
    val director = tmdb?.director ?: providerDetails?.director?.takeIf(String::isNotBlank)
    val cast = tmdb?.cast?.takeIf { it.isNotEmpty() }?.joinToString(", ")
        ?: providerDetails?.actors?.takeIf(String::isNotBlank)
    val overview = tmdb?.overview ?: providerDetails?.plot ?: providerDetails?.description

    TvDetailBackdrop(backdropUrl = backdrop, posterUrl = poster) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 56.dp, vertical = 44.dp),
            horizontalArrangement = Arrangement.spacedBy(36.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TvDetailPoster(poster, tmdb?.title ?: item.name, Modifier.width(200.dp).height(300.dp))
            Column(
                modifier = Modifier.widthIn(max = 620.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TvEyebrow("Película")
                    item.categoryId?.takeIf(String::isNotBlank)?.let {
                        TvEyebrow("  ·  $it", color = tvTone(TvTone.Muted))
                    }
                }
                Text(
                    tmdb?.title ?: item.name,
                    color = tvTone(TvTone.Text),
                    fontFamily = TvType.Display,
                    fontSize = 38.sp,
                    lineHeight = 40.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                TvDetailFacts(
                    listOfNotNull(
                        year,
                        providerDetails?.duration?.takeIf(String::isNotBlank),
                        genres,
                        if (isWatched) "Vista" else null,
                    ),
                    rating = tmdb?.rating ?: providerDetails?.rating ?: item.rating,
                )
                overview?.takeIf(String::isNotBlank)?.let {
                    Text(
                        it,
                        color = tvTone(TvTone.TextSoft),
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                        maxLines = 5,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                director?.let { TvDetailCredit("Dirección", it) }
                cast?.let { TvDetailCredit("Reparto", it) }
                tmdb?.similar?.takeIf { it.isNotEmpty() }?.let { similar ->
                    TvDetailCredit("Similares", similar.take(6).joinToString(" · ") { it.title })
                }
                downloadMessage?.let {
                    Text(it, color = tvTone(TvTone.Accent), fontSize = 11.sp)
                }
                androidx.compose.foundation.layout.FlowRow(
                    modifier = Modifier.padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    TvButton(
                        onClick = onPlay,
                        colors = tvPrimaryButtonColors(),
                        modifier = Modifier.focusRequester(playFocusRequester).tvDpadClick(onPlay),
                    ) { Text("▶  Reproducir") }
                    if (tmdb?.trailerKey != null && onTrailer != null) {
                        TvButton(onClick = onTrailer, modifier = Modifier.tvDpadClick(onTrailer)) { Text("Ver tráiler") }
                    }
                    onToggleFavorite?.let { toggle ->
                        TvButton(onClick = toggle, modifier = Modifier.tvDpadClick(toggle)) {
                            Text(if (isFavorite) "♥  Quitar de favoritos" else "♡  Añadir a favoritos")
                        }
                    }
                    onToggleWatched?.let { toggle ->
                        TvButton(onClick = toggle, modifier = Modifier.tvDpadClick(toggle)) {
                            Text(if (isWatched) "Marcar como no visto" else "Marcar como visto")
                        }
                    }
                    onDownload?.let { download -> TvButton(onClick = download, modifier = Modifier.tvDpadClick(download)) { Text("Descargar") } }
                    onCancelDownload?.let { cancel -> TvButton(onClick = cancel, modifier = Modifier.tvDpadClick(cancel)) { Text("Cancelar descarga") } }
                    TvTextButton(onClick = onBack, modifier = Modifier.tvDpadClick(onBack)) { Text("Atrás") }
                }
            }
        }
    }
}
