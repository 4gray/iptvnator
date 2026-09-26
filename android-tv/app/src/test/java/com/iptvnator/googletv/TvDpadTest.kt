package com.iptvnator.googletv

import android.view.KeyEvent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvDpadTest {
    @Test
    fun `only initial select key activates a tv action`() {
        assertTrue(isInitialTvSelect(KeyEvent.KEYCODE_DPAD_CENTER, 0))
        assertTrue(isInitialTvSelect(KeyEvent.KEYCODE_ENTER, 0))
        assertFalse(isInitialTvSelect(KeyEvent.KEYCODE_DPAD_CENTER, 1))
        assertFalse(isInitialTvSelect(KeyEvent.KEYCODE_ENTER, 2))
        assertFalse(isInitialTvSelect(KeyEvent.KEYCODE_DPAD_DOWN, 0))
    }
}
