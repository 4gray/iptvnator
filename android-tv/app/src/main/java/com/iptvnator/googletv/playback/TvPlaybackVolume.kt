package com.iptvnator.googletv.playback

internal const val TV_PLAYER_VOLUME_PREFERENCE_KEY = "volume"

internal fun normalizeTvPlayerVolume(volume: Float): Float =
    if (volume.isFinite()) volume.coerceIn(0f, 1f) else 1f
