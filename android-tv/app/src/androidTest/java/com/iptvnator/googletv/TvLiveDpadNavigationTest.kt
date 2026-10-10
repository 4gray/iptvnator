package com.iptvnator.googletv

import android.content.Context
import android.os.SystemClock
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.playlist.TvPlaylist
import com.iptvnator.googletv.playlist.TvPlaylistRepository
import com.iptvnator.googletv.playlist.TvPlaylistStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvLiveDpadNavigationTest {
    private val databaseName = "iptvnator-live-dpad-test.db"
    private val playlistId = "live-dpad-fixture"
    private val channelCount = 28_281
    private lateinit var context: Context
    private lateinit var store: TvPlaylistStore
    private lateinit var repository: TvPlaylistRepository
    private lateinit var playlist: com.iptvnator.googletv.playlist.StoredPlaylist
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private lateinit var focusedGroupForAssertions: AtomicReference<String?>
    private lateinit var focusedChannelForAssertions: AtomicReference<String?>

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(databaseName)
        store = TvPlaylistStore(context, databaseName)
        val channels = (1..channelCount).map { number ->
            TvChannel(
                id = "channel-$number",
                name = "Fixture channel ${number.toString().padStart(3, '0')}",
                url = "http://127.0.0.1/live/$number.m3u8",
                group = "News",
                radio = number == channelCount,
                // Deliberately differs from playlist order to guard parity
                // with IPTVnator's 1-based numeric selection.
                channelNumber = channelCount + 1 - number,
            )
        }
        store.replacePlaylist(playlistId, TvPlaylist("DPAD Fixture", channels))
        repository = TvPlaylistRepository(store)
        playlist = repository.loadStored(catalogLimit = 100).single()
        assertEquals(100, playlist.channels.size)
        assertEquals(channelCount, repository.loadPlaylistCounts(playlistId).channels)
        assertEquals(1, repository.loadPlaylistCounts(playlistId).radio)
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        focusedGroupForAssertions = AtomicReference(null)
        focusedChannelForAssertions = AtomicReference(null)
        scenario = ActivityScenario.launch(MainActivity::class.java)
        val selectedChannel = AtomicReference<String?>(null)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    LiveContent(
                        playlists = listOf(playlist),
                        repository = repository,
                        sortPreferences = context.getSharedPreferences("live-dpad-test", Context.MODE_PRIVATE),
                        epgByChannel = emptyMap(),
                        favorites = emptyList(),
                        history = emptyList(),
                        onToggleFavorite = { _, _ -> },
                        onEditEpg = { _, _ -> },
                        onSaveHiddenGroups = { _, _ -> },
                        onPlay = { _, channel, _, _ -> selectedChannel.set(channel.name) },
                        onGroupFocusChanged = { group, focused ->
                            if (focused) focusedGroupForAssertions.set(group)
                            else if (focusedGroupForAssertions.get() == group) focusedGroupForAssertions.set(null)
                        },
                        onChannelFocusChanged = { channel, focused ->
                            if (focused) focusedChannelForAssertions.set(channel)
                            else if (focusedChannelForAssertions.get() == channel) focusedChannelForAssertions.set(null)
                        },
                    )
                }
            }
        }
        selectedChannelForAssertions = selectedChannel
    }

    private lateinit var selectedChannelForAssertions: AtomicReference<String?>

    @After
    fun tearDown() {
        if (::scenario.isInitialized) scenario.close()
        if (::store.isInitialized) {
            store.deletePlaylist(playlistId)
            store.close()
            context.deleteDatabase(databaseName)
        }
    }

    @Test
    fun dpadMovesFromFirstGroupToFirstChannelAndActivatesIt() {
        assertNotNull("The live group rail should render", device.wait(Until.findObject(By.text("Todos")), 5_000))
        assertNotNull(
            "The first channel should render",
            device.wait(Until.findObject(By.textContains("Fixture channel 001")), 5_000),
        )
        assertNotNull(
            "A provider-supplied channel number should take precedence over the row position",
            device.wait(
                Until.findObject(By.textContains("${channelCount}. Fixture channel 001")),
                5_000,
            ),
        )

        val groupFocusDeadline = SystemClock.elapsedRealtime() + 5_000L
        while (focusedGroupForAssertions.get() != "Todos" && SystemClock.elapsedRealtime() < groupFocusDeadline) {
            SystemClock.sleep(50)
        }
        assertEquals("Initial live-screen focus should settle on Todos", "Todos", focusedGroupForAssertions.get())
        device.pressDPadRight()
        val channelFocusDeadline = SystemClock.elapsedRealtime() + 5_000L
        while (focusedChannelForAssertions.get() == null && SystemClock.elapsedRealtime() < channelFocusDeadline) {
            SystemClock.sleep(50)
        }
        assertEquals("Right should move focus to the first live channel", "Fixture channel 001", focusedChannelForAssertions.get())
        device.pressDPadCenter()

        assertEquals("Fixture channel 001", selectedChannelForAssertions.get())
    }

    @Test
    fun dpadPagesA28280ChannelLiveCatalogWithoutLosingFocus() {
        assertNotNull(
            "The first channel should render",
            device.wait(Until.findObject(By.textContains("Fixture channel 001")), 5_000),
        )
        assertNotNull(
            "The Todos rail should show the complete TV count (excluding radio) rather than the first 100 loaded rows",
            device.wait(Until.findObject(By.text("28280")), 5_000),
        )
        device.pressDPadRight()
        repeat(105) { device.pressDPadDown() }
        device.pressDPadCenter()

        val selected = selectedChannelForAssertions.get()
        assertNotNull("DPAD should retain a selectable channel beyond the first 100 rows", selected)
        assertTrue(
            "The selected item should be past the first page: $selected",
            selected!!.substringAfterLast(' ').toInt() > 100,
        )
    }

    @Test
    fun liveSearchFindsChannelsByTheirGroup() {
        val databaseMatches = repository.searchChannels(playlistId, "News", limit = 5)
        assertEquals(5, databaseMatches.size)
        assertEquals("News", databaseMatches.first().group)
        // The channel search is a pill until OK switches the editor on, so
        // the TV keyboard never opens just by moving focus over it.
        device.wait(Until.findObject(By.desc("Buscar canal")), 5_000)?.click()
        val searchField = device.wait(Until.findObject(By.clazz("android.widget.EditText")), 5_000)
        assertNotNull("The live channel search field should be accessible", searchField)
        searchField.setText("News")
        val typedQuery = searchField.text
        device.pressEnter()

        val result = device.wait(Until.findObject(By.textContains("Fixture channel 001")), 5_000)
        assertNotNull(
            "A group-name search should still show channels whose names do not contain the query; " +
                "field=$typedQuery, visible=${device.findObjects(By.textContains("Fixture channel")).map { it.text }}, " +
                "headers=${device.findObjects(By.textContains("canales")).map { it.text }}",
            result,
        )
    }

    @Test
    fun numericRemoteSelectionUsesPlaylistPositionInsteadOfProviderNumber() {
        assertNotNull(
            "The first channel should render",
            device.wait(Until.findObject(By.textContains("Fixture channel 001")), 5_000),
        )
        device.pressDPadRight()
        device.pressKeyCode(android.view.KeyEvent.KEYCODE_1)

        val deadline = SystemClock.elapsedRealtime() + 4_000
        while (selectedChannelForAssertions.get() == null && SystemClock.elapsedRealtime() < deadline) {
            SystemClock.sleep(50)
        }
        assertEquals("Fixture channel 001", selectedChannelForAssertions.get())
    }
}
