package com.iptvnator.googletv.recording

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TvRecordingHistoryTest {
    private val preferencesName = "iptvnator-tv-recording-history-test"
    private val preferences by lazy {
        InstrumentationRegistry.getInstrumentation().targetContext
            .getSharedPreferences(preferencesName, 0)
    }
    private val filesDirectory by lazy {
        InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
            .resolve("iptvnator-recording-history-test")
    }

    @Before
    fun clearBefore() {
        preferences.edit().clear().commit()
        filesDirectory.deleteRecursively()
        filesDirectory.mkdirs()
    }

    @After
    fun clearAfter() {
        preferences.edit().clear().commit()
        filesDirectory.deleteRecursively()
    }

    @Test
    fun historyKeepsRecordingEntriesBeyondOneHundred() {
        val history = TvRecordingHistory(preferences)

        repeat(125) { index ->
            val file = filesDirectory.resolve("recording-$index.ts")
            file.writeBytes(byteArrayOf(0x47, index.toByte()))
            history.add(
                TvRecording(
                    file = file,
                    title = "Grabación $index",
                    startedAtMs = index.toLong(),
                    endedAtMs = index.toLong() + 1,
                    status = TvRecordingStatus.COMPLETED,
                    bytes = file.length(),
                ),
            )
        }

        val restored = TvRecordingHistory(preferences).load()

        assertEquals(125, restored.size)
        assertTrue(restored.first().file.name == "recording-124.ts")
        assertTrue(restored.last().file.name == "recording-0.ts")
    }
}
