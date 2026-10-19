package com.iptvnator.googletv

import android.graphics.Typeface
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Typography of the Nocturno TV system. Display text uses the condensed
 * broadcast face that every Android TV ships, which gives titles a
 * channel-ident feel; body copy stays on the regular sans for legibility.
 */
internal object TvType {
    val Display: FontFamily = FontFamily(Typeface.create("sans-serif-condensed", Typeface.BOLD))
    val DisplayMedium: FontFamily = FontFamily(Typeface.create("sans-serif-condensed", Typeface.NORMAL))
    val Body: FontFamily = FontFamily(Typeface.create("sans-serif", Typeface.NORMAL))
    val BodyMedium: FontFamily = FontFamily(Typeface.create("sans-serif-medium", Typeface.NORMAL))

    val base = TextStyle(fontFamily = Body, letterSpacing = 0.1.sp)
}

/** Small uppercase label placed above titles ("EN DIRECTO", "CONTINUAR"). */
@Composable
internal fun TvEyebrow(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = tvTone(TvTone.Accent),
) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = color,
        fontFamily = TvType.BodyMedium,
        fontSize = 8.sp,
        letterSpacing = 1.6.sp,
        maxLines = 1,
    )
}

/** Section title with the short amber rule that anchors every screen heading. */
@Composable
internal fun TvScreenTitle(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .width(4.dp)
                .height(if (eyebrow != null) 34.dp else 24.dp)
                .background(tvTone(TvTone.Accent), RoundedCornerShape(2.dp)),
        )
        androidx.compose.foundation.layout.Column(Modifier.padding(start = 10.dp)) {
            eyebrow?.let { TvEyebrow(it, color = tvTone(TvTone.Muted)) }
            Text(
                title,
                color = tvTone(TvTone.Text),
                fontFamily = TvType.Display,
                fontSize = 24.sp,
                lineHeight = 26.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Pill used for metadata ("M3U", "EPG", counts) with a quiet outline. */
@Composable
internal fun TvTag(
    text: String,
    modifier: Modifier = Modifier,
    tone: TvTone = TvTone.Muted,
    filled: Boolean = false,
) {
    val color = tvTone(tone)
    Box(
        modifier = modifier
            .then(
                if (filled) {
                    Modifier.background(color, RoundedCornerShape(50))
                } else {
                    Modifier.background(color.copy(alpha = 0.12f), RoundedCornerShape(50))
                },
            )
            .padding(horizontal = 7.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (filled) tvTone(TvTone.AccentInk) else color,
            fontFamily = TvType.BodyMedium,
            fontSize = 8.sp,
            lineHeight = 10.sp,
            letterSpacing = 0.6.sp,
            maxLines = 1,
        )
    }
}

/** Pulsing-dot style "EN DIRECTO" badge. */
@Composable
internal fun TvLiveBadge(modifier: Modifier = Modifier, label: String = "EN DIRECTO") {
    val live = tvTone(TvTone.Live)
    Row(
        modifier = modifier
            .background(live.copy(alpha = 0.16f), RoundedCornerShape(50))
            .padding(horizontal = 7.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(5.dp).height(5.dp).background(live, RoundedCornerShape(50)))
        Text(
            label,
            modifier = Modifier.padding(start = 5.dp),
            color = live,
            fontFamily = TvType.BodyMedium,
            fontSize = 7.sp,
            lineHeight = 9.sp,
            letterSpacing = 1.2.sp,
        )
    }
}

/**
 * The app backdrop: warm ink with a faint amber sunrise in the top-left and a
 * cool dusk in the bottom-right, so large empty areas never read as flat grey.
 */
internal fun Modifier.tvBackdrop(isLight: Boolean): Modifier = drawBehind {
    val canvas = TvTone.Canvas.resolve(isLight)
    drawRect(canvas)
    val warm = if (isLight) Color(0x33FFC46B) else Color(0x24FF9E2C)
    val cool = if (isLight) Color(0x1A6B8CFF) else Color(0x1A3D5AFE)
    drawRect(
        Brush.radialGradient(
            colors = listOf(warm, Color.Transparent),
            center = Offset(size.width * 0.12f, -size.height * 0.1f),
            radius = size.maxDimension * 0.62f,
        ),
    )
    drawRect(
        Brush.radialGradient(
            colors = listOf(cool, Color.Transparent),
            center = Offset(size.width * 1.02f, size.height * 1.08f),
            radius = size.maxDimension * 0.55f,
        ),
    )
}

/** Draws a thin progress track with an amber fill; used by resume rails. */
internal fun Modifier.tvProgressTrack(fraction: Float, track: Color, fill: Color): Modifier = drawBehind {
    val radius = CornerRadius(size.height / 2f, size.height / 2f)
    drawRoundRect(track, cornerRadius = radius)
    val clamped = fraction.coerceIn(0f, 1f)
    if (clamped > 0f) {
        drawRoundRect(fill, size = Size(size.width * clamped, size.height), cornerRadius = radius)
    }
}

/** Outline-only rounded rectangle helper for glyph-like decorations. */
internal fun Modifier.tvHairline(color: Color, radiusDp: Float = 12f): Modifier = drawBehind {
    val r = radiusDp.dp.toPx()
    drawRoundRect(color, cornerRadius = CornerRadius(r, r), style = Stroke(1.dp.toPx()))
}

internal val TvFontWeightStrong = FontWeight.SemiBold

/**
 * Segmented pill control ("Servidor | A-Z | Z-A"). Each segment is its own
 * D-pad target; the selected one is filled amber so the state reads from
 * across the room even while focus is elsewhere.
 */
@Composable
internal fun TvSegmented(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    segmentWidth: androidx.compose.ui.unit.Dp = 88.dp,
    firstFocusRequester: androidx.compose.ui.focus.FocusRequester? = null,
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        label?.let {
            TvEyebrow(it, modifier = Modifier.padding(end = 10.dp), color = tvTone(TvTone.Muted))
        }
        androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
            Row(
                modifier = Modifier
                    .background(tvTone(TvTone.Surface).copy(alpha = 0.9f), RoundedCornerShape(50))
                    .padding(3.dp),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(2.dp),
            ) {
                options.forEachIndexed { index, option ->
                    val selected = index == selectedIndex
                    TvCard(
                        onClick = { onSelect(index) },
                        modifier = Modifier
                            .width(segmentWidth)
                            .height(28.dp)
                            .then(
                                if (index == 0 && firstFocusRequester != null) {
                                    Modifier.focusRequester(firstFocusRequester)
                                } else Modifier,
                            )
                            .tvDpadClick { onSelect(index) },
                        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
                        scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
                        colors = androidx.tv.material3.CardDefaults.colors(
                            containerColor = if (selected) tvTone(TvTone.Accent) else Color.Transparent,
                            focusedContainerColor = if (selected) tvTone(TvTone.AccentSoft) else tvTone(TvTone.Focused),
                        ),
                    ) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                option,
                                color = if (selected) tvTone(TvTone.AccentInk) else tvTone(TvTone.TextSoft),
                                fontFamily = if (selected) TvType.BodyMedium else TvType.Body,
                                fontSize = 10.sp,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** On/off pill with a status dot, used for panel visibility toggles. */
@Composable
internal fun TvToggleChip(
    label: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
        TvCard(
            onClick = onClick,
            modifier = modifier.height(34.dp).tvDpadClick(onClick),
            shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
            scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
            colors = androidx.tv.material3.CardDefaults.colors(
                containerColor = tvTone(TvTone.Surface).copy(alpha = 0.9f),
                focusedContainerColor = tvTone(TvTone.Focused),
            ),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 13.dp).height(34.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .width(7.dp)
                        .height(7.dp)
                        .background(
                            if (active) tvTone(TvTone.Accent) else Color.Transparent,
                            RoundedCornerShape(50),
                        )
                        .tvHairline(if (active) tvTone(TvTone.Accent) else tvTone(TvTone.Faint), 4f),
                )
                Text(
                    label,
                    modifier = Modifier.padding(start = 7.dp),
                    color = if (active) tvTone(TvTone.Text) else tvTone(TvTone.Muted),
                    fontSize = 10.sp,
                    maxLines = 1,
                )
            }
        }
    }
}

/** Compact secondary action pill for side rails ("Gestionar", "Categorías"). */
@Composable
internal fun TvRailPill(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    androidx.compose.runtime.CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
        TvCard(
            onClick = onClick,
            modifier = modifier.height(28.dp).tvDpadClick(onClick),
            shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(50)),
            scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
            colors = androidx.tv.material3.CardDefaults.colors(
                containerColor = tvTone(TvTone.Surface).copy(alpha = 0.9f),
                focusedContainerColor = tvTone(TvTone.Focused),
            ),
        ) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(label, color = tvTone(TvTone.TextSoft), fontSize = 9.sp, maxLines = 1)
            }
        }
    }
}

