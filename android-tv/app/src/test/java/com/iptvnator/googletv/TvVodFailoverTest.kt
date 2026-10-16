package com.iptvnator.googletv

import com.iptvnator.googletv.playlist.TvVodItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TvVodFailoverTest {
    @Test
    fun `selects next untried xtream copy and never loops`() {
        val candidates = listOf(
            TvVodFailoverCandidate("one", TvVodItem(7, "Film", "https://one/movie", null, null, "mp4", null, providerType = "xtream")),
            TvVodFailoverCandidate("two", TvVodItem(7, "Film", "https://two/movie", null, null, "mp4", null, providerType = "xtream")),
            TvVodFailoverCandidate("three", TvVodItem(7, "Film", "https://three/movie", null, null, "mp4", null, providerType = "xtream")),
        )
        assertEquals("two:7", nextTvVodFailoverCandidate(candidates, "one:7", setOf("one:7"))?.key)
        assertEquals("three:7", nextTvVodFailoverCandidate(candidates, "two:7", setOf("one:7", "two:7"))?.key)
        assertNull(nextTvVodFailoverCandidate(candidates, "three:7", setOf("one:7", "two:7", "three:7")))
    }

    @Test
    fun `does not fail over to m3u or stalker copies`() {
        val candidates = listOf(
            TvVodFailoverCandidate("m3u", TvVodItem(7, "Film", "https://m3u/movie", null, null, "mp4", null, providerType = "m3u")),
            TvVodFailoverCandidate("stalker", TvVodItem(7, "Film", "stalker://movie", null, null, "", null, providerType = "stalker")),
        )
        assertNull(nextTvVodFailoverCandidate(candidates, "one:7", emptySet()))
    }
}
