package com.iptvnator.googletv.playback

internal fun shouldAutoAdvanceEpisode(
    autoPlayEnabled: Boolean,
    isLive: Boolean,
    isAudio: Boolean,
    hasNextEpisode: Boolean,
): Boolean = autoPlayEnabled && !isLive && !isAudio && hasNextEpisode