/**
 * Idle "screen" shown where playback will appear: a framed 16:9 surface with
 * the brand mark, a message and the remote keys that matter on this screen.
 */
@Composable
internal fun TvPlayerStandby(
    message: String,
    modifier: Modifier = Modifier,
    hints: List<Pair<String, String>> = listOf("OK" to "Reproducir", "▲▼" to "Recorrer", "0-9" to "Nº de canal"),
) {
    val accent = tvTone(TvTone.Accent)
    androidx.compose.foundation.layout.Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .androidxAspect()
                .background(
                    Brush.verticalGradient(listOf(tvTone(TvTone.Surface), tvTone(TvTone.Deep))),
                    RoundedCornerShape(14.dp),
                )
                .tvHairline(tvTone(TvTone.SurfaceTop), 14f)
                .drawBehind {
                    drawRect(
                        Brush.radialGradient(
                            listOf(accent.copy(alpha = 0.14f), Color.Transparent),
                            center = Offset(size.width / 2f, size.height / 2f),
                            radius = size.minDimension * 0.8f,
                        ),
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
                TvBrandMark(sizeDp = 44)
                Text(
                    message,
                    modifier = Modifier.padding(top = 14.dp, start = 24.dp, end = 24.dp),
                    color = tvTone(TvTone.TextSoft),
                    fontSize = 12.sp,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        if (hints.isNotEmpty()) {
            Row(
                modifier = Modifier.padding(top = 14.dp),
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                hints.forEach { (key, action) -> TvKeyHint(key, action) }
            }
        }
    }
}

/** A remote key cap followed by what it does. */
@Composable
internal fun TvKeyHint(key: String, action: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .background(tvTone(TvTone.SurfaceTop), RoundedCornerShape(6.dp))
                .padding(horizontal = 6.dp, vertical = 2.dp),
        ) {
            Text(key, color = tvTone(TvTone.Text), fontFamily = TvType.BodyMedium, fontSize = 8.sp, lineHeight = 10.sp)
        }
        Text(action, modifier = Modifier.padding(start = 6.dp), color = tvTone(TvTone.Muted), fontSize = 9.sp)
    }
}

