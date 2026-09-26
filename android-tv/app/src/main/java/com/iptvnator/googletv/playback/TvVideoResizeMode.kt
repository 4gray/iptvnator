@file:androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])

package com.iptvnator.googletv.playback

import android.content.Context
import androidx.media3.ui.AspectRatioFrameLayout

/** TV-friendly equivalents of IPTVnator's aspect-ratio presets. */
enum class TvVideoResizeMode(
    val label: String,
    val media3Mode: Int,
) {
    FIT("Ajustar", AspectRatioFrameLayout.RESIZE_MODE_FIT),
    ZOOM("Zoom", AspectRatioFrameLayout.RESIZE_MODE_ZOOM),
    FILL("Rellenar", AspectRatioFrameLayout.RESIZE_MODE_FILL),
    ;

    fun next(): TvVideoResizeMode = entries[(ordinal + 1) % entries.size]

    companion object {
        private const val PREFS = "iptvnator_playback"
        private const val KEY = "video_resize_mode"

        fun load(context: Context): TvVideoResizeMode {
            val stored = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, FIT.name)
            return entries.firstOrNull { it.name == stored } ?: FIT
        }

        fun save(context: Context, mode: TvVideoResizeMode) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY, mode.name)
                .apply()
        }
    }
}
