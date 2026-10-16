package com.iptvnator.googletv.download

import android.content.Context
import android.content.Intent
import android.app.DownloadManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.iptvnator.googletv.MainActivity
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class TvResumableDownloadServiceTest {
    @Test fun pausedDownloadResumesFromTheStoredPartialOnTheSameTask() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        context.startActivity(
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        instrumentation.waitForIdleSync()

        val server = MockWebServer().apply { start() }
        val manager = TvDownloadManager(context)
        val store = TvDownloadTaskStore(context)
        val content = ByteArray(512 * 1024) { (it % 239).toByte() }
        server.enqueue(
            MockResponse()
                .setHeader("ETag", "\"service-test\"")
                .setBody(Buffer().write(content))
                .throttleBody(8 * 1024, 40, TimeUnit.MILLISECONDS),
        )

        val id = manager.enqueueUrl(server.url("/long-video.ts").toString(), "Service resume test", "ts")
        try {
            waitUntil(20_000) { store.get(id)?.downloadedBytes?.let { it >= 32 * 1024 } == true }
            assertTrue("The partial must exist before pausing", store.partialFile(store.get(id)!!).length() > 0)
            assertTrue(manager.pause(id))
            waitUntil(10_000) { manager.query(id)?.status == DownloadManager.STATUS_PAUSED }
            val task = store.get(id)
            assertNotNull(task)
            val offset = waitForStableLength(store.partialFile(task!!))
            assertTrue("Pause should retain downloaded bytes", offset > 0 && offset < content.size)

            server.enqueue(
                MockResponse().setResponseCode(206)
                    .setHeader("ETag", "\"service-test\"")
                    .setHeader("Content-Range", "bytes $offset-${content.lastIndex}/${content.size}")
                    .setBody(Buffer().write(content, offset.toInt(), content.size - offset.toInt())),
            )
            assertTrue(manager.resume(id))
            waitUntil(20_000) { manager.query(id)?.status == DownloadManager.STATUS_SUCCESSFUL }

            val resumeRequest = server.takeRequest(5, TimeUnit.SECONDS)
            // The initial request is the first one; consume it before inspecting the resumed request.
            assertNotNull(resumeRequest)
            val initial = resumeRequest!!
            val resumed = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("GET", initial.method)
            assertEquals("bytes=$offset-", resumed.getHeader("Range"))
            assertEquals("\"service-test\"", resumed.getHeader("If-Range"))
            assertTrue(store.completedFile(store.get(id)!!).readBytes().contentEquals(content))
        } finally {
            manager.cancel(id)
            server.shutdown()
        }
    }

    @Test fun appStartupRecoversPersistedRunningDownload() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val scenario = ActivityScenario.launch(MainActivity::class.java)

        val server = MockWebServer().apply { start() }
        val manager = TvDownloadManager(context)
        val store = TvDownloadTaskStore(context)
        val content = ByteArray(384 * 1024) { (it % 197).toByte() }
        val offset = 64 * 1024
        val validator = "\"app-startup-recovery\""
        server.enqueue(
            MockResponse().setResponseCode(206)
                .setHeader("ETag", validator)
                .setHeader("Content-Range", "bytes $offset-${content.lastIndex}/${content.size}")
                .setBody(Buffer().write(content, offset, content.size - offset)),
        )
        val task = store.create(
            TvDownloadRequest(server.url("/startup-recovery.ts").toString(), "Startup recovery test", "ts", null, emptyMap()),
        )
        val partial = store.partialFile(task)
        partial.parentFile?.mkdirs()
        partial.writeBytes(content.copyOfRange(0, offset))
        store.update(
            task.id,
            status = DownloadManager.STATUS_RUNNING,
            downloadedBytes = offset.toLong(),
            totalBytes = content.size.toLong(),
            validator = validator,
            replaceTotal = true,
            replaceValidator = true,
        )

        try {
            // Recreate the app's composition after a durable RUNNING row has
            // been restored; its startup effect must deliver work to the service.
            scenario.recreate()
            instrumentation.waitForIdleSync()
            waitUntil(20_000) { manager.query(task.id)?.status == DownloadManager.STATUS_SUCCESSFUL }

            val resumed = server.takeRequest(5, TimeUnit.SECONDS)
            assertNotNull("Opening IPTVnator should restart the persisted request", resumed)
            assertEquals("bytes=$offset-", resumed!!.getHeader("Range"))
            assertEquals(validator, resumed.getHeader("If-Range"))
            assertTrue("Startup recovery should finish the original partial", store.completedFile(store.get(task.id)!!).readBytes().contentEquals(content))
        } finally {
            manager.cancel(task.id)
            scenario.close()
            server.shutdown()
        }
    }

    @Test fun interruptedDownloadRecoversAfterTheServiceIsRecreated() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        context.startActivity(
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        instrumentation.waitForIdleSync()

        val server = MockWebServer().apply { start() }
        val manager = TvDownloadManager(context)
        val store = TvDownloadTaskStore(context)
        val content = ByteArray(512 * 1024) { (it % 239).toByte() }
        server.enqueue(
            MockResponse()
                .setHeader("ETag", "\"service-recovery\"")
                .setBody(Buffer().write(content))
                .throttleBody(8 * 1024, 40, TimeUnit.MILLISECONDS),
        )

        val id = manager.enqueueUrl(server.url("/recover-video.ts").toString(), "Service recovery test", "ts")
        try {
            waitUntil(20_000) { store.get(id)?.downloadedBytes?.let { it >= 32 * 1024 } == true }
            val originalTask = store.get(id)!!
            val partial = store.partialFile(originalTask)
            val beforeStop = partial.length()
            assertTrue("The partial should have bytes before simulating process loss", beforeStop in 1 until content.size.toLong())

            assertTrue("The foreground service should be running", context.stopService(Intent(context, TvDownloadService::class.java)))
            val interruptedTask = store.get(id)!!
            val resumeOffset = waitForStableLength(partial)
            assertTrue(
                "After teardown the durable task must be queued or already running in a sticky-service recovery",
                interruptedTask.status == DownloadManager.STATUS_PENDING || interruptedTask.status == DownloadManager.STATUS_RUNNING,
            )
            assertTrue("Service destruction must retain the partial", resumeOffset in 1 until content.size.toLong())

            server.enqueue(
                MockResponse().setResponseCode(206)
                    .setHeader("ETag", "\"service-recovery\"")
                    .setHeader("Content-Range", "bytes $resumeOffset-${content.lastIndex}/${content.size}")
                    .setBody(Buffer().write(content, resumeOffset.toInt(), content.size - resumeOffset.toInt())),
            )
            assertTrue("Opening the app should submit durable work for recovery", manager.recoverInterruptedDownloads())
            waitUntil(20_000) { manager.query(id)?.status == DownloadManager.STATUS_SUCCESSFUL }

            val initial = server.takeRequest(5, TimeUnit.SECONDS)
            val resumed = server.takeRequest(5, TimeUnit.SECONDS)
            assertNotNull(initial)
            assertNotNull(resumed)
            assertEquals("bytes=$resumeOffset-", resumed!!.getHeader("Range"))
            assertEquals("\"service-recovery\"", resumed.getHeader("If-Range"))
            assertTrue("Recovery must complete the same task's original representation", store.completedFile(store.get(id)!!).readBytes().contentEquals(content))
        } finally {
            manager.cancel(id)
            server.shutdown()
        }
    }

    private fun waitUntil(timeoutMs: Long, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(100)
        }
        assertTrue("Timed out waiting for download state", condition())
    }

    private fun waitForStableLength(file: File): Long {
        val deadline = System.currentTimeMillis() + 5_000
        var previous = -1L
        var stableSamples = 0
        while (System.currentTimeMillis() < deadline && stableSamples < 3) {
            val current = file.length()
            stableSamples = if (current > 0 && current == previous) stableSamples + 1 else 0
            previous = current
            Thread.sleep(100)
        }
        assertTrue("The partial file should stop growing after cancellation", stableSamples >= 3)
        return previous
    }
}