private fun Modifier.androidxAspect(): Modifier = this.aspectRatio(16f / 9f)

/** Trailing rail tile that opens the full section ("Ver todo"). */
@Composable
internal fun TvSeeAllTile(
    onClick: () -> Unit,
    width: androidx.compose.ui.unit.Dp,
    height: androidx.compose.ui.unit.Dp,
) {
    var focused by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    TvCard(
        onClick = onClick,
        modifier = Modifier.width(width).height(height).tvDpadClick(onClick, { focused = it }),
        shape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(12.dp)),
        scale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
        colors = androidx.tv.material3.CardDefaults.colors(
            containerColor = tvTone(TvTone.Surface).copy(alpha = 0.6f),
            focusedContainerColor = tvTone(TvTone.Focused),
        ),
    ) {
        androidx.compose.foundation.layout.Column(
            Modifier.fillMaxSize().tvHairline(tvTone(TvTone.SurfaceTop)),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .width(32.dp)
                    .height(32.dp)
                    .background(if (focused) tvTone(TvTone.Accent) else tvTone(TvTone.Accent).copy(alpha = 0.16f), RoundedCornerShape(50)),
                contentAlignment = Alignment.Center,
            ) {
                Text("›", color = if (focused) tvTone(TvTone.AccentInk) else tvTone(TvTone.Accent), fontSize = 18.sp, lineHeight = 18.sp)
            }
            Text(
                "Ver todo",
                modifier = Modifier.padding(top = 8.dp),
                color = tvTone(TvTone.Text),
                fontFamily = TvType.BodyMedium,
                fontSize = 11.sp,
            )
        }
    }
}
