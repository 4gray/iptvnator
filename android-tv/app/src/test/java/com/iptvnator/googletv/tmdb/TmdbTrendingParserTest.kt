package com.iptvnator.googletv.tmdb

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TmdbTrendingParserTest {
    @Test
    fun `trending parser keeps movies and tv and drops unsupported media types`() {
        val root = JSONObject(
            """
            {
              "results": [
                {"id": 1, "media_type": "movie", "title": "Film", "release_date": "2025-01-01"},
                {"id": 2, "media_type": "tv", "name": "Show", "first_air_date": "2024-01-01"},
                {"id": 3, "media_type": "person", "name": "Actor"},
                {"id": 0, "media_type": "movie", "title": "Invalid"}
              ]
            }
            """.trimIndent(),
        )

        val parsed = parseTmdbSearchResults(root, mediaTypeFromPayload = true)

        assertEquals(listOf("movie", "tv"), parsed.map { it.mediaType })
        assertEquals(listOf("Film", "Show"), parsed.map { it.title })
        assertTrue(parsed.all { it.id > 0 })
    }
}
