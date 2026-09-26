package com.iptvnator.googletv.tmdb

import org.junit.Assert.assertTrue
import org.junit.Test

class TmdbRequestBuilderTest {
    @Test
    fun `encodes api key language and search query`() {
        val url = TmdbRequestBuilder.url("/search/movie", "key+/", mapOf("query" to "El señor de los anillos", "language" to "es-ES"))
        assertTrue(url.startsWith("https://api.themoviedb.org/3/search/movie?"))
        assertTrue(url.contains("api_key=key%2B%2F"))
        assertTrue(url.contains("query=El%20se%C3%B1or%20de%20los%20anillos"))
        assertTrue(url.contains("language=es-ES"))
    }
}
