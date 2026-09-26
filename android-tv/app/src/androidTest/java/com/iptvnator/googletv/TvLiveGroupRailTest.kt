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
import android.os.SystemClock
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.playlist.TvPlaylist
import com.iptvnator.googletv.playlist.TvPlaylistRepository
import com.iptvnator.googletv.playlist.TvPlaylistStore
import com.iptvnator.googletv.playlist.StoredPlaylist
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvLiveGroupRailTest {
    private val databaseName = "iptvnator-live-group-rail-test.db"
    private val playlistId = "live-group-rail-fixture"
    private lateinit var context: Context
    private lateinit var store: TvPlaylistStore
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private lateinit var repository: TvPlaylistRepository
    private lateinit var playlist: StoredPlaylist
    private lateinit var playedChannel: AtomicReference<String?>
    private lateinit var focusedGroup: AtomicReference<String?>
    private lateinit var focusedChannel: AtomicReference<String?>
    private lateinit var savedHiddenGroups: AtomicReference<List<String>>

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(databaseName)
        context.getSharedPreferences("live-group-rail-test", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        store = TvPlaylistStore(context, databaseName)
        store.replacePlaylist(
            playlistId,
            TvPlaylist(
                "Group rail fixture",
                (1..500).map { number ->
                    TvChannel(
                        id = "group-channel-$number",
                        name = "Channel $number",
                        url = "http://127.0.0.1/live/$number.ts",
                        group = if (number <= 100) {
                            "ZZ Seed"
                        } else {
                            "Group ${((number - 101) % 10 + 1).toString().padStart(3, '0')}"
                        },
                    )
                },
            ),
        )
        repository = TvPlaylistRepository(store)
        playlist = repository.loadStored(catalogLimit = 100).single()
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        playedChannel = AtomicReference(null)
        focusedGroup = AtomicReference(null)
        focusedChannel = AtomicReference(null)
        savedHiddenGroups = AtomicReference(emptyList())
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    LiveContent(
                        playlists = listOf(playlist),
                        repository = repository,
                        sortPreferences = context.getSharedPreferences("live-group-rail-test", Context.MODE_PRIVATE),
                        epgByChannel = emptyMap(),
                        favorites = emptyList(),
                        history = emptyList(),
                        onToggleFavorite = { _, _ -> },
                        onEditEpg = { _, _ -> },
                        onSaveHiddenGroups = { _, hidden -> savedHiddenGroups.set(hidden) },
                        onPlay = { _, channel, _, _ -> playedChannel.set(channel.name) },
                        onGroupFocusChanged = { group, focused ->
                            if (focused) focusedGroup.set(group)
                            else if (focusedGroup.get() == group) focusedGroup.set(null)
                        },
                        onChannelFocusChanged = { channel, focused ->
                            if (focused) focusedChannel.set(channel)
                            else if (focusedChannel.get() == channel) focusedChannel.set(null)
                        },
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

    @Test
    fun groupPageLoadsChannelsOutsideTheInitialCatalogWindow() {
        val outsideInitialWindow = store.getChannelGroupPage(
            playlistId = playlistId,
            groupName = "Group 001",
            offset = 0,
            limit = 500,
            radioOnly = false,
        )
        assertNotNull(outsideInitialWindow.firstOrNull { it.id == "group-channel-101" })
        assertNotNull("The group rail should open with focus on Todos", device.wait(Until.findObject(By.text("Todos")), 5_000))
        assertNotNull("The channel list should render", device.wait(Until.findObject(By.text("1. Channel 1")), 5_000))

        // Channel 101 is outside the first 100 rows loaded into the initial
        // catalogue. The server order keeps ZZ Seed first, then Group 001.
        repeat(4) { device.pressDPadDown() }
        device.waitForIdle(1_000)
        val selectedGroup = device.findObject(By.text("Group 001"))
        assertNotNull("The first provider group should be reachable by D-pad", selectedGroup)
        assertEquals("D-pad should focus the selected provider group", "Group 001", focusedGroup.get())
        device.pressDPadCenter()
        assertEquals(
            "Loading the selected group's page must not steal focus to Todos",
            "Group 001",
            focusedGroup.get(),
        )

        // Send RIGHT immediately after selecting a group: its SQLite page is
        // asynchronous, so the focus transfer must be retained until the
        // first channel card is attached rather than silently dropped.
        device.pressDPadRight()
        val focusDeadline = SystemClock.elapsedRealtime() + 5_000
        while (focusedChannel.get() == null && SystemClock.elapsedRealtime() < focusDeadline) {
            SystemClock.sleep(50)
        }
        val channelBeforeActivation = focusedChannel.get()
        assertNotNull("Right should focus a channel in the selected group", channelBeforeActivation)
        device.pressDPadCenter()
        val activationDeadline = SystemClock.elapsedRealtime() + 5_000
        while (playedChannel.get() == null && SystemClock.elapsedRealtime() < activationDeadline) {
            SystemClock.sleep(50)
        }
        assertEquals("OK should activate the focused channel", channelBeforeActivation, playedChannel.get())
    }

    @Test
    fun groupRailSearchFiltersGroupsWithTheRemote() {
        assertNotNull("The group rail should open with Todos focused", device.wait(Until.findObject(By.text("Todos")), 5_000))
        device.pressDPadUp()
        assertNotNull(
            "The original category search affordance should be reachable from the first group",
            device.wait(Until.findObject(By.desc("Buscar grupos")), 3_000),
        )
        device.pressDPadCenter()

        val groupSearch = device.wait(
            Until.findObject(
                By.clazz("android.widget.EditText").hasDescendant(By.desc("Buscar grupos")),
            ),
            3_000,
        )
        assertNotNull("The group search field should receive focus", groupSearch)
        val focusDeadline = SystemClock.elapsedRealtime() + 3_000
        while (groupSearch?.isFocused != true && SystemClock.elapsedRealtime() < focusDeadline) {
            SystemClock.sleep(25)
        }
        assertTrue("The group search editor should own input focus before text entry", groupSearch?.isFocused == true)
        groupSearch.setText("Group 007")
        val queryDeadline = SystemClock.elapsedRealtime() + 3_000
        while (groupSearch?.text != "Group 007" && SystemClock.elapsedRealtime() < queryDeadline) {
            SystemClock.sleep(25)
        }
        assertEquals("The focused search editor should accept the complete query", "Group 007", groupSearch?.text)

        device.pressBack() // Dismiss the TV keyboard while keeping the group filter open.
        device.waitForIdle(500)
        device.pressDPadDown()
        val matchingGroupDeadline = SystemClock.elapsedRealtime() + 3_000
        while (focusedGroup.get() != "Group 007" && SystemClock.elapsedRealtime() < matchingGroupDeadline) {
            SystemClock.sleep(25)
        }
        assertEquals("The filtered rail should focus its sole matching group", "Group 007", focusedGroup.get())
        device.pressDPadUp() // Return to the group search field.
        device.pressBack() // Returning to the editor opens the keyboard again.
        device.pressDPadRight()
        device.pressDPadCenter()
        val restoredGroup = device.wait(Until.findObject(By.text("Group 001")), 3_000)
        assertNotNull(
            "Closing search with the remote should clear the query and restore all categories",
            restoredGroup,
        )
        assertNotNull("Closing search should restore focus to its heading action", device.wait(
            Until.findObject(By.desc("Buscar grupos")), 3_000,
        ))
        device.pressDPadCenter()
        val reopenedGroupSearch = device.wait(
            Until.findObject(
                By.clazz("android.widget.EditText").hasDescendant(By.desc("Buscar grupos")),
            ),
            3_000,
        )
        assertNotNull("The restored heading focus should reopen search with the remote", reopenedGroupSearch)
        reopenedGroupSearch.setText("No matching group")
        val noMatchDeadline = SystemClock.elapsedRealtime() + 3_000
        while (reopenedGroupSearch.text != "No matching group" && SystemClock.elapsedRealtime() < noMatchDeadline) {
            SystemClock.sleep(25)
        }
        assertEquals("The group search should accept a no-match query", "No matching group", reopenedGroupSearch.text)
        device.pressBack()
        device.waitForIdle(500)
        device.pressDPadDown()
        device.pressDPadCenter()
        assertNotNull(
            "Down from an empty group search should reach Close and restore the categories",
            device.wait(Until.findObject(By.text("Group 001")), 3_000),
        )
    }

    @Test
    fun categorySortMenuOrdersProviderGroupsAndPersistsSelectionWithDpad() {
        val preferences = context.getSharedPreferences("live-group-rail-test", Context.MODE_PRIVATE)
        assertNotNull("The first category should receive initial focus", device.wait(Until.findObject(By.text("Todos")), 5_000))

        device.pressDPadUp()
        device.waitForIdle(500)
        device.pressDPadRight()
        device.waitForIdle(500)
        val initialSortAction = device.wait(Until.findObject(By.descContains("Orden de grupos")), 3_000)
        assertNotNull(
            "The category sort action should be reachable next to search",
            initialSortAction,
        )
        device.pressDPadCenter()
        val providerOrderChoice = device.wait(Until.findObject(By.descContains("Orden del proveedor")), 3_000)
        assertNotNull("The provider-order choice should be visible", providerOrderChoice)
        assertNotNull("The ascending choice should be visible", device.findObject(By.descContains("Nombre A-Z")))
        assertNotNull("The descending choice should be visible", device.findObject(By.descContains("Nombre Z-A")))
        assertNotNull("The default provider-order choice should be highlighted", device.wait(
            Until.findObject(By.desc("Orden del proveedor, resaltado")), 3_000,
        ))

        device.pressDPadDown()
        SystemClock.sleep(150)
        val highlightedAfterDown = device.findObjects(By.descContains("resaltado")).map { it.contentDescription }
        device.pressDPadCenter()
        assertEquals(
            "D-pad down and center should select ascending order; highlighted=$highlightedAfterDown",
            "name-asc",
            preferences.getString(TV_CATEGORY_SORT_PREFERENCE_KEY, null),
        )
        assertNotNull("The selected sort label should update", device.wait(
            Until.findObject(By.desc("Orden de grupos: Nombre A-Z")), 3_000,
        ))
        device.waitForIdle(500)
        device.pressDPadDown() // Todos
        assertEquals("Closing the sort menu should return focus to its heading action", "Todos", focusedGroup.get())
        repeat(3) { device.pressDPadDown() }
        assertEquals("A-Z should put the first naturally sorted provider group first", "Group 001", focusedGroup.get())

        repeat(3) {
            device.pressDPadUp()
            device.waitForIdle(250)
        } // Back to Todos.
        device.pressDPadUp() // Search heading action.
        device.waitForIdle(250)
        device.pressDPadRight() // Sort action.
        device.waitForIdle(500)
        assertNotNull("The category sort action should regain D-pad access", device.findObject(By.descContains("Orden de grupos")))
        device.pressDPadCenter()
        val reopenedDescendingChoice = device.wait(Until.findObject(By.descContains("Nombre Z-A")), 3_000)
        assertNotNull("The descending choice should be reachable again", reopenedDescendingChoice)
        assertNotNull("The sort dialog should focus its currently selected option", device.wait(
            Until.findObject(By.desc("Nombre A-Z, resaltado")), 3_000,
        ))
        device.pressDPadDown()
        device.pressDPadCenter()
        assertEquals("name-desc", preferences.getString(TV_CATEGORY_SORT_PREFERENCE_KEY, null))
        device.waitForIdle(500)
        val focusedBeforeReturningToTodos = device.findObject(By.focused(true))?.let { focused ->
            "text=${focused.text}, description=${focused.contentDescription}"
        }
        device.pressDPadDown() // Todos
        val todosDeadline = SystemClock.elapsedRealtime() + 3_000L
        while (focusedGroup.get() != "Todos" && SystemClock.elapsedRealtime() < todosDeadline) {
            SystemClock.sleep(25)
        }
        assertEquals(
            "Closing the descending sort menu should return focus to Todos; before D-pad down=$focusedBeforeReturningToTodos",
            "Todos",
            focusedGroup.get(),
        )
        repeat(3) {
            val previousGroup = focusedGroup.get()
            device.pressDPadDown()
            val nextGroupDeadline = SystemClock.elapsedRealtime() + 3_000L
            while ((focusedGroup.get() == null || focusedGroup.get() == previousGroup) &&
                SystemClock.elapsedRealtime() < nextGroupDeadline
            ) {
                SystemClock.sleep(25)
            }
        }
        assertEquals("Z-A should put the last naturally sorted provider group first", "ZZ Seed", focusedGroup.get())
    }

    @Test
    fun manageGroupsCanHideAllGroupsWithDpad() {
        assertNotNull("Group management should be available", device.wait(Until.findObject(By.text("Gestionar")), 5_000))
        device.findObject(By.text("Gestionar")).click()
        assertNotNull("Group-management dialog should open", device.wait(Until.findObject(By.text("Buscar grupos")), 5_000))
        assertNotNull("All eleven groups should initially be visible", device.wait(Until.findObject(By.text("11 / 11")), 5_000))

        // The dialog places initial D-pad focus on Show all. Move right to
        // Hide all and activate it with the remote, then verify the committed
        // state rather than relying on transient UI text semantics.
        device.pressDPadRight()
        device.pressDPadCenter()
        device.findObject(By.text("Guardar")).click()
        assertEquals(
            (1..10).map { "Group ${it.toString().padStart(3, '0')}" }.toSet() + "ZZ Seed",
            savedHiddenGroups.get().toSet(),
        )
    }

    @Test
    fun manageGroupsCanHideOneGroupWithDpad() {
        assertNotNull("Group management should be available", device.wait(Until.findObject(By.text("Gestionar")), 5_000))
        device.findObject(By.text("Gestionar")).click()
        assertNotNull("Group-management dialog should open", device.wait(Until.findObject(By.text("Buscar grupos")), 5_000))

        // Move from the bulk controls, through search, to the first group.
        device.pressDPadDown()
        device.pressDPadDown()
        val firstGroup = device.wait(Until.findObject(By.text("Group 001")), 3_000)
        assertNotNull("The first group should be reachable using the remote", firstGroup)
        device.pressDPadCenter()
        device.findObject(By.text("Guardar")).click()
        assertEquals(listOf("Group 001"), savedHiddenGroups.get())
    }

    @Test
    fun playbackFromGlobalLiveListCapturesSourceBlockOrderForChannelZapping() {
        val firstSourceId = "live-global-zap-first"
        val secondSourceId = "live-global-zap-second"
        val firstChannel = TvChannel(
            id = "global-zap-first-channel",
            name = "Global first source channel",
            url = "http://127.0.0.1/live/global-first.ts",
            group = "ZZ Seed",
        )
        val secondChannel = TvChannel(
            id = "global-zap-second-channel",
            name = "Global second source channel",
            url = "http://127.0.0.1/live/global-second.ts",
            group = "ZZ Seed",
        )
        val firstSource = playlist.copy(
            id = firstSourceId,
            name = "Global first source",
            channels = listOf(firstChannel),
        )
        val secondSource = playlist.copy(
            id = secondSourceId,
            name = "Global second source",
            channels = listOf(secondChannel),
        )
        val selectedOwner = AtomicReference<String?>()
        val selectedQueue = AtomicReference<List<Pair<String, String>>>()
        val selectedScope = AtomicReference<TvChannelZapScope?>()

        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    LiveContent(
                        playlists = listOf(firstSource, secondSource),
                        repository = repository,
                        sortPreferences = context.getSharedPreferences("live-group-rail-test", Context.MODE_PRIVATE),
                        epgByChannel = emptyMap(),
                        favorites = emptyList(),
                        history = emptyList(),
                        onToggleFavorite = { _, _ -> },
                        onEditEpg = { _, _ -> },
                        onSaveHiddenGroups = { _, _ -> },
                        onPlay = { owner, _, queue, zapScope ->
                            selectedOwner.set(owner)
                            selectedQueue.set(queue.map { (sourceId, channel) -> sourceId to channel.id })
                            selectedScope.set(zapScope)
                        },
                    )
                }
            }
        }

        val secondSourceRow = device.wait(Until.findObject(By.textContains(secondChannel.name)), 10_000)
        assertNotNull("The global live list should render the second source's channel", secondSourceRow)
        val capture = java.io.File(
            InstrumentationRegistry.getInstrumentation().targetContext.externalCacheDir,
            "live-global-zap-scope.png",
        )
        assertTrue("The combined live-source order should be capturable", device.takeScreenshot(capture))
        val rowBounds = secondSourceRow.visibleBounds
        device.click(rowBounds.centerX(), rowBounds.centerY())
        device.waitForIdle()

        assertEquals(secondSourceId, selectedOwner.get())
        assertEquals(
            listOf(firstSourceId to firstChannel.id, secondSourceId to secondChannel.id),
            selectedQueue.get(),
        )
        assertEquals(TvChannelZapOrder.SOURCE, selectedScope.get()?.order)
        assertEquals(listOf(firstSourceId, secondSourceId), selectedScope.get()?.playlistOrder)
    }
}
