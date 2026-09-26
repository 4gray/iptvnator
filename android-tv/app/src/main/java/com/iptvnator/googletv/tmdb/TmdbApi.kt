package com.iptvnator.googletv.tmdb

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder

data class TmdbSearchResult(
    val id: Int,
    val title: String,
    val overview: String?,
    val posterPath: String?,
    val backdropPath: String?,
    val releaseDate: String?,
    val mediaType: String,
)

data class TmdbDetails(
    val id: Int,
    val title: String,
    val overview: String?,
    val posterPath: String?,
    val backdropPath: String?,
    val releaseDate: String?,
    val genres: List<String>,
    val rating: Double? = null,
    val director: String? = null,
    val cast: List<String> = emptyList(),
    val trailerKey: String? = null,
    val similar: List<TmdbSearchResult> = emptyList(),
)

object TmdbRequestBuilder {
    private const val BASE_URL = "https://api.themoviedb.org/3"

    fun url(path: String, apiKey: String, params: Map<String, String> = emptyMap()): String {
        require(apiKey.isNotBlank()) { "TMDB API key is required" }
        val query = mapOf("api_key" to apiKey) + params
        return "$BASE_URL${if (path.startsWith('/')) path else "/$path"}?" +
            query.entries.joinToString("&") { "${encode(it.key)}=${encode(it.value)}" }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}

class TmdbApiClient(
    private val connectTimeoutMs: Int = 15_000,
    private val readTimeoutMs: Int = 30_000,
) {
    fun searchMovie(query: String, language: String, apiKey: String): List<TmdbSearchResult> =
        search("movie", query, language, apiKey)

    fun searchTv(query: String, language: String, apiKey: String): List<TmdbSearchResult> =
        search("tv", query, language, apiKey)

    fun trending(language: String, apiKey: String): List<TmdbSearchResult> =
        parseResults(
            request("/trending/all/week", apiKey, mapOf("language" to language)),
            mediaTypeFromPayload = true,
        )

    fun getMovieDetails(id: Int, language: String, apiKey: String): TmdbDetails =
        request("/movie/$id", apiKey, detailsParams(language)).let(::parseDetails)

    fun getTvDetails(id: Int, language: String, apiKey: String): TmdbDetails =
        request("/tv/$id", apiKey, detailsParams(language)).let(::parseDetails)

    private fun search(type: String, query: String, language: String, apiKey: String): List<TmdbSearchResult> {
        val root = request("/search/$type", apiKey, mapOf("query" to query, "language" to language))
        return parseTmdbSearchResults(root, mediaTypeFromPayload = false, defaultMediaType = type)
    }

    private fun parseResults(
        root: JSONObject,
        mediaTypeFromPayload: Boolean,
        defaultMediaType: String = "movie",
    ): List<TmdbSearchResult> = parseTmdbSearchResults(root, mediaTypeFromPayload, defaultMediaType)

    private fun parseDetails(item: JSONObject): TmdbDetails = TmdbDetails(
        id = item.getInt("id"),
        title = item.optString("title").ifBlank { item.optString("name") },
        overview = item.optString("overview").takeIf { it.isNotBlank() },
        posterPath = item.optString("poster_path").takeIf { it.isNotBlank() },
        backdropPath = item.optString("backdrop_path").takeIf { it.isNotBlank() },
        releaseDate = item.optString("release_date").ifBlank { item.optString("first_air_date") }.takeIf { it.isNotBlank() },
        genres = (item.optJSONArray("genres") ?: org.json.JSONArray()).let { genres ->
            (0 until genres.length()).mapNotNull { genres.optJSONObject(it)?.optString("name")?.takeIf(String::isNotBlank) }
        },
        rating = item.optDouble("vote_average", Double.NaN).takeUnless { it.isNaN() || it <= 0.0 },
        director = (item.optJSONObject("credits")?.optJSONArray("crew") ?: org.json.JSONArray()).let { crew ->
            (0 until crew.length()).asSequence()
                .mapNotNull { crew.optJSONObject(it) }
                .firstOrNull { it.optString("job").equals("Director", true) }
                ?.optString("name")
                ?.takeIf(String::isNotBlank)
        },
        cast = (item.optJSONObject("credits")?.optJSONArray("cast") ?: org.json.JSONArray()).let { cast ->
            (0 until cast.length()).mapNotNull { cast.optJSONObject(it)?.optString("name")?.takeIf(String::isNotBlank) }.take(8)
        },
        trailerKey = (item.optJSONObject("videos")?.optJSONArray("results") ?: org.json.JSONArray()).let { videos ->
            (0 until videos.length()).asSequence()
                .mapNotNull { videos.optJSONObject(it) }
                .firstOrNull { it.optString("site").equals("YouTube", true) && it.optString("type").equals("Trailer", true) }
                ?.optString("key")
                ?.takeIf(String::isNotBlank)
        },
        similar = (item.optJSONObject("similar")?.optJSONArray("results") ?: org.json.JSONArray()).let { similar ->
            (0 until similar.length()).mapNotNull { index ->
                val candidate = similar.optJSONObject(index) ?: return@mapNotNull null
                TmdbSearchResult(
                    id = candidate.optInt("id", 0).takeIf { it > 0 } ?: return@mapNotNull null,
                    title = candidate.optString("title").ifBlank { candidate.optString("name") },
                    overview = candidate.optString("overview").takeIf { it.isNotBlank() },
                    posterPath = candidate.optString("poster_path").takeIf { it.isNotBlank() },
                    backdropPath = candidate.optString("backdrop_path").takeIf { it.isNotBlank() },
                    releaseDate = candidate.optString("release_date").ifBlank { candidate.optString("first_air_date") }.takeIf { it.isNotBlank() },
                    mediaType = if (candidate.has("first_air_date")) "tv" else "movie",
                )
            }.take(10)
        },
    )

    private fun detailsParams(language: String): Map<String, String> = mapOf(
        "language" to language,
        "append_to_response" to "credits,videos,similar",
    )

    private fun request(path: String, apiKey: String, params: Map<String, String>): JSONObject {
        val connection = URI(TmdbRequestBuilder.url(path, apiKey, params)).toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "IPTVnator-GoogleTV")
            connection.connect()
            check(connection.responseCode in 200..299) { "TMDB request failed with HTTP ${connection.responseCode}" }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally { connection.disconnect() }
    }
}

internal fun parseTmdbSearchResults(
    root: JSONObject,
    mediaTypeFromPayload: Boolean,
    defaultMediaType: String = "movie",
): List<TmdbSearchResult> {
    val results = root.optJSONArray("results") ?: return emptyList()
    return (0 until results.length()).mapNotNull { index ->
        val item = results.optJSONObject(index) ?: return@mapNotNull null
        val mediaType = if (mediaTypeFromPayload) {
            item.optString("media_type").takeIf { it == "movie" || it == "tv" } ?: return@mapNotNull null
        } else {
            defaultMediaType
        }
        TmdbSearchResult(
            id = item.optInt("id", 0).takeIf { it > 0 } ?: return@mapNotNull null,
            title = item.optString("title").ifBlank { item.optString("name") },
            overview = item.optString("overview").takeIf { it.isNotBlank() },
            posterPath = item.optString("poster_path").takeIf { it.isNotBlank() },
            backdropPath = item.optString("backdrop_path").takeIf { it.isNotBlank() },
            releaseDate = item.optString("release_date").ifBlank { item.optString("first_air_date") }.takeIf { it.isNotBlank() },
            mediaType = mediaType,
        )
    }
}
