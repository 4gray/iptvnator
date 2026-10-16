package com.iptvnator.googletv

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class TvCategorySortTest {
    @Test
    fun preservesProviderOrderByDefaultAndSupportsNaturalAscendingAndDescendingSorts() {
        val providerOrder = listOf("ZZ Seed", "Grupo 10", "Grupo 2", "Alpha")
        val comparator = tvChannelNameComparator(Locale.forLanguageTag("es-ES"))

        assertEquals(providerOrder, sortTvCategoryNames(providerOrder, TvCategorySortMode.SERVER, comparator))
        assertEquals(
            listOf("Alpha", "Grupo 2", "Grupo 10", "ZZ Seed"),
            sortTvCategoryNames(providerOrder, TvCategorySortMode.NAME_ASC, comparator),
        )
        assertEquals(
            listOf("ZZ Seed", "Grupo 10", "Grupo 2", "Alpha"),
            sortTvCategoryNames(providerOrder, TvCategorySortMode.NAME_DESC, comparator),
        )
    }

    @Test
    fun restoresTheOriginalPortalPreferenceValuesAndFallsBackToProviderOrder() {
        assertEquals(TvCategorySortMode.SERVER, TvCategorySortMode.restore(null))
        assertEquals(TvCategorySortMode.SERVER, TvCategorySortMode.restore("invalid"))
        assertEquals(TvCategorySortMode.SERVER, TvCategorySortMode.restore("server"))
        assertEquals(TvCategorySortMode.NAME_ASC, TvCategorySortMode.restore("name-asc"))
        assertEquals(TvCategorySortMode.NAME_DESC, TvCategorySortMode.restore("name-desc"))
    }
}
