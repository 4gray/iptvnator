package com.iptvnator.googletv

internal enum class TvCategorySortMode(
    val preferenceValue: String,
    val menuLabel: String,
    val buttonLabel: String,
) {
    SERVER("server", "Orden del proveedor", "Srv"),
    NAME_ASC("name-asc", "Nombre A-Z", "A-Z"),
    NAME_DESC("name-desc", "Nombre Z-A", "Z-A");

    companion object {
        fun restore(value: String?): TvCategorySortMode =
            entries.firstOrNull { it.preferenceValue == value } ?: SERVER
    }
}

internal const val TV_CATEGORY_SORT_PREFERENCE_KEY = "workspace-category-sort-mode"

/** Keeps the provider's category order by default, like IPTVnator's category rail. */
internal fun sortTvCategoryNames(
    groups: List<String>,
    mode: TvCategorySortMode,
    nameComparator: Comparator<String>,
): List<String> = when (mode) {
    TvCategorySortMode.SERVER -> groups.toList()
    TvCategorySortMode.NAME_ASC -> groups.sortedWith(nameComparator)
    TvCategorySortMode.NAME_DESC -> groups.sortedWith(nameComparator.reversed())
}
