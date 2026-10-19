package com.iptvnator.googletv.playlist

import com.iptvnator.googletv.TvDrmConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TvPlaylistBackupTest {
    @Test
    fun `merges favorite history and watched projections without losing resume state`() {
        val favorite = TvSavedItem(
            playlistId = "p",
            itemType = TvSavedItemType.VOD,
            itemKey = "7",
            title = "Movie",
            uri = "https://media/movie.mp4",
            coverUrl = "https://img/poster.jpg",
            savedAt = 300L,
            lastPlayedAt = null,
            isFavorite = true,
        )
        val history = favorite.copy(lastPlayedAt = 900L, resumePositionMs = 12_345L)
        val watched = favorite.copy(isWatched = true)

        val merged = TvPlaylistBackup.mergeSavedItems(listOf(favorite), listOf(history), listOf(watched)).single()

        assertTrue(merged.isFavorite)
        assertTrue(merged.isWatched)
        assertEquals(900L, merged.lastPlayedAt)
        assertEquals(12_345L, merged.resumePositionMs)
        assertEquals(300L, merged.savedAt)
    }

    @Test
    fun `exports local m3u source with playback metadata`() {
        val json = TvPlaylistBackup.export(
            listOf(
                StoredPlaylist(
                    id = "local",
                    name = "Canales locales",
                    sourceUrl = "content://documents.example/playlist.m3u",
                    epgUrl = "https://guide.example/xmltv.xml",
                    sourceReferrer = "https://provider.example/watch",
                    sourceOrigin = "https://provider.example",
                    hiddenGroupTitles = listOf("Noticias ocultas"),
                    hiddenCategories = listOf(TvHiddenCategory("movies", "10"), TvHiddenCategory("series", "20")),
                    channels = listOf(
                        TvChannel(
                            id = "news",
                            name = "News",
                            url = "https://stream.example/news.m3u8",
                            group = "Noticias",
                            tvgId = "news.es",
                            userAgent = "Provider/1.0",
                            headers = mapOf("Referer" to "https://provider.example/"),
                            channelNumber = 101,
                            drm = TvDrmConfig("clearkey", true, mapOf("a".repeat(32) to "b".repeat(32))),
                        ),
                        TvChannel(
                            id = "protected",
                            name = "Protected DASH",
                            url = "https://stream.example/protected.mpd",
                            tvgId = "protected",
                            drm = TvDrmConfig(
                                licenseType = "com.widevine.alpha",
                                supported = true,
                                licenseUrl = "https://license.example/widevine",
                                licenseHeaders = mapOf("Content-Type" to "application/octet-stream", "Authorization" to "Bearer token+plus"),
                                licenseRequestData = "R{SSM}",
                                licenseResponseData = "R",
                            ),
                        ),
                        TvChannel(
                            id = "wrapped",
                            name = "Wrapped DASH",
                            url = "https://stream.example/wrapped.mpd",
                            tvgId = "wrapped",
                            drm = TvDrmConfig(
                                licenseType = "com.widevine.alpha",
                                supported = false,
                                licenseUrl = "https://license.example/wrapped",
                                licenseRequestData = "B{SSM}",
                                licenseResponseData = "Jlicense",
                                additionalProperties = mapOf("inputstream.adaptive.license_data" to "custom-pssh"),
                            ),
                        ),
                    ),
                ),
            ),
            credentials = null,
            savedItems = listOf(
                TvSavedItem(
                    playlistId = "local",
                    itemType = TvSavedItemType.CHANNEL,
                    itemKey = "news",
                    title = "News",
                    uri = "https://stream.example/news.m3u8",
                    coverUrl = null,
                    savedAt = 100L,
                    lastPlayedAt = 200L,
                    isFavorite = true,
                    resumePositionMs = 42L,
                    isWatched = true,
                ),
            ),
            episodeProgress = listOf(
                TvEpisodeProgress("local", 7, 3, 1200L, 5000L, false, 300L),
            ),
            epgSourceStates = mapOf(
                "local" to listOf(
                    TvEpgSourceState("https://guide.example/xmltv.xml", true, detected = true),
                    TvEpgSourceState("https://backup.example/xmltv.xml", false, detected = true),
                ),
            ),
            autoRefresh = { it == "local" },
        )

        val manifest = org.json.JSONObject(json)
        assertEquals("iptvnator-playlist-backup", manifest.getString("kind"))
        assertTrue(manifest.getBoolean("includeSecrets"))
        val source = manifest.getJSONArray("playlists").getJSONObject(0)
        val sourceMetadata = source.getJSONObject("source")
        assertEquals("https://provider.example/watch", sourceMetadata.getString("referrer"))
        assertEquals("https://provider.example", sourceMetadata.getString("origin"))
        val content = sourceMetadata.getString("rawM3u")
        assertTrue(content.contains("#EXTM3U url-tvg=\"https://guide.example/xmltv.xml\""))
        assertTrue(content.contains("tvg-chno=\"101\""))
        assertTrue(content.contains("#EXTVLCOPT:http-referrer=https://provider.example/"))
        assertTrue(content.contains("#KODIPROP:inputstream.adaptive.license_type=clearkey"))
        assertTrue(content.contains("#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha"))
        assertTrue(content.contains("Authorization=Bearer+token%2Bplus"))
        assertTrue(content.contains("#KODIPROP:inputstream.adaptive.license_data=custom-pssh"))
        assertTrue(content.contains("https://stream.example/news.m3u8"))
        val restoredDrm = M3uPlaylistParser.parse(content).channels.single { it.id == "protected" }.drm
        assertEquals(true, restoredDrm?.supported)
        assertEquals("https://license.example/widevine", restoredDrm?.licenseUrl)
        assertEquals("Bearer token+plus", restoredDrm?.licenseHeaders?.get("Authorization"))
        assertEquals("R{SSM}", restoredDrm?.licenseRequestData)
        assertEquals("R", restoredDrm?.licenseResponseData)
        val restoredWrappedDrm = M3uPlaylistParser.parse(content).channels.single { it.id == "wrapped" }.drm
        assertEquals(false, restoredWrappedDrm?.supported)
        assertEquals("B{SSM}", restoredWrappedDrm?.licenseRequestData)
        assertEquals("Jlicense", restoredWrappedDrm?.licenseResponseData)
        assertEquals("custom-pssh", restoredWrappedDrm?.additionalProperties?.get("inputstream.adaptive.license_data"))
        assertEquals("m3u", source.getString("portalType"))
        assertEquals("file", source.getJSONObject("source").getString("kind"))
        assertTrue("Document grants cannot be restored on another TV", source.getJSONObject("source").isNull("url"))
        assertEquals("Noticias ocultas", source.getJSONObject("userState").getJSONArray("hiddenGroupTitles").getString(0))
        assertEquals("news", source.getJSONObject("userState").getJSONArray("favorites").getString(0))
        assertTrue(source.getBoolean("autoRefresh"))
        val tvState = source.getJSONObject("androidTvState")
        assertEquals(1, tvState.getJSONArray("userState").length())
        assertTrue(tvState.getJSONArray("userState").getJSONObject(0).getBoolean("favorite"))
        assertTrue(tvState.getJSONArray("userState").getJSONObject(0).getBoolean("watched"))
        assertEquals(1, tvState.getJSONArray("episodeProgress").length())
        assertEquals(1200L, tvState.getJSONArray("episodeProgress").getJSONObject(0).getLong("positionMs"))
        val epgSources = tvState.getJSONArray("epgSources")
        assertEquals(2, epgSources.length())
        assertTrue(epgSources.getJSONObject(0).getBoolean("enabled"))
        assertTrue(epgSources.getJSONObject(0).getBoolean("detected"))
        assertEquals("https://backup.example/xmltv.xml", epgSources.getJSONObject(1).getString("url"))
        assertTrue(!epgSources.getJSONObject(1).getBoolean("enabled"))
        assertTrue(epgSources.getJSONObject(1).getBoolean("detected"))
    }
}
