package com.iptvnator.googletv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

/**
 * Full-screen detail backdrop: the backdrop (or the poster, enlarged and
 * blurred) sits on the right and fades into the ink canvas towards the text
 * column, so every title gets a cinematic stage even without TMDB artwork.
 */
@Composable
internal fun TvDetailBackdrop(
    backdropUrl: String?,
    posterUrl: String?,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val canvas = tvTone(TvTone.Canvas)
    val accent = tvTone(TvTone.Accent)
    Box(modifier.fillMaxSize().background(canvas)) {
        val image = backdropUrl?.takeIf(String::isNotBlank) ?: posterUrl?.takeIf(String::isNotBlank)
        if (image != null) {
            val isPosterFallback = backdropUrl.isNullOrBlank()
            AsyncImage(
                model = image,
                contentDescription = null,
                modifier = Modifier
                    .fillMaxSize()
                    .then(
                        if (isPosterFallback) {
                            Modifier
                                .graphicsLayer { scaleX = 1.3f; scaleY = 1.3f; alpha = 0.6f }
                                .blur(36.dp)
                        } else {
                            Modifier.graphicsLayer { alpha = 0.75f }
                        },
                    ),
                contentScale = ContentScale.Crop,
            )
        }
        Box(
            Modifier.fillMaxSize().background(
                Brush.horizontalGradient(
                    0f to canvas,
                    0.42f to canvas.copy(alpha = 0.92f),
                    0.75f to canvas.copy(alpha = 0.55f),
                    1f to canvas.copy(alpha = 0.3f),
                ),
            ),
        )
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0.55f to Color.Transparent,
                    1f to canvas,
                ),
            ),
        )
        Box(
            Modifier.fillMaxSize().background(
                Brush.radialGradient(
                    listOf(accent.copy(alpha = 0.12f), Color.Transparent),
                    center = androidx.compose.ui.geometry.Offset(0f, 0f),
                    radius = 1100f,
                ),
            ),
        )
        content()
    }
}

/** Poster with rounded corners and a hairline; falls back to a typographic slab. */
@Composable
internal fun TvDetailPoster(url: String?, title: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(
                Brush.verticalGradient(listOf(tvTone(TvTone.SurfaceTop), tvTone(TvTone.Deep))),
            )
            .tvHairline(tvTone(TvTone.SurfaceTop), 14f),
        contentAlignment = Alignment.Center,
    ) {
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = url,
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text(
                title,
                modifier = Modifier.padding(16.dp),
                color = tvTone(TvTone.Text),
                fontFamily = TvType.Display,
                fontSize = 20.sp,
            )
        }
    }
}

/** Row of metadata facts: plain facts as quiet tags, a rating in gold. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TvDetailFacts(facts: List<String>, rating: Double? = null, modifier: Modifier = Modifier) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        rating?.takeIf { it > 0.0 }?.let {
            Row(
                Modifier
                    .background(tvTone(TvTone.Warn).copy(alpha = 0.14f), RoundedCornerShape(50))
                    .padding(horizontal = 9.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("★ ${"%.1f".format(it)}", color = tvTone(TvTone.Warn), fontFamily = TvType.BodyMedium, fontSize = 10.sp)
            }
        }
        facts.filter(String::isNotBlank).forEach { fact ->
            Box(
                Modifier
                    .background(tvTone(TvTone.Text).copy(alpha = 0.08f), RoundedCornerShape(50))
                    .padding(horizontal = 9.dp, vertical = 3.dp),
            ) {
                Text(fact, color = tvTone(TvTone.TextSoft), fontSize = 10.sp, maxLines = 1)
            }
        }
    }
}

/** "Label  value" credit line (Dirección, Reparto). */
@Composable
internal fun TvDetailCredit(label: String, value: String) {
    Row {
        Text(label.uppercase(), color = tvTone(TvTone.Muted), fontFamily = TvType.BodyMedium, fontSize = 8.sp, letterSpacing = 1.4.sp, modifier = Modifier.padding(top = 2.dp))
        Text(value, modifier = Modifier.padding(start = 10.dp), color = tvTone(TvTone.TextSoft), fontSize = 11.sp, maxLines = 2)
    }
}
