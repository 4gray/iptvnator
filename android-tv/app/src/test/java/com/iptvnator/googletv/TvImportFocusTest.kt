package com.iptvnator.googletv

import org.junit.Assert.assertEquals
import org.junit.Test

class TvImportFocusTest {
    @Test
    fun `connection sources keep playlist name first in dpad order`() {
        assertEquals(
            TvImportField.Name,
            firstTvImportField(TvSourceType.XTREAM, TvImportSourceOption.XTREAM),
        )
        assertEquals(
            TvImportField.Name,
            firstTvImportField(TvSourceType.STALKER, TvImportSourceOption.STALKER),
        )
    }

    @Test
    fun `m3u url enters its url field while text imports enter their name`() {
        assertEquals(
            TvImportField.Server,
            firstTvImportField(TvSourceType.M3U, TvImportSourceOption.M3U_URL),
        )
        assertEquals(
            TvImportField.Name,
            firstTvImportField(TvSourceType.M3U, TvImportSourceOption.RAW_M3U),
        )
        assertEquals(
            TvImportField.Name,
            firstTvImportField(TvSourceType.M3U, TvImportSourceOption.AUTO_DETECT),
        )
    }

    @Test
    fun `connection forms continue from name to server`() {
        assertEquals(TvImportField.Server, connectionImportNameDownField(TvSourceType.XTREAM))
        assertEquals(TvImportField.Server, connectionImportNameDownField(TvSourceType.STALKER))
        assertEquals(TvImportField.Connect, connectionImportNameDownField(TvSourceType.M3U))
    }
}
