package com.iptvnator.googletv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TvHomeHeroNavigationTest {
    @Test
    fun `without a source the hero keeps the add-source route`() {
        assertNull(
            homeHeroFallbackDestination(
                hasSource = false,
                hasTvChannels = false,
                hasRadio = false,
                hasVod = false,
                hasSeries = false,
            ),
        )
    }

    @Test
    fun `live TV is the first destination when the source has channels`() {
        assertEquals(
            TvSection.Live,
            homeHeroFallbackDestination(
                hasSource = true,
                hasTvChannels = true,
                hasRadio = true,
                hasVod = true,
                hasSeries = true,
            ),
        )
    }

    @Test
    fun `other populated catalogs get a relevant destination`() {
        assertEquals(TvSection.Radio, destination(hasRadio = true))
        assertEquals(TvSection.Vod, destination(hasVod = true))
        assertEquals(TvSection.Series, destination(hasSeries = true))
        assertEquals(TvSection.Sources, destination())
    }

    private fun destination(
        hasRadio: Boolean = false,
        hasVod: Boolean = false,
        hasSeries: Boolean = false,
    ) = homeHeroFallbackDestination(
        hasSource = true,
        hasTvChannels = false,
        hasRadio = hasRadio,
        hasVod = hasVod,
        hasSeries = hasSeries,
    )
}
