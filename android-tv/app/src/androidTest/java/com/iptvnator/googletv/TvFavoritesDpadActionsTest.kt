package com.iptvnator.googletv

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.focus.FocusRequester
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.playlist.TvSavedItem
import com.iptvnator.googletv.playlist.TvSavedItemType
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvFavoritesDpadActionsTest {
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private lateinit var firstItemFocus: FocusRequester
    private val opened = AtomicReference<String?>(null)
    private val removed = AtomicReference<String?>(null)
    private val moved = AtomicReference<Pair<String, Int>?>(null)
    private val epgMapped = AtomicReference<String?>(null)

    @Before
    fun setUp() {
        firstItemFocus = FocusRequester()
        val favorite = TvSavedItem(
            playlistId = "favorite-fixture-source",
            itemType = TvSavedItemType.CHANNEL,
            itemKey = "favorite-fixture-channel",
            title = "Favorite fixture",
            uri = "https://example.invalid/live.m3u8",
            coverUrl = null,
            savedAt = 1L,
            lastPlayedAt = null,
            isFavorite = true,
        )
        val secondFavorite = favorite.copy(itemKey = "second-favorite-channel", title = "Second favorite")
        val favorites = listOf(favorite, secondFavorite)
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    TvSavedItemRail(
                        items = favorites,
                        playlistNames = mapOf(favorite.playlistId to "Test playlist"),
                        onItemClick = { opened.set(favorites[it].itemKey) },
                        onRemoveItem = { removed.set(favorites[it].itemKey) },
                        onMoveItem = { index, delta -> moved.set(favorites[index].itemKey to delta) },
                        onEditEpg = { epgMapped.set(favorites[it].itemKey) },
                        initialFocusRequester = firstItemFocus,
                    )
                }
            }
        }
    }

    @After
    fun tearDown() {
        if (::scenario.isInitialized) scenario.close()
    }

    @Test
    fun starActionRemovesFavoriteWithoutOpeningTheChannel() {
        val item = device.wait(Until.findObject(By.text("Favorite fixture")), 5_000)
        requireNotNull(item) { "The favorite card should be visible" }
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(firstItemFocus.requestFocus()) }
        device.waitForIdle()
        require(focusAccepted.get()) { "Compose rejected the initial favorite focus request" }

        device.pressDPadRight()
        device.waitForIdle()
        device.pressDPadCenter()
        device.waitForIdle()

        assertEquals("favorite-fixture-channel", removed.get())
        assertNull("Confirming the star must not open its parent favorite card", opened.get())

        device.pressDPadLeft()
        device.waitForIdle()
        device.pressDPadCenter()
        device.waitForIdle()
        assertEquals("favorite-fixture-channel", opened.get())
    }

    @Test
    fun dpadDownActionReordersFavoriteWithoutOpeningIt() {
        val item = device.wait(Until.findObject(By.text("Favorite fixture")), 5_000)
        requireNotNull(item) { "The favorite card should be visible" }
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(firstItemFocus.requestFocus()) }
        device.waitForIdle()
        require(focusAccepted.get()) { "Compose rejected the initial favorite focus request" }

        repeat(3) {
            device.pressDPadRight()
            device.waitForIdle()
        }
        device.pressDPadCenter()
        device.waitForIdle()

        assertEquals("favorite-fixture-channel" to 1, moved.get())
        assertNull("Reordering must not open the favorite card", opened.get())
    }

    @Test
    fun epgActionOpensMappingWithoutOpeningTheChannel() {
        val item = device.wait(Until.findObject(By.text("Favorite fixture")), 5_000)
        requireNotNull(item) { "The favorite card should be visible" }
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(firstItemFocus.requestFocus()) }
        device.waitForIdle()
        require(focusAccepted.get()) { "Compose rejected the initial favorite focus request" }

        repeat(4) {
            device.pressDPadRight()
            device.waitForIdle()
        }
        device.pressDPadCenter()
        device.waitForIdle()

        assertEquals("favorite-fixture-channel", epgMapped.get())
        assertNull("The EPG action must not start live playback", opened.get())
    }
}
