package com.iptvnator.googletv

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvSettingsPosterSizeDpadTest {
    @Test
    fun posterSizeChoicesAreVisibleAndSelectableWithDpad() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        val focusRequester = FocusRequester()
        val selectedSize = AtomicReference("small")
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            scenario.onActivity { activity ->
                activity.setContent {
                    MaterialTheme {
                        var currentSize by remember { mutableStateOf("small") }
                        SettingPosterSizeRow(
                            selectedSize = currentSize,
                            onSelect = { value ->
                                currentSize = value
                                selectedSize.set(value)
                            },
                            firstFocusRequester = focusRequester,
                        )
                    }
                }
            }
            listOf("Pequeñas", "Medianas", "Grandes").forEach { label ->
                requireNotNull(device.wait(Until.findObject(By.text(label)), 5_000)) {
                    "The poster-size option '$label' should be visible without cycling"
                }
            }
            scenario.onActivity { check(focusRequester.requestFocus()) }
            device.waitForIdle()
            device.pressDPadRight()
            device.waitForIdle()
            device.pressDPadCenter()
            device.waitForIdle()

            assertEquals("medium", selectedSize.get())
        } finally {
            scenario.close()
        }
    }
}
