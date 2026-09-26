package com.iptvnator.googletv.playlist

import java.util.Locale

/** Unique, human-readable groups/categories currently represented in Favorites. */
internal fun tvFavoriteCategoryOptions(
    favorites: List<TvSavedItem>,
    itemType: TvSavedItemType,
): List<String> = favorites.asSequence()
    .filter { it.itemType == itemType }
    .mapNotNull { it.categoryId?.trim()?.takeIf(String::isNotEmpty) }
    .distinctBy { it.lowercase(Locale.ROOT) }
    .sortedWith(String.CASE_INSENSITIVE_ORDER)
    .toList()

internal fun filterTvFavoritesByCategory(
    favorites: List<TvSavedItem>,
    categoryId: String?,
): List<TvSavedItem> = categoryId?.let { selected ->
    favorites.filter { it.categoryId?.trim()?.equals(selected, ignoreCase = true) == true }
} ?: favorites

/** Mirrors IPTVnator favorites search across each item's title and source group/category. */
internal fun filterTvFavoritesByQuery(
    favorites: List<TvSavedItem>,
    query: String,
): List<TvSavedItem> {
    val term = query.trim().lowercase(Locale.ROOT)
    if (term.isEmpty()) return favorites
    return favorites.filter { item ->
        item.title.lowercase(Locale.ROOT).contains(term) ||
            item.categoryId?.lowercase(Locale.ROOT)?.contains(term) == true
    }
}
