package com.iptvnator.googletv.playback

import android.view.KeyEvent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TvPlaybackShortcutTest {
    @Test
    fun `tv playback shortcuts include transport and volume keys`() {
        assertTrue(isTvPlaybackShortcutKey(KeyEvent.KEYCODE_DPAD_LEFT))
        assertTrue(isTvPlaybackShortcutKey(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertTrue(isTvPlaybackShortcutKey(KeyEvent.KEYCODE_DPAD_CENTER))
        assertTrue(isTvPlaybackShortcutKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertTrue(isTvPlaybackShortcutKey(KeyEvent.KEYCODE_DPAD_UP))
        assertTrue(isTvPlaybackShortcutKey(KeyEvent.KEYCODE_DPAD_DOWN))
        assertTrue(isTvPlaybackShortcutKey(KeyEvent.KEYCODE_MUTE))
        assertFalse(isTvPlaybackShortcutKey(KeyEvent.KEYCODE_BACK))
    }

    @Test
    fun `only select and media play pause are protected from repeat toggles`() {
        assertTrue(isTvPlaybackToggleKey(KeyEvent.KEYCODE_DPAD_CENTER))
        assertTrue(isTvPlaybackToggleKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertFalse(isTvPlaybackToggleKey(KeyEvent.KEYCODE_DPAD_LEFT))
        assertFalse(isTvPlaybackToggleKey(KeyEvent.KEYCODE_DPAD_UP))
    }

    @Test
    fun `all dpad directions remain navigation when playback overlay has focus`() {
        assertTrue(isTvOverlayNavigationKey(KeyEvent.KEYCODE_DPAD_LEFT))
        assertTrue(isTvOverlayNavigationKey(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertTrue(isTvOverlayNavigationKey(KeyEvent.KEYCODE_DPAD_UP))
        assertTrue(isTvOverlayNavigationKey(KeyEvent.KEYCODE_DPAD_DOWN))
        assertTrue(isTvOverlayNavigationKey(KeyEvent.KEYCODE_DPAD_CENTER))
        assertTrue(isTvOverlayNavigationKey(KeyEvent.KEYCODE_ENTER))
        assertFalse(isTvOverlayNavigationKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertFalse(isTvOverlayNavigationKey(KeyEvent.KEYCODE_MUTE))
    }

    @Test
    fun `remote navigation playback and channel keys wake the player controls`() {
        assertTrue(isTvControllerWakeKey(KeyEvent.KEYCODE_DPAD_LEFT))
        assertTrue(isTvControllerWakeKey(KeyEvent.KEYCODE_DPAD_CENTER))
        assertTrue(isTvControllerWakeKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
        assertTrue(isTvControllerWakeKey(KeyEvent.KEYCODE_CHANNEL_UP))
        assertTrue(isTvControllerWakeKey(KeyEvent.KEYCODE_CHANNEL_DOWN))
        assertTrue(isTvControllerWakeKey(KeyEvent.KEYCODE_PAGE_UP))
        assertTrue(isTvControllerWakeKey(KeyEvent.KEYCODE_PAGE_DOWN))
        assertTrue(isTvControllerWakeKey(KeyEvent.KEYCODE_MUTE))
    }

    @Test
    fun `channel digits accept remote and keypad number rows`() {
        assertTrue(isTvChannelDigitKey(KeyEvent.KEYCODE_0))
        assertTrue(isTvChannelDigitKey(KeyEvent.KEYCODE_9))
        assertTrue(isTvChannelDigitKey(KeyEvent.KEYCODE_NUMPAD_0))
        assertTrue(isTvChannelDigitKey(KeyEvent.KEYCODE_NUMPAD_9))
        assertFalse(isTvChannelDigitKey(KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals('0', tvChannelDigit(KeyEvent.KEYCODE_0))
        assertEquals('9', tvChannelDigit(KeyEvent.KEYCODE_9))
        assertEquals('0', tvChannelDigit(KeyEvent.KEYCODE_NUMPAD_0))
        assertEquals('9', tvChannelDigit(KeyEvent.KEYCODE_NUMPAD_9))
    }
}
