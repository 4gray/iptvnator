package com.iptvnator.googletv

import org.junit.Assert.assertEquals
import org.junit.Test

class TvChannelNameTest {
    @Test
    fun `strips original country tag forms`() {
        assertEquals("CNN", stripTvCountryPrefix("US | CNN"))
        assertEquals("BBC One", stripTvCountryPrefix("UK - BBC One"))
        assertEquals("TF1", stripTvCountryPrefix("FR|TF1"))
        assertEquals("ARD", stripTvCountryPrefix("|DE| ARD"))
        assertEquals("CNN", stripTvCountryPrefix("US East | CNN"))
        assertEquals("News", stripTvCountryPrefix("EXYU| News"))
        assertEquals("Movies", stripTvCountryPrefix("MULTI| Movies"))
        assertEquals("CNN", stripTvCountryPrefix("US: CNN"))
        assertEquals("The Last of Us", stripTvCountryPrefix("4K-OSN+ - The Last of Us"))
    }

    @Test
    fun `does not strip ordinary names that only contain separators`() {
        assertEquals("Sky - Sports F1", stripTvCountryPrefix("Sky - Sports F1"))
        assertEquals("DUNE - Part Two", stripTvCountryPrefix("DUNE - Part Two"))
        assertEquals("World", stripTvCountryPrefix("News | World"))
    }

    @Test
    fun `disabled preference preserves provider name`() {
        assertEquals("US | CNN", displayTvChannelName("US | CNN", false))
        assertEquals("CNN", displayTvChannelName("US | CNN", true))
    }
}
