package com.iptvnator.googletv

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.iptvnator.googletv.playlist.TvXtreamImportProgress
import kotlinx.coroutines.delay

/** One step of the import timeline shown while a source is being added. */
internal data class TvImportStep(val key: String, val label: String)

internal val TvXtreamImportSteps = listOf(
    TvImportStep("account", "Cuenta"),
    TvImportStep("metadata", "Categorías"),
    TvImportStep("live", "Directo"),
    TvImportStep("vod", "Películas"),
    TvImportStep("series", "Series"),
)

/** Index of the active Xtream step; everything before it is complete. */
internal fun tvXtreamImportStepIndex(phase: String?): Int = when (phase) {
    null, "account" -> 0
    "metadata" -> 1
    "live" -> 2
    "vod" -> 3
    "series" -> 4
    "complete" -> TvXtreamImportSteps.size
    else -> 0
}

/**
 * Loading surface shown in place of the add-source form while an import runs,
 * modelled on the desktop workspace import overlay: source badge, title,
 * live phase, detail, progress and a stop action. The form state stays in
 * the parent composition, so a failure returns the user to their typed data.
 */
@Composable
internal fun TvImportProgressPanel(
    sourceType: TvSourceType,
    sourceName: String,
    local: Boolean,
    statusText: String,
    progress: TvXtreamImportProgress?,
    canCancel: Boolean,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = tvTone(TvTone.Accent)
    val transition = rememberInfiniteTransition(label = "tvImport")
    val pulse by transition.animateFloat(
        initialValue = 0.92f,
        targetValue = 1.06f,
        animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse),
        label = "tvImportPulse",
    )
    val sweep by transition.animateFloat(
        initialValue = -0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart),
        label = "tvImportSweep",
    )
    val cancelFocusRequester = remember { FocusRequester() }
    val rootFocusRequester = remember { FocusRequester() }
    LaunchedEffect(canCancel) {
        delay(150)
        runCatching { if (canCancel) cancelFocusRequester.requestFocus() else rootFocusRequester.requestFocus() }
    }
    val typeLabel = when (sourceType) {
        TvSourceType.XTREAM -> "Xtream"
        TvSourceType.STALKER -> "Stalker"
        TvSourceType.M3U -> "M3U"
    }
    val detail = when {
        progress?.phase == "complete" -> "Catálogo guardado en este dispositivo."
        progress != null && progress.phase in setOf("live", "vod", "series") && progress.current > 0 ->
            "Guardando el catálogo en la biblioteca local de este dispositivo."
        else -> "Esperando la respuesta del proveedor."
    }
    Column(
        modifier = modifier
            // The form stays composed underneath (so a failure keeps typed
            // data); swallow D-pad moves so focus never wanders into it.
            .onPreviewKeyEvent { event ->
                when (event.key) {
                    Key.DirectionUp, Key.DirectionDown, Key.DirectionLeft, Key.DirectionRight -> true
                    // The stop button is the only action; handle OK here so a
                    // remote press cancels even before the button's own
                    // focus target settles after the form was swapped out.
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> {
                        if (canCancel && event.type == KeyEventType.KeyUp) onCancel()
                        canCancel
                    }
                    else -> false
                }
            }
            .focusRequester(rootFocusRequester)
            .focusable()
            .fillMaxWidth()
            .heightIn(min = 320.dp)
            .padding(horizontal = 12.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .padding(top = 8.dp)
                .graphicsLayer { scaleX = pulse; scaleY = pulse }
                .drawBehind {
                    drawCircle(
                        Brush.radialGradient(listOf(accent.copy(alpha = 0.35f), Color.Transparent)),
                        radius = size.minDimension,
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            TvBrandMark(sizeDp = 52)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TvTag(if (local) "Biblioteca local" else "Fuente remota", tone = TvTone.Accent)
            TvTag(typeLabel, tone = TvTone.Muted)
        }
        Text(
            "Sincronizando «${sourceName.ifBlank { "nueva lista" }}»",
            color = tvTone(TvTone.Text),
            fontFamily = TvType.Display,
            fontSize = 22.sp,
            lineHeight = 25.sp,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            statusText,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            color = accent,
            fontFamily = TvType.BodyMedium,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
        )
        Text(detail, color = tvTone(TvTone.Muted), fontSize = 10.sp, textAlign = TextAlign.Center)

        if (sourceType == TvSourceType.XTREAM) {
            TvImportStepTracker(tvXtreamImportStepIndex(progress?.phase))
        }

        // Indeterminate amber sweep: panels do not report catalogue totals
        // up front, so the bar conveys activity while the counter shows size.
        val track = tvTone(TvTone.SurfaceTop)
        Box(
            Modifier
                .width(420.dp)
                .height(4.dp)
                .drawBehind {
                    val r = CornerRadius(size.height / 2f, size.height / 2f)
                    drawRoundRect(track, cornerRadius = r)
                    val segment = size.width * 0.35f
                    val start = (sweep * size.width).coerceIn(-segment, size.width)
                    val left = start.coerceAtLeast(0f)
                    val right = (start + segment).coerceAtMost(size.width)
                    if (right > left) {
                        drawRoundRect(
                            Brush.horizontalGradient(
                                listOf(accent.copy(alpha = 0.2f), accent, accent.copy(alpha = 0.2f)),
                                startX = left,
                                endX = right,
                            ),
                            topLeft = Offset(left, 0f),
                            size = Size(right - left, size.height),
                            cornerRadius = r,
                        )
                    }
                },
        )
        if (canCancel) {
            TvButton(
                onClick = onCancel,
                colors = tvDangerButtonColors(),
                modifier = Modifier
                    .padding(top = 6.dp)
                    .focusRequester(cancelFocusRequester)
                    .tvDpadClick(onCancel),
            ) { Text("Detener sincronización") }
        } else {
            Text(
                "Puedes seguir usando el mando cuando termine; no cierres la aplicación.",
                color = tvTone(TvTone.Faint),
                fontSize = 9.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** Horizontal step list: done steps show a check, the active one pulses. */
@Composable
private fun TvImportStepTracker(activeIndex: Int) {
    val accent = tvTone(TvTone.Accent)
    Row(
        modifier = Modifier.padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TvXtreamImportSteps.forEachIndexed { index, step ->
            val done = index < activeIndex
            val active = index == activeIndex
            Row(
                Modifier
                    .background(
                        when {
                            active -> accent.copy(alpha = 0.18f)
                            done -> tvTone(TvTone.SurfaceTop)
                            else -> Color.Transparent
                        },
                        RoundedCornerShape(50),
                    )
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .width(14.dp)
                        .height(14.dp)
                        .background(
                            when {
                                done -> tvTone(TvTone.Good)
                                active -> accent
                                else -> tvTone(TvTone.SurfaceTop)
                            },
                            RoundedCornerShape(50),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (done) "✓" else "${index + 1}",
                        color = if (done || active) tvTone(TvTone.AccentInk) else tvTone(TvTone.Muted),
                        fontSize = 7.sp,
                        lineHeight = 8.sp,
                    )
                }
                Text(
                    step.label,
                    modifier = Modifier.padding(start = 5.dp),
                    color = when {
                        active -> tvTone(TvTone.Text)
                        done -> tvTone(TvTone.TextSoft)
                        else -> tvTone(TvTone.Faint)
                    },
                    fontSize = 9.sp,
                )
            }
            if (index < TvXtreamImportSteps.lastIndex) {
                Box(
                    Modifier
                        .width(10.dp)
                        .height(1.dp)
                        .background(if (done) tvTone(TvTone.Good) else tvTone(TvTone.SurfaceTop)),
                )
            }
        }
    }
}
