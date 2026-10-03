package com.iptvnator.googletv.playlist

internal fun orderTvSources(
    playlists: List<StoredPlaylist>,
    customOrder: List<String>,
    sortMode: String,
): List<StoredPlaylist> = when (sortMode) {
    "Más antiguas" -> playlists.sortedWith(
        compareBy<StoredPlaylist> { it.importedAtMs == null }
            .thenBy { it.importedAtMs },
    )
    "Nombre A-Z" -> playlists.sortedBy { it.name.lowercase() }
    "Nombre Z-A" -> playlists.sortedByDescending { it.name.lowercase() }
    "Personalizado" -> {
        val positions = customOrder.withIndex().associate { it.value to it.index }
        playlists.sortedBy { positions[it.id] ?: Int.MAX_VALUE }
    }
    else -> playlists.sortedWith(
        compareByDescending<StoredPlaylist> { it.importedAtMs != null }
            .thenByDescending { it.importedAtMs },
    )
}

internal fun sourceSortModeAfterManualMove(currentSortMode: String): String =
    if (currentSortMode == "Personalizado") currentSortMode else "Personalizado"
