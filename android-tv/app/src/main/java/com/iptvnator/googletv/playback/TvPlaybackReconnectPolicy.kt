@file:androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])

package com.iptvnator.googletv.playback

import androidx.media3.exoplayer.ExoPlaybackException

internal const val TV_PLAYBACK_RECONNECT_MAX_ATTEMPTS = 6
internal const val TV_PLAYBACK_RECONNECT_STABLE_PLAYBACK_MS = 30_000L

internal fun tvPlaybackReconnectDelayMs(attempt: Int): Long {
    if (attempt !in 1..TV_PLAYBACK_RECONNECT_MAX_ATTEMPTS) return 0L
    return (2_000L * (1L shl (attempt - 1))).coerceAtMost(30_000L)
}

/** Media3 source failures map to the original's playback-origin errors. */
internal fun isRetryableTvPlaybackErrorType(errorType: Int): Boolean =
    errorType == ExoPlaybackException.TYPE_SOURCE
