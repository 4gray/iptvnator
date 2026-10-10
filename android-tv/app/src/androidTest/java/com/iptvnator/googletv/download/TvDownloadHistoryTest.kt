package com.iptvnator.googletv.download

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.iptvnator.googletv.TvApplication
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvDownloadHistoryTest {
    private val preferencesName = "iptvnator-tv-download-history-test"
    private val preferences by lazy {
        ApplicationProvider.getApplicationContext<TvApplication>()
            .getSharedPreferences(preferencesName, 0)
    }

    @Before
    fun clearBefore() {
        preferences.edit().clear().commit()
    }

    @After
    fun clearAfter() {
        preferences.edit().clear().commit()
    }

    @Test
    fun cancelledStateSurvivesReload() {
        val history = TvDownloadHistory(preferences)
        history.add(
            TvDownloadRecord(
                downloadId = 42L,
                playlistId = "playlist",
                vodId = 7,
                title = "Canal cancelado",
                createdAt = 1L,
                cancelled = true,
            ),
        )

        val restored = TvDownloadHistory(preferences).load().single()

        assertTrue(restored.cancelled)
        assertTrue(restored.downloadId == 42L)
    }

    @Test
    fun legacyRecordDefaultsToNotCancelled() {
        preferences.edit().putString(
            "downloads",
            "[{\"downloadId\":43,\"playlistId\":\"playlist\",\"vodId\":8,\"title\":\"Antiguo\",\"createdAt\":2}]",
        ).commit()

        val restored = TvDownloadHistory(preferences).load().single()

        assertFalse(restored.cancelled)
    }

    @Test
    fun historyKeepsEntriesBeyondOneHundredAndNewestFirst() {
        val history = TvDownloadHistory(preferences)

        repeat(125) { index ->
            history.add(
                TvDownloadRecord(
                    downloadId = index.toLong(),
                    playlistId = "playlist",
                    vodId = index,
                    title = "Descarga $index",
                    createdAt = index.toLong(),
                ),
            )
        }

        val restored = TvDownloadHistory(preferences).load()

        assertTrue("All 125 download records should remain available", restored.size == 125)
        assertTrue("The most recently added record should stay first", restored.first().downloadId == 124L)
        assertTrue("The oldest record should not be silently discarded", restored.last().downloadId == 0L)
    }
}
