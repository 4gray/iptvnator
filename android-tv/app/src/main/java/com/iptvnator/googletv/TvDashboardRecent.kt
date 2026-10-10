package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.TvSavedItem
import com.iptvnator.googletv.playlist.TvSavedItemType

/** The original Home keeps recently watched live channels separate from VOD/series history. */
internal fun tvDashboardRecentLiveHistory(history: List<TvSavedItem>): List<TvSavedItem> =
    history.filter { it.itemType == TvSavedItemType.CHANNEL }
