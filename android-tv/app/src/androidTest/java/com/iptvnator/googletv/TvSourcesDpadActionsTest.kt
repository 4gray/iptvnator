package com.iptvnator.googletv

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.FocusRequester
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.playlist.StoredPlaylist
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvSourcesDpadActionsTest {
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private lateinit var firstSourceFocus: FocusRequester
    private val opened = AtomicReference<String?>(null)
    private val refreshed = AtomicReference<String?>(null)
    private val edited = AtomicReference<String?>(null)

    @Before
    fun setUp() {
        firstSourceFocus = FocusRequester()
        val playlist = StoredPlaylist(
            id = "sources-dpad-fixture",
            name = "Test source",
            sourceUrl = "https://example.invalid/list.m3u",
            channels = emptyList(),
        )
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    SourcesContent(
                        playlists = listOf(playlist),
                        customOrder = emptyList(),
                        busyPlaylistId = null,
                        statusMessage = null,
                        firstFocusRequester = firstSourceFocus,
                        onMoveCustom = { _, _ -> },
                        onOpen = { opened.set(it.id) },
                        onAdd = {},
                        onRefresh = { refreshed.set(it.id) },
                        onDelete = {},
                        onEdit = { edited.set(it.id) },
                        onRename = {},
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
    fun confirmingRefreshDoesNotOpenThePlaylistRow() {
        val source = device.wait(Until.findObject(By.text("Test source")), 5_000)
        requireNotNull(source) { "The source row should be visible and focused" }
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(firstSourceFocus.requestFocus()) }
        device.waitForIdle()
        require(focusAccepted.get()) { "Compose rejected the initial focus request" }

        device.pressDPadRight()
        device.waitForIdle()
        device.pressDPadCenter()
        device.waitForIdle()

        assertEquals("sources-dpad-fixture", refreshed.get())
        assertNull("Confirming a row action must not open its parent playlist", opened.get())
    }

    @Test
    fun confirmingEditDoesNotOpenThePlaylistRow() {
        val source = device.wait(Until.findObject(By.text("Test source")), 5_000)
        requireNotNull(source)
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(firstSourceFocus.requestFocus()) }
        device.waitForIdle()
        require(focusAccepted.get())

        repeat(4) {
            device.pressDPadRight()
            device.waitForIdle()
        }
        device.pressDPadCenter()
        device.waitForIdle()

        assertEquals("sources-dpad-fixture", edited.get())
        assertNull("Confirming Edit must not open its parent playlist", opened.get())
    }

    @Test
    fun movingPlaylistWithDpadSwitchesToCustomOrderAndReordersVisibleRows() {
        val focusRequester = FocusRequester()
        val playlists = listOf(
            StoredPlaylist(
                id = "old",
                name = "Old source",
                sourceUrl = "https://example.invalid/old.m3u",
                importedAtMs = 100L,
                channels = emptyList(),
            ),
            StoredPlaylist(
                id = "new",
                name = "New source",
                sourceUrl = "https://example.invalid/new.m3u",
                importedAtMs = 300L,
                channels = emptyList(),
            ),
        )
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    var customOrder by remember { mutableStateOf(listOf("new", "old")) }
                    SourcesContent(
                        playlists = playlists,
                        customOrder = customOrder,
                        busyPlaylistId = null,
                        statusMessage = null,
                        firstFocusRequester = focusRequester,
                        onMoveCustom = { id, delta ->
                            val order = customOrder.toMutableList()
                            val current = order.indexOf(id)
                            val target = (current + delta).coerceIn(order.indices)
                            if (current >= 0 && current != target) {
                                order.removeAt(current)
                                order.add(target, id)
                                customOrder = order
                            }
                        },
                        onOpen = {},
                        onAdd = {},
                        onRefresh = {},
                        onDelete = {},
                        onEdit = {},
                        onRename = {},
                    )
                }
            }
        }
        val firstRow = device.wait(Until.findObject(By.text("New source")), 5_000)
        requireNotNull(firstRow) { "The most recently added source should be first by default" }
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(focusRequester.requestFocus()) }
        device.waitForIdle()
        require(focusAccepted.get())

        // The row's action order is refresh, move up, move down, edit...
        repeat(3) {
            device.pressDPadRight()
            device.waitForIdle()
        }
        device.pressDPadCenter()
        device.waitForIdle()

        val deadline = android.os.SystemClock.elapsedRealtime() + 5_000L
        var oldTop = Int.MAX_VALUE
        var newTop = Int.MAX_VALUE
        while (android.os.SystemClock.elapsedRealtime() < deadline && oldTop >= newTop) {
            oldTop = device.findObject(By.text("Old source"))?.visibleBounds?.top ?: Int.MAX_VALUE
            newTop = device.findObject(By.text("New source"))?.visibleBounds?.top ?: Int.MAX_VALUE
            if (oldTop >= newTop) Thread.sleep(50)
        }
        assertTrue("Moving a row should switch from date sorting and apply the custom order", oldTop < newTop)
    }
}
