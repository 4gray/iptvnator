package com.iptvnator.googletv.xtream

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class XtreamRequestBuilderTest {
    private val credentials = XtreamCredentials(
        serverUrl = "https://panel.example:8080/player_api.php/",
        username = "user name",
        password = "p@ss/word",
    )

    @Test
    fun `normalizes api suffix and encodes credentials`() {
        val url = XtreamRequestBuilder.apiUrl(credentials, mapOf("action" to "get_live_streams"))

        assertTrue(url.startsWith("https://panel.example:8080/player_api.php?"))
        assertTrue(url.contains("username=user%20name"))
        assertTrue(url.contains("password=p%40ss%2Fword"))
        assertTrue(url.contains("action=get_live_streams"))
    }

    @Test
    fun `builds stream urls with encoded credentials`() {
        assertEquals(
            "https://panel.example:8080/live/user%20name/p%40ss%2Fword/42.m3u8",
            XtreamApiClient().liveStreamUrl(credentials, 42),
        )
    }

    @Test
    fun `builds catchup timeshift url with provider timezone and duration`() {
        val url = XtreamApiClient().catchupStreamUrl(
            credentials = credentials,
            streamId = 42,
            startMs = 1_759_464_000_000L,
            endMs = 1_759_465_800_000L,
            serverTimezone = "Europe/Madrid",
        )

        assertTrue(url.startsWith("https://panel.example:8080/timeshift/user%20name/p%40ss%2Fword/30/"))
        assertTrue(url.endsWith("/42.ts"))
    }

    @Test
    fun `builds both catchup endpoint families and preserves encoded credentials`() {
        val candidates = XtreamApiClient().catchupStreamCandidates(
            credentials = credentials,
            streamId = 7,
            startMs = 1_775_820_000_000L,
            endMs = 1_775_821_800_000L,
            preferredFormats = listOf("ts"),
        )

        assertEquals(2, candidates.size)
        assertEquals("rest:ts", candidates[0].first)
        assertTrue(candidates[0].second.contains("/timeshift/user%20name/p%40ss%2Fword/30/"))
        assertEquals("legacy:ts", candidates[1].first)
        assertTrue(candidates[1].second.contains("/streaming/timeshift.php?"))
        assertTrue(candidates[1].second.contains("username=user%20name"))
        assertTrue(candidates[1].second.contains("password=p%40ss%2Fword"))
    }

    @Test
    fun `rounds short catchup durations like the original builder`() {
        val url = XtreamApiClient().catchupStreamUrl(
            credentials = credentials,
            streamId = 42,
            startMs = 1_775_820_000_000L,
            endMs = 1_775_820_089_000L,
        )

        assertTrue(url.contains("/timeshift/user%20name/p%40ss%2Fword/1/"))
    }

    @Test
    fun `removes endpoint and query from a copied api url`() {
        val copied = credentials.copy(
            serverUrl = "https://panel.example:8080/panel/player_api.php?username=old&password=old",
        )
        assertEquals(
            "https://panel.example:8080/panel/player_api.php?username=user%20name&password=p%40ss%2Fword",
            XtreamRequestBuilder.apiUrl(copied, emptyMap()),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects non http server urls`() {
        XtreamRequestBuilder.normalizeServerUrl("ftp://panel.example")
    }

    @Test
    fun `selects the alternate live container after auto failure`() {
        assertEquals(
            TvXtreamStreamFormat.TS,
            alternateXtreamLiveFormat("https://panel.example/live/user/pass/42.m3u8?token=x"),
        )
        assertEquals(
            TvXtreamStreamFormat.M3U8,
            alternateXtreamLiveFormat("https://panel.example/live/user/pass/42.ts"),
        )
    }
}
