package com.iptvnator.googletv.tmdb

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Small persistent cache for the metadata payloads used by TV detail screens. */
class TmdbCache(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun get(kind: String, title: String, language: String): TmdbDetails? = runCatching {
        preferences.getString(key(kind, title, language), null)
            ?.let(::decode)
    }.getOrNull()

    fun put(kind: String, title: String, language: String, details: TmdbDetails) {
        preferences.edit().putString(key(kind, title, language), encode(details).toString()).apply()
    }

    fun getTrending(language: String, nowMs: Long = System.currentTimeMillis()): List<TmdbSearchResult>? = runCatching {
        val root = preferences.getString(trendingKey(language), null)?.let(::JSONObject) ?: return null
        if (nowMs - root.optLong("fetchedAt", 0L) >= TRENDING_TTL_MS) return null
        root.optJSONArray("items")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                array.optJSONObject(index)?.let { item ->
                    TmdbSearchResult(
                        id = item.optInt("id").takeIf { it > 0 } ?: return@mapNotNull null,
                        title = item.optString("title"),
                        overview = item.optNullableString("overview"),
                        posterPath = item.optNullableString("posterPath"),
                        backdropPath = item.optNullableString("backdropPath"),
                        releaseDate = item.optNullableString("releaseDate"),
                        mediaType = item.optString("mediaType"),
                    )
                }
            }
        }.orEmpty()
    }.getOrNull()

    fun putTrending(language: String, items: List<TmdbSearchResult>, nowMs: Long = System.currentTimeMillis()) {
        val array = JSONArray().apply {
            items.forEach { item ->
                put(JSONObject().apply {
                    put("id", item.id)
                    put("title", item.title)
                    putNullable("overview", item.overview)
                    putNullable("posterPath", item.posterPath)
                    putNullable("backdropPath", item.backdropPath)
                    putNullable("releaseDate", item.releaseDate)
                    put("mediaType", item.mediaType)
                })
            }
        }
        preferences.edit().putString(
            trendingKey(language),
            JSONObject().put("fetchedAt", nowMs).put("items", array).toString(),
        ).apply()
    }

    fun size(): Int = preferences.all.keys.count { it.contains("|") }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private fun key(kind: String, title: String, language: String): String =
        "${kind.trim().lowercase()}|${language.trim().lowercase()}|${title.trim().lowercase()}"

    private fun trendingKey(language: String): String =
        "trending|${language.trim().lowercase()}"

    private fun encode(details: TmdbDetails): JSONObject = JSONObject().apply {
        put("id", details.id)
        put("title", details.title)
        putNullable("overview", details.overview)
        putNullable("posterPath", details.posterPath)
        putNullable("backdropPath", details.backdropPath)
        putNullable("releaseDate", details.releaseDate)
        put("genres", JSONArray(details.genres))
        details.rating?.let { put("rating", it) }
        putNullable("director", details.director)
        put("cast", JSONArray(details.cast))
        putNullable("trailerKey", details.trailerKey)
        put("similar", JSONArray().apply {
            details.similar.forEach { result ->
                put(JSONObject().apply {
                    put("id", result.id)
                    put("title", result.title)
                    putNullable("overview", result.overview)
                    putNullable("posterPath", result.posterPath)
                    putNullable("backdropPath", result.backdropPath)
                    putNullable("releaseDate", result.releaseDate)
                    put("mediaType", result.mediaType)
                })
            }
        })
    }

    private fun decode(json: String): TmdbDetails {
        val root = JSONObject(json)
        val genres = root.optJSONArray("genres")?.toStringList().orEmpty()
        val cast = root.optJSONArray("cast")?.toStringList().orEmpty()
        val similar = root.optJSONArray("similar")?.let { array ->
            (0 until array.length()).mapNotNull { index ->
                array.optJSONObject(index)?.let { item ->
                    TmdbSearchResult(
                        id = item.optInt("id"),
                        title = item.optString("title"),
                        overview = item.optNullableString("overview"),
                        posterPath = item.optNullableString("posterPath"),
                        backdropPath = item.optNullableString("backdropPath"),
                        releaseDate = item.optNullableString("releaseDate"),
                        mediaType = item.optString("mediaType", "movie"),
                    )
                }
            }
        }.orEmpty()
        return TmdbDetails(
            id = root.getInt("id"),
            title = root.optString("title"),
            overview = root.optNullableString("overview"),
            posterPath = root.optNullableString("posterPath"),
            backdropPath = root.optNullableString("backdropPath"),
            releaseDate = root.optNullableString("releaseDate"),
            genres = genres,
            rating = root.optDouble("rating", Double.NaN).takeUnless { it.isNaN() },
            director = root.optNullableString("director"),
            cast = cast,
            trailerKey = root.optNullableString("trailerKey"),
            similar = similar,
        )
    }

    private fun JSONArray.toStringList(): List<String> =
        (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }

    private fun JSONObject.putNullable(name: String, value: String?) {
        put(name, value ?: JSONObject.NULL)
    }

    private fun JSONObject.optNullableString(name: String): String? =
        optString(name).takeIf { it.isNotBlank() && it != JSONObject.NULL.toString() }

    companion object {
        private const val PREFERENCES = "iptvnator-tv-tmdb-cache"
        private const val TRENDING_TTL_MS = 24L * 60L * 60L * 1_000L
    }
}
