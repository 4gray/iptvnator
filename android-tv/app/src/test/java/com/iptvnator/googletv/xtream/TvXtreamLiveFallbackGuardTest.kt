package com.iptvnator.googletv.xtream

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvXtreamLiveFallbackGuardTest {
    @Test
    fun `fallback remains valid for the same channel and failed request`() {
        assertTrue(
            xtreamLiveFallbackStillApplies(
                expectedChannelKey = "playlist:channel-1",
                expectedSourceUri = "https://provider.example/live/1.m3u8",
                activeChannelKey = "playlist:channel-1",
                activeRequestUri = "https://provider.example/live/1.m3u8",
            ),
        )
    }

    @Test
    fun `channel switch invalidates a delayed fallback`() {
        assertFalse(
            xtreamLiveFallbackStillApplies(
                expectedChannelKey = "playlist:channel-1",
                expectedSourceUri = "https://provider.example/live/1.m3u8",
                activeChannelKey = "playlist:channel-2",
                activeRequestUri = "https://provider.example/live/2.m3u8",
            ),
        )
    }

    @Test
    fun `replaced stream for the same channel invalidates a delayed fallback`() {
        assertFalse(
            xtreamLiveFallbackStillApplies(
                expectedChannelKey = "playlist:channel-1",
                expectedSourceUri = "https://provider.example/live/1.m3u8",
                activeChannelKey = "playlist:channel-1",
                activeRequestUri = "https://provider.example/live/1.ts",
            ),
        )
    }
}
