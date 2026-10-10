package com.iptvnator.googletv.playlist

import android.content.SharedPreferences

/**
 * Matches IPTVnator's per-view `collection-scope-{favorites|recent}` setting.
 * Scope is intentionally independent of the currently selected playlist.
 */
internal enum class TvCollectionScopeView(val viewKey: String) {
    FAVORITES("favorites"),
    RECENT("recent"),
}

private fun TvCollectionScopeView.preferenceKey(): String = "collection-scope-$viewKey"

internal fun loadTvCollectionScopeIsAll(
    preferences: SharedPreferences,
    view: TvCollectionScopeView,
): Boolean = preferences.getString(view.preferenceKey(), "playlist") == "all"

internal fun saveTvCollectionScopeIsAll(
    preferences: SharedPreferences,
    view: TvCollectionScopeView,
    allPlaylists: Boolean,
) {
    val key = view.preferenceKey()
    preferences.edit()
        .putString(key, if (allPlaylists) "all" else "playlist")
        .apply()
}
