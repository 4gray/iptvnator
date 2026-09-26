package com.iptvnator.googletv

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.runtime.mutableStateOf
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import android.content.Context
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.playlist.TvPlaylist
import com.iptvnator.googletv.playlist.TvPlaylistRepository
import com.iptvnator.googletv.playlist.TvPlaylistStore
import com.iptvnator.googletv.epg.TvEpgEntry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvLiveRowActionDpadTest {
    private val databaseName = "iptvnator-live-row-actions-test.db"
    private val playlistId = "live-row-actions-fixture"
    private lateinit var context: Context
    private lateinit var store: TvPlaylistStore
    private lateinit var firstGroupFocusRequester: FocusRequester
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private val favoriteAction = AtomicReference<Boolean?>(null)
    private val favoriteActionCount = AtomicInteger(0)
    private val epgAction = AtomicReference<String?>(null)
    private val epgActionCount = AtomicInteger(0)
    private val playedChannel = AtomicReference<String?>(null)
    private val epgSnapshot = mutableStateOf<Map<String, List<TvEpgEntry>>>(emptyMap())

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(databaseName)
        store = TvPlaylistStore(context, databaseName)
        store.replacePlaylist(
            playlistId,
            TvPlaylist(
                "Live row action fixture",
                listOf(
                    TvChannel(
                        id = "live-row-action-channel",
                        name = "Live row action fixture channel",
                        url = "https://example.invalid/live.m3u8",
                        group = "News",
                    ),
                ),
            ),
        )
        val repository = TvPlaylistRepository(store)
        val playlist = repository.loadStored().single()
        firstGroupFocusRequester = FocusRequester()
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    LiveContent(
                        playlists = listOf(playlist),
                        repository = repository,
                        sortPreferences = context.getSharedPreferences("live-row-actions-test", Context.MODE_PRIVATE),
                        initialFocusRequester = firstGroupFocusRequester,
                        epgByChannel = epgSnapshot.value,
                        favorites = emptyList(),
                        history = emptyList(),
                        onToggleFavorite = { _, selected ->
                            favoriteActionCount.incrementAndGet()
                            favoriteAction.set(selected)
                        },
                        onEditEpg = { _, channel ->
                            epgActionCount.incrementAndGet()
                            epgAction.set(channel.id)
                        },
                        onSaveHiddenGroups = { _, _ -> },
                        onPlay = { _, channel, _, _ -> playedChannel.set(channel.id) },
                    )
                }
            }
        }
    }

    @After
    fun tearDown() {
        if (::scenario.isInitialized) scenario.close()
        if (::store.isInitialized) {
            store.deletePlaylist(playlistId)
            store.close()
            context.deleteDatabase(databaseName)
        }
    }

    private fun focusFirstGroup() {
        assertTrue("The live group rail should render", device.wait(Until.hasObject(By.text("Todos")), 5_000))
        assertTrue("The channel row should render", device.wait(Until.hasObject(By.textContains("Live row action fixture channel")), 5_000))
        val accepted = AtomicReference(false)
        scenario.onActivity { accepted.set(firstGroupFocusRequester.requestFocus()) }
        device.waitForIdle()
        assertTrue("Compose should accept focus on Todos", accepted.get())
    }

    @Test
    fun liveRowsShowOneBasedNumbersWhenThePlaylistHasNoChannelNumber() {
        assertTrue(
            "The first row should show its sequential number, matching the original groups view",
            device.wait(Until.hasObject(By.text("1. Live row action fixture channel")), 5_000),
        )
    }

    @Test
    fun liveRowsDoNotReserveAnEpgLineWhenNoGuideIsConfigured() {
        assertNull(
            "A plain M3U without XMLTV should use the compact row treatment from the original app",
            device.findObject(By.text("No hay información de programa")),
        )
    }

    @Test
    fun liveRowsShowCurrentProgrammeWhenTheGuideHasData() {
        val now = System.currentTimeMillis()
        epgSnapshot.value = mapOf(
            "$playlistId:live-row-action-channel" to listOf(
                TvEpgEntry("live-row-action-channel", now - 60_000L, now + 60_000L, "Current fixture programme"),
            ),
        )

        assertTrue(
            "A loaded guide should show its programme in the live row",
            device.wait(Until.hasObject(By.text("Current fixture programme")), 5_000),
        )
    }

    @Test
    fun favoriteSelectDoesNotBubbleToTheParentChannelCard() {
        focusFirstGroup()
        device.pressDPadRight() // first channel card
        device.pressDPadRight() // EPG action
        device.pressDPadRight() // favorite action
        device.pressDPadCenter()
        device.waitForIdle()

        assertEquals(true, favoriteAction.get())
        assertEquals("One OK should toggle the favorite once", 1, favoriteActionCount.get())
        assertNull("Selecting the favorite star must not start playback", playedChannel.get())
    }

    @Test
    fun epgSelectDoesNotBubbleToTheParentChannelCard() {
        focusFirstGroup()
        device.pressDPadRight() // first channel card
        device.pressDPadRight() // EPG action
        device.pressDPadCenter()
        device.waitForIdle()

        assertEquals("live-row-action-channel", epgAction.get())
        assertEquals("One OK should open EPG once", 1, epgActionCount.get())
        assertNull("Selecting EPG must not start playback", playedChannel.get())
    }
}
