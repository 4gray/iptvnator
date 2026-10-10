package com.iptvnator.googletv

import org.junit.Assert.assertEquals
import org.junit.Test

class TvPosterRailTest {
    @Test
    fun `poster size preference has safe medium fallback`() {
        assertEquals(TvPosterSize.SMALL, tvPosterSizeFromPreference("small"))
        assertEquals(TvPosterSize.MEDIUM, tvPosterSizeFromPreference("medium"))
        assertEquals(TvPosterSize.LARGE, tvPosterSizeFromPreference("large"))
        assertEquals(TvPosterSize.MEDIUM, tvPosterSizeFromPreference("unknown"))
        assertEquals(TvPosterSize.MEDIUM, tvPosterSizeFromPreference(null))
    }
}
