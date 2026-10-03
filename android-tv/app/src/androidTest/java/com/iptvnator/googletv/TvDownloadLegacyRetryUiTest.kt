package com.iptvnator.googletv

import android.app.DownloadManager
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.focus.FocusRequester
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.download.TvDownloadRecord
import com.iptvnator.googletv.download.TvDownloadSnapshot
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class TvDownloadLegacyRetryUiTest {
    private var scenario: ActivityScenario<MainActivity>? = null
    private val device by lazy {
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    }

    @After
    fun tearDown() {
        scenario?.close()
        scenario = null
    }

    @Test
    fun legacyDownloadRequiresRemoteConfirmationBeforeStartingFromZero() {
        val retryCount = AtomicInteger()
        showDownloads(supportsResume = false, retryCount)

        assertNotNull(
            "A legacy download must disclose that it will restart from zero",
            device.wait(Until.findObject(By.text("Descargar desde cero")), 5_000),
        )
        moveRemoteFocusToRetry("Descargar desde cero")
        device.pressDPadCenter()
        device.waitForIdle()
        assertNotNull(
            "The legacy retry warning should open from the remote's OK action",
            device.wait(Until.findObject(By.text("Descarga no reanudable")), 5_000),
        )
        assertNotNull(
            "The warning should explain why this download cannot resume",
            device.wait(Until.findObject(By.textContains("no puede continuar el parcial")), 5_000),
        )
        assertEquals("Opening the warning must not start a new transfer", 0, retryCount.get())

        device.pressDPadRight()
        device.waitForIdle()
        device.pressDPadCenter()
        device.waitForIdle()

        assertTrue("The chosen remote confirmation should launch exactly one retry", device.wait(
            Until.gone(By.text("Descarga no reanudable")), 5_000,
        ))
        assertEquals(1, retryCount.get())
    }

    @Test
    fun resumableDownloadKeepsTheDirectRetryAction() {
        val retryCount = AtomicInteger()
        showDownloads(supportsResume = true, retryCount)

        assertNotNull(
            "A resumable task should retain the ordinary Retry label",
            device.wait(Until.findObject(By.text("Reintentar")), 5_000),
        )
        moveRemoteFocusToRetry("Reintentar")
        device.pressDPadCenter()
        device.waitForIdle()

        assertEquals("A resumable retry should reach the partial-preserving path directly", 1, retryCount.get())
        assertTrue("A resumable task must not show the legacy restart warning", device.wait(
            Until.gone(By.text("Descarga no reanudable")), 1_000,
        ))
    }

    private fun showDownloads(supportsResume: Boolean, retryCount: AtomicInteger) {
        val record = TvDownloadRecord(
            downloadId = 9_000_000_042L,
            playlistId = "legacy-retry-source",
            vodId = 42,
            title = "Legacy retry fixture",
            createdAt = 1L,
        )
        val snapshot = TvDownloadSnapshot(
            id = record.downloadId,
            title = record.title,
            status = DownloadManager.STATUS_FAILED,
            progressPercent = 38,
            reason = DownloadManager.ERROR_HTTP_DATA_ERROR,
            localUri = null,
            supportsResume = supportsResume,
        )
        val focusRequester = FocusRequester()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario!!.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    DownloadsContent(
                        records = listOf(record),
                        snapshots = mapOf(record.downloadId to snapshot),
                        recordings = emptyList(),
                        message = null,
                        initialFocusRequester = focusRequester,
                        onClearCompleted = {},
                        onCancel = {},
                        onPause = {},
                        onResume = {},
                        onRemove = {},
                        onRetry = { retryCount.incrementAndGet() },
                        onPlayRecording = {},
                        onRemoveRecording = {},
                        onPlay = { _, _ -> },
                        onOpen = {},
                    )
                }
            }
        }
        device.waitForIdle()
    }

    private fun moveRemoteFocusToRetry(label: String) {
        // Tap only the initial navigation anchor so UiAutomator starts with a
        // deterministic focus target; the actual row action is remote-driven.
        device.wait(Until.findObject(By.text("Todas")), 5_000)?.click()
            ?: throw AssertionError("The downloads filter row should be visible")
        device.waitForIdle()
        device.pressDPadDown()
        device.waitForIdle()
        // Failed fixture action order is Abrir detalle → Quitar → retry.
        repeat(2) {
            device.pressDPadRight()
            device.waitForIdle()
        }
        assertNotNull("The $label action should remain present for the confirmation step", device.wait(
            Until.findObject(By.text(label)), 2_000,
        ))
    }

}
