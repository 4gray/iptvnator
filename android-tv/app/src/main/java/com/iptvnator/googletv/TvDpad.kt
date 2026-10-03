package com.iptvnator.googletv

import android.view.KeyEvent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.composed
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.zIndex

/** Makes the select button reliable across Google TV remotes and emulator keymaps. */
fun Modifier.tvDpadClick(action: () -> Unit): Modifier = tvDpadClick(action, null)

fun Modifier.tvDpadClick(action: () -> Unit, onFocusChange: ((Boolean) -> Unit)?): Modifier =
    composed {
        val currentAction by rememberUpdatedState(action)
        this.tvDpadFocus(onFocusChange)
            .focusable()
            .clickable(onClick = { currentAction() })
            .onKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown &&
                    isInitialTvSelect(event.nativeKeyEvent.keyCode, event.nativeKeyEvent.repeatCount)
                ) {
                    currentAction()
                    true
                } else {
                    false
                }
            }
    }

/**
 * Nocturno focus treatment: an amber ring drawn inside the bounds (so list
 * clipping never cuts it), a warm tint, a soft amber halo and a gentle lift
 * for compact targets. Wide rows do not scale, which keeps them inside their
 * lazy containers.
 */
/**
 * Focus target of the navigation rail. Leftmost content (the first card of a
 * rail, the Home hero) sends D-pad LEFT here explicitly because geometric
 * search would otherwise climb to a wider element above it.
 */
internal val LocalTvNavRailFocus = androidx.compose.runtime.staticCompositionLocalOf<androidx.compose.ui.focus.FocusRequester?> { null }

/** Corner radius of the focus ring; clamped to half the target height so pills stay round. */
internal val LocalTvFocusRadius = androidx.compose.runtime.staticCompositionLocalOf { 12.dp }

fun Modifier.tvDpadFocus(onFocusChange: ((Boolean) -> Unit)? = null): Modifier = composed {
    var focused by remember { mutableStateOf(false) }
    val focusRadius = LocalTvFocusRadius.current
    val isLight = LocalTvLightTheme.current
    val accent = TvTone.Accent.resolve(isLight)
    val progress by animateFloatAsState(
        targetValue = if (focused) 1f else 0f,
        animationSpec = tween(durationMillis = 140),
        label = "tvFocus",
    )
    this
        .onFocusChanged {
            focused = it.isFocused
            onFocusChange?.invoke(it.isFocused)
        }
        .zIndex(if (focused) 1f else 0f)
        .graphicsLayer {
            val widthDp = size.width / density
            val lift = if (widthDp in 1f..320f) 0.045f else if (widthDp in 320f..520f) 0.012f else 0f
            val scale = 1f + lift * progress
            scaleX = scale
            scaleY = scale
        }
        .drawBehind {
            if (progress > 0f) {
                val radius = if (size.height <= 44.dp.toPx()) size.height / 2f else minOf(focusRadius.toPx(), size.height / 2f)
                // Soft amber halo painted as concentric translucent rings.
                // Unlike an elevation shadow it never shows through
                // translucent containers.
                val steps = 4
                for (step in steps downTo 1) {
                    val spread = step * 3.dp.toPx()
                    drawRoundRect(
                        color = accent.copy(alpha = 0.045f * progress),
                        topLeft = androidx.compose.ui.geometry.Offset(-spread, -spread),
                        size = androidx.compose.ui.geometry.Size(size.width + spread * 2, size.height + spread * 2),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius + spread, radius + spread),
                    )
                }
                drawRoundRect(
                    color = accent.copy(alpha = 0.10f * progress),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius, radius),
                )
            }
        }
        .drawWithContent {
            drawContent()
            if (progress > 0f) {
                val stroke = 3.dp.toPx()
                val inset = stroke / 2f
                val radius = (if (size.height <= 44.dp.toPx()) size.height / 2f else minOf(focusRadius.toPx(), size.height / 2f)) - inset
                drawRoundRect(
                    color = accent.copy(alpha = progress),
                    topLeft = androidx.compose.ui.geometry.Offset(inset, inset),
                    size = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius, radius),
                    style = Stroke(width = stroke),
                )
            }
        }
}

internal fun isInitialTvSelect(keyCode: Int, repeatCount: Int): Boolean =
    repeatCount == 0 && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)

internal fun isTvSelectKey(keyCode: Int): Boolean =
    keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER
