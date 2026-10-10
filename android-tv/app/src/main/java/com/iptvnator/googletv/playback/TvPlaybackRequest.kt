package com.iptvnator.googletv.playback

import com.iptvnator.googletv.TvDrmConfig

/**
 * Platform-neutral playback input. Provider adapters can create this without
 * knowing whether the source is rendered by Media3, the web client, or the
 * desktop player.
 */
data class TvPlaybackRequest(
    val uri: String,
    val title: String,
    val userAgent: String? = null,
    val headers: Map<String, String> = emptyMap(),
    val mimeType: String? = null,
    val startPositionMs: Long = 0L,
    val isLive: Boolean = true,
    val isAudio: Boolean = false,
    val drm: TvDrmConfig? = null,
)
