package com.iptvnator.googletv

import android.content.Context
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvLocalM3uPickerTest {
    private lateinit var context: Context
    private lateinit var fixture: File
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private val selectedUri = AtomicReference<String?>(null)

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        fixture = File(context.getExternalFilesDir(null), "dpad-focus-fixture.m3u")
        fixture.writeText("#EXTM3U\n")
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    TvLocalM3uPicker(
                        onDismiss = {},
                        onUseUrlOrText = {},
                        onSelect = { selectedUri.set(it.uri.toString()) },
                    )
                }
            }
        }
    }

    @After
    fun tearDown() {
        if (::scenario.isInitialized) scenario.close()
        if (::fixture.isInitialized) fixture.delete()
    }

    @Test
    fun firstM3uFileHasInitialRemoteFocusAndActivatesWithOk() {
        val firstVisibleFile = device.wait(
            Until.findObject(By.textContains(".m3u")),
            5_000,
        )
        assertNotNull(
            "At least one app-accessible M3U should be visible in the fallback picker",
            firstVisibleFile,
        )
        // Other app-accessible playlists may exist on the device, so compare
        // with the row that actually owns remote focus, not tree order.
        val focusedRow = device.wait(
            Until.findObject(By.focused(true).hasDescendant(By.textContains(".m3u"))),
            5_000,
        )
        assertNotNull("A file row should own the initial remote focus", focusedRow)
        val firstVisibleName = focusedRow!!.findObject(By.textContains(".m3u")).text

        device.waitForIdle()
        device.pressDPadCenter()
        val deadline = System.currentTimeMillis() + 2_000
        while (selectedUri.get() == null && System.currentTimeMillis() < deadline) Thread.sleep(50)

        assertTrue(
            "OK should select the initially focused file (name=$firstVisibleName selected=${selectedUri.get()})",
            selectedUri.get()?.endsWith("/$firstVisibleName") == true,
        )
    }
}
