package com.iptvnator.googletv.download

import android.content.Intent
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.iptvnator.googletv.MainActivity
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Host-orchestrated probe for a genuine app-process kill while a transfer is active. */
@RunWith(AndroidJUnit4::class)
class TvDownloadProcessRecoveryProbeTest {
    @Test fun leavesAnActivePartialForTheHostToForceStopAndRelaunch() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val recoveryUrl = InstrumentationRegistry.getArguments().getString("recovery_url")
        assumeTrue("Host must provide recovery_url for this destructive-process probe", !recoveryUrl.isNullOrBlank())
        val context = instrumentation.targetContext
        context.startActivity(
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        instrumentation.waitForIdleSync()

        val manager = TvDownloadManager(context)
        val store = TvDownloadTaskStore(context)
        val id = manager.enqueueUrl(recoveryUrl!!, "Process recovery probe", "bin")
        val deadline = System.currentTimeMillis() + 30_000L
        var partialBytes = 0L
        while (System.currentTimeMillis() < deadline) {
            partialBytes = store.get(id)?.downloadedBytes ?: 0L
            if (partialBytes >= MINIMUM_PARTIAL_BYTES) break
            Thread.sleep(100)
        }
        Log.i(TAG, "READY id=$id partialBytes=$partialBytes file=${store.partialFile(store.get(id)!!).absolutePath}")
        assertTrue("The external server should have produced a durable partial", partialBytes >= MINIMUM_PARTIAL_BYTES)
        // Intentionally leave the task active. The instrumentation runner's
        // normal teardown force-stops the target app; the host then relaunches it.
    }

    @Test fun verifiesTheRecoveredFileAfterTheHostRelaunchesTheApp() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val id = InstrumentationRegistry.getArguments().getString("recovery_id")?.toLongOrNull()
        assumeTrue("Host must provide recovery_id after relaunch", id != null)
        val context = instrumentation.targetContext
        context.startActivity(
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        instrumentation.waitForIdleSync()

        val manager = TvDownloadManager(context)
        val store = TvDownloadTaskStore(context)
        val deadline = System.currentTimeMillis() + 30_000L
        var snapshot = manager.query(id!!)
        while (snapshot?.status != android.app.DownloadManager.STATUS_SUCCESSFUL && System.currentTimeMillis() < deadline) {
            Thread.sleep(100)
            snapshot = manager.query(id)
        }
        assertEquals("The interrupted task should finish after app startup recovery", android.app.DownloadManager.STATUS_SUCCESSFUL, snapshot?.status)

        val task = assertNotNullTask(store.get(id))
        val completed = store.completedFile(task)
        assertEquals(FIXTURE_SIZE.toLong(), completed.length())
        assertFalse("The recovered partial should be atomically renamed", store.partialFile(task).exists())
        completed.inputStream().buffered().use { input ->
            val actual = ByteArray(8192)
            var offset = 0
            while (offset < FIXTURE_SIZE) {
                val expectedLength = minOf(actual.size, FIXTURE_SIZE - offset)
                var read = 0
                while (read < expectedLength) {
                    val count = input.read(actual, read, expectedLength - read)
                    assertTrue("The completed fixture should not be truncated", count > 0)
                    read += count
                }
                val expected = ByteArray(expectedLength) { index -> ((offset + index) % 251).toByte() }
                assertArrayEquals("Recovered fixture bytes differ at offset $offset", expected, actual.copyOf(expectedLength))
                offset += expectedLength
            }
            assertEquals("The completed fixture should have no trailing bytes", -1, input.read())
        }
        store.forget(id, deleteFiles = true)
        assertFalse("The host fixture should be removed after verification", completed.exists())
    }

    private fun assertNotNullTask(task: TvStoredDownload?): TvStoredDownload =
        task ?: throw AssertionError("The recovered download row should remain persisted")

    private companion object {
        const val TAG = "TvDownloadProcessProbe"
        const val MINIMUM_PARTIAL_BYTES = 128L * 1024L
        const val FIXTURE_SIZE = 12 * 1024 * 1024
    }
}
