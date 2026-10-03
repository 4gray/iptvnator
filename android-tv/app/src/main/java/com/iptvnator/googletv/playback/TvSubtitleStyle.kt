@file:androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])

package com.iptvnator.googletv.playback

import android.content.Context
import android.graphics.Color
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import android.util.TypedValue

/** The same small, readable subtitle preset set exposed by the desktop player. */
data class TvSubtitleStyle(
    val sizePercent: Int = 100,
    val colorArgb: Int? = null,
) {
    fun nextSize(): TvSubtitleStyle {
        val sizes = listOf(75, 100, 125, 150, 200)
        return copy(sizePercent = sizes[(sizes.indexOf(sizePercent).coerceAtLeast(0) + 1) % sizes.size])
    }

    fun nextColor(): TvSubtitleStyle {
        val colors = listOf(null, Color.WHITE, 0xFFFFE94F.toInt(), 0xFF7FDBFF.toInt())
        return copy(colorArgb = colors[(colors.indexOf(colorArgb) + 1) % colors.size])
    }

    fun sizeLabel(): String = "$sizePercent%"

    fun colorLabel(): String = when (colorArgb) {
        null -> "Predeterminado"
        Color.WHITE -> "Blanco"
        0xFFFFE94F.toInt() -> "Amarillo"
        0xFF7FDBFF.toInt() -> "Cian"
        else -> "Personalizado"
    }
}

private const val PREFS = "iptvnator_playback"
private const val SIZE_KEY = "subtitle_size_percent"
private const val COLOR_KEY = "subtitle_color_argb"

internal fun loadTvSubtitleStyle(context: Context): TvSubtitleStyle {
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return TvSubtitleStyle(
        sizePercent = preferences.getInt(SIZE_KEY, 100).let { value ->
            if (value in listOf(75, 100, 125, 150, 200)) value else 100
        },
        colorArgb = if (preferences.contains(COLOR_KEY)) preferences.getInt(COLOR_KEY, Color.WHITE) else null,
    )
}

internal fun saveTvSubtitleStyle(context: Context, style: TvSubtitleStyle) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putInt(SIZE_KEY, style.sizePercent)
        .apply {
            if (style.colorArgb == null) remove(COLOR_KEY) else putInt(COLOR_KEY, style.colorArgb)
        }
        .apply()
}

/** Applies the user preset while preserving readable outline/background defaults. */
internal fun PlayerView.applyTvSubtitleStyle(style: TvSubtitleStyle) {
    val subtitleView = getSubtitleView() ?: return
    if (style.colorArgb == null && style.sizePercent == 100) {
        subtitleView.setApplyEmbeddedStyles(true)
        subtitleView.setUserDefaultStyle()
        subtitleView.setUserDefaultTextSize()
        return
    }
    subtitleView.setApplyEmbeddedStyles(false)
    subtitleView.setFixedTextSize(
        TypedValue.COMPLEX_UNIT_SP,
        24f * style.sizePercent / 100f,
    )
    subtitleView.setStyle(
        CaptionStyleCompat(
            style.colorArgb ?: Color.WHITE,
            Color.TRANSPARENT,
            Color.TRANSPARENT,
            CaptionStyleCompat.EDGE_TYPE_OUTLINE,
            Color.BLACK,
            null,
        ),
    )
}
