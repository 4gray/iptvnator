package com.iptvnator.googletv.playlist

import org.junit.Assert.assertEquals
import org.junit.Test

class TvFavoriteCategoriesTest {
    private fun item(key: String, type: TvSavedItemType, category: String?) = TvSavedItem(
        playlistId = "source",
        itemType = type,
        itemKey = key,
        title = key,
        uri = "https://example.invalid/$key",
        coverUrl = null,
        savedAt = 1L,
        lastPlayedAt = null,
        categoryId = category,
    )

    @Test
    fun `category options are scoped to type and deduplicated ignoring case`() {
        val items = listOf(
            item("one", TvSavedItemType.CHANNEL, "Noticias"),
            item("two", TvSavedItemType.CHANNEL, " deportes "),
            item("three", TvSavedItemType.CHANNEL, "NOTICIAS"),
            item("movie", TvSavedItemType.VOD, "Cine"),
            item("ungrouped", TvSavedItemType.CHANNEL, null),
        )

        assertEquals(
            listOf("deportes", "Noticias"),
            tvFavoriteCategoryOptions(items, TvSavedItemType.CHANNEL),
        )
        assertEquals(
            listOf("Cine"),
            tvFavoriteCategoryOptions(items, TvSavedItemType.VOD),
        )
    }

    @Test
    fun `category filter preserves all favorites when unselected and matches case-insensitively`() {
        val items = listOf(
            item("one", TvSavedItemType.CHANNEL, "Noticias"),
            item("two", TvSavedItemType.CHANNEL, "Deportes"),
            item("three", TvSavedItemType.CHANNEL, null),
        )

        assertEquals(items, filterTvFavoritesByCategory(items, null))
        assertEquals(
            listOf("one"),
            filterTvFavoritesByCategory(items, "NOTICIAS").map(TvSavedItem::itemKey),
        )
    }

    @Test
    fun `query matches favorite titles or categories and ignores blank input`() {
        val items = listOf(
            item("news", TvSavedItemType.CHANNEL, "Noticias").copy(title = "Canal local"),
            item("sports", TvSavedItemType.CHANNEL, "Deportes").copy(title = "Liga 24/7"),
        )

        assertEquals(items, filterTvFavoritesByQuery(items, "  "))
        assertEquals(
            listOf("news"),
            filterTvFavoritesByQuery(items, "NOTICIAS").map(TvSavedItem::itemKey),
        )
        assertEquals(
            listOf("sports"),
            filterTvFavoritesByQuery(items, "liga").map(TvSavedItem::itemKey),
        )
        assertEquals(emptyList<TvSavedItem>(), filterTvFavoritesByQuery(items, "https://example.invalid/news"))
    }
}
