package com.iptvnator.googletv

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class TvChannelNameSortTest {
    @Test
    fun sortsNumberRunsNaturallyAndIgnoresCaseAndAccents() {
        val names = listOf("Canal 10", "canál 2", "CANAL 1")

        assertEquals(
            listOf("CANAL 1", "canál 2", "Canal 10"),
            names.sortedWith(tvChannelNameComparator(Locale.forLanguageTag("es-ES"))),
        )
    }

    @Test
    fun comparesNumberRunsBeyondIntegerRangeWithoutParsingOverflow() {
        val names = listOf("Channel 100000000000000000000", "Channel 9", "Channel 10")

        assertEquals(
            listOf("Channel 9", "Channel 10", "Channel 100000000000000000000"),
            names.sortedWith(tvChannelNameComparator(Locale.US)),
        )
    }
}
