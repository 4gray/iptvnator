package com.iptvnator.googletv.playlist

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvM3uVodDetectionTest {
    private fun channel(url: String, name: String = "Some Movie", radio: Boolean = false) =
        TvChannel("id", name, url, radio = radio)

    @Test
    fun `recognizes file containers and xtream movie paths`() {
        assertTrue(isLikelyTvM3uVod(channel("http://host/films/dune.mkv")))
        assertTrue(isLikelyTvM3uVod(channel("http://host/movie/user/pass/12345")))
        assertTrue(isLikelyTvM3uVod(channel("http://host/stream?ext=mp4")))
        assertTrue(isLikelyTvM3uVod(channel("http://host/stream?extension=mp4")))
        assertTrue(isLikelyTvM3uVod(channel("http://host/stream?format=mp4")))
        assertTrue(isLikelyTvM3uVod(channel("http://host/stream?container=mp4")))
        assertTrue(isLikelyTvM3uVod(channel("http://host/series/user/pass/123.mkv", "Show S01E02")))
    }

    @Test
    fun `does not classify live audio or dash as vod`() {
        assertFalse(isLikelyTvM3uVod(channel("http://host/live/channel.m3u8")))
        assertFalse(isLikelyTvM3uVod(channel("http://host/movie/stream.mpd")))
        assertFalse(isLikelyTvM3uVod(channel("http://host/music.mp4", radio = true)))
    }

    @Test
    fun `movie gate excludes series and episode titles`() {
        assertTrue(isLikelyTvM3uMovie(channel("http://host/films/dune.mkv")))
        assertFalse(isLikelyTvM3uMovie(channel("http://host/series/episode.mkv", "Show S01E02")))
        assertFalse(isLikelyTvM3uMovie(channel("http://host/films/episode.mkv", "Show 1x02")))
        assertFalse(isLikelyTvM3uMovie(channel("http://host/films/episode.mkv", "Show 1 episodio")))
        assertFalse(isLikelyTvM3uMovie(channel("http://host/films/season.mkv", "Show 2 temporada")))
    }

    @Test
    fun `movie gate matches original localized season markers`() {
        assertFalse(isLikelyTvM3uMovie(channel("http://host/films/dark.mkv", "Dark Staffel 3")))
        assertFalse(isLikelyTvM3uMovie(channel("http://host/films/lupin.mkv", "Lupin Saison 2")))
        assertFalse(isLikelyTvM3uMovie(channel("http://host/films/show.mkv", "Шерлок Сезон 3")))
        assertFalse(isLikelyTvM3uMovie(channel("http://host/films/show.mkv", "Шерлок 2 сезон")))
        assertTrue(isLikelyTvM3uMovie(channel("http://host/films/the-season.mkv", "The Fifth Season")))
    }
}
