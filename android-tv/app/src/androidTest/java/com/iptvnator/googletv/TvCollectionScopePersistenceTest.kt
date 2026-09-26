package com.iptvnator.googletv

import android.content.SharedPreferences
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvCollectionScopePersistenceTest {
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private lateinit var preferences: SharedPreferences
    private var previousFavoritesScope: String? = null
    private var previousRecentScope: String? = null

    private val currentPlaylistId = "scope-current-playlist"
    private val otherPlaylistId = "scope-other-playlist"
    private val currentFavorite = TvSavedItem(
        playlistId = currentPlaylistId,
        itemType = TvSavedItemType.CHANNEL,
        itemKey = "scope-current-favorite",
        title = "Current playlist favorite fixture",
        uri = "https://example.invalid/current-favorite.m3u8",
        coverUrl = null,
        savedAt = 1L,
        lastPlayedAt = null,
        isFavorite = true,
    )
    private val otherFavorite = currentFavorite.copy(
        playlistId = otherPlaylistId,
        itemKey = "scope-other-favorite",
        title = "Other playlist favorite fixture",
    )
    private val currentRecent = currentFavorite.copy(
        itemKey = "scope-current-recent",
        title = "Current playlist recent fixture",
        isFavorite = false,
        lastPlayedAt = 2L,
    )
    private val otherRecent = currentRecent.copy(
        playlistId = otherPlaylistId,
        itemKey = "scope-other-recent",
        title = "Other playlist recent fixture",
    )

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        preferences = context.getSharedPreferences("iptvnator-tv-ui", android.content.Context.MODE_PRIVATE)
        previousFavoritesScope = preferences.getString("collection-scope-favorites", null)
        previousRecentScope = preferences.getString("collection-scope-recent", null)
        preferences.edit()
            .putString("collection-scope-favorites", "playlist")
            .putString("collection-scope-recent", "playlist")
            .apply()
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }

    @After
    fun tearDown() {
        if (::scenario.isInitialized) scenario.close()
        preferences.edit().apply {
            if (previousFavoritesScope == null) remove("collection-scope-favorites")
            else putString("collection-scope-favorites", previousFavoritesScope)
            if (previousRecentScope == null) remove("collection-scope-recent")
            else putString("collection-scope-recent", previousRecentScope)
        }.apply()
    }

    @Test
    fun favoritesAndRecentScopesPersistIndependentlyAcrossViewRecreation() {
        showFavorites()
        assertNotNull("Favorites should initially be limited to the selected playlist", waitFor(currentFavorite.title))
        assertHidden("The other playlist's favorite should initially be hidden", otherFavorite.title)

        device.findObject(By.text("Todas las playlists")).click()
        assertNotNull("Selecting all playlists should reveal the other favorite", waitFor(otherFavorite.title))
        assertEquals("all", preferences.getString("collection-scope-favorites", null))
        assertEquals("Recent scope must remain independent", "playlist", preferences.getString("collection-scope-recent", null))

        showFavorites()
        assertNotNull("Favorites scope should survive leaving and reopening the view", waitFor(otherFavorite.title))

        showRecent(history = emptyList())
        assertNotNull("Recent should default to this playlist", device.wait(Until.findObject(By.text("Esta playlist")), 5_000))
        activateRecentScopeWithDpad(moveRight = true)
        assertEquals("Recent should persist All after remote activation", "all", preferences.getString("collection-scope-recent", null))

        showRecent()
        assertNotNull("All scope should include the current playlist", waitFor(currentRecent.title))
        assertNotNull("Selecting all playlists should reveal the other recent item", waitFor(otherRecent.title))

        showRecent(history = emptyList())
        assertNotNull("The selected all-sources state should be restored", device.wait(Until.findObject(By.text("Todas las playlists")), 5_000))
        activateRecentScopeWithDpad()
        assertEquals("Recent should persist Playlist after remote activation", "playlist", preferences.getString("collection-scope-recent", null))
        showRecent()
        assertNotNull("Playlist scope should retain the selected source's item", waitFor(currentRecent.title))
        assertHidden("Playlist scope should exclude other sources after reopening", otherRecent.title)

        showFavorites()
        assertNotNull("Changing Recent scope must not reset Favorites scope", waitFor(otherFavorite.title))

        showRecent(selectedPlaylistId = null)
        assertHidden("The playlist scope option should be hidden when no playlist is selected", "Esta playlist")
        assertHidden("The all-playlists scope option should be hidden when no playlist is selected", "Todas las playlists")
        assertNotNull("With no selected playlist, Recent should continue showing all sources", waitFor(otherRecent.title))
    }

    @Test
    fun recentSectionSearchFiltersTitlesWithoutLeavingTheCurrentPlaylistScope() {
        val matchingCurrentItem = currentRecent.copy(
            itemKey = "recent-search-match",
            title = "Canal Alfa",
        )
        val nonMatchingCurrentItem = currentRecent.copy(
            itemKey = "recent-search-no-match",
            title = "Canal Beta",
        )
        val matchingOtherPlaylistItem = otherRecent.copy(
            itemKey = "recent-search-other-playlist",
            title = "Canal Alfa en otra playlist",
        )

        showRecent(
            history = listOf(matchingCurrentItem, nonMatchingCurrentItem, matchingOtherPlaylistItem),
            searchQuery = " aLfA ",
        )

        assertNotNull("Recent's local filter should match titles case-insensitively", waitFor(matchingCurrentItem.title))
        assertHidden("Recent's local filter should hide nonmatching titles", nonMatchingCurrentItem.title)
        assertHidden("Filtering must still respect the selected-playlist scope", matchingOtherPlaylistItem.title)
    }

    @Test
    fun recentPlaybackCapturesTheVisibleCrossPlaylistChannelOrder() {
        val first = currentRecent.copy(itemKey = "zap-recent-first", title = "Zap recent first")
        val vod = currentRecent.copy(
            itemType = TvSavedItemType.VOD,
            itemKey = "zap-recent-vod",
            title = "Zap recent movie",
        )
        val second = otherRecent.copy(itemKey = "zap-recent-second", title = "Zap recent second")
        val third = currentRecent.copy(itemKey = "zap-recent-third", title = "Zap recent third")
        val clicked = AtomicReference<TvSavedItem?>()
        val capturedQueue = AtomicReference<List<TvChannelZapEntry>>()

        showRecent(
            selectedPlaylistId = null,
            history = listOf(first, vod, second, third),
            onItemClick = { item, queue ->
                clicked.set(item)
                capturedQueue.set(queue)
            },
        )

        val row = device.wait(Until.findObject(By.text(second.title)), 5_000)
        assertNotNull("The cross-playlist recent row should be visible", row)
        row.click()
        device.waitForIdle()

        assertEquals(second.itemKey, clicked.get()?.itemKey)
        assertEquals(
            listOf(
                TvChannelZapEntry(first.playlistId, first.itemKey),
                TvChannelZapEntry(second.playlistId, second.itemKey),
                TvChannelZapEntry(third.playlistId, third.itemKey),
            ),
            capturedQueue.get(),
        )
    }

    @Test
    fun dpadCanReachRecentHistoryBeyondThePreviousHundredItemCap() {
        val history = (1..125).map { index ->
            currentRecent.copy(
                itemKey = "long-history-$index",
                title = "Long history fixture $index",
                lastPlayedAt = index.toLong(),
            )
        }
        showRecent(selectedPlaylistId = null, history = history)
        assertNotNull("The first history row should be visible", waitFor(history.first().title))
        Thread.sleep(250)
        device.waitForIdle()

        repeat(history.lastIndex) {
            device.pressDPadDown()
            device.waitForIdle()
        }

        assertNotNull("The final row beyond the previous 100-item storage cap should be reachable by remote", waitFor(history.last().title))
        val capture = java.io.File(
            InstrumentationRegistry.getInstrumentation().targetContext.externalCacheDir,
            "recent-history-beyond-100.png",
        )
        assertTrue("The reached end of the long history should be capturable", device.takeScreenshot(capture))
    }

    private fun showFavorites() {
        val focusRequester = FocusRequester()
        val compositionIdentity = Any()
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    key(compositionIdentity) {
                        FavoritesContent(
                            favorites = listOf(currentFavorite, otherFavorite),
                            playlistNames = mapOf(currentPlaylistId to "Current", otherPlaylistId to "Other"),
                            selectedPlaylistId = currentPlaylistId,
                            searchQuery = remember { mutableStateOf("") },
                            initialFocusRequester = focusRequester,
                            onRemoveFavorite = {},
                            onClearFavorites = { _, _ -> },
                            onFavoriteClick = { _, _ -> },
                        )
                    }
                }
            }
        }
        device.waitForIdle()
    }

    private fun showRecent(
        selectedPlaylistId: String? = currentPlaylistId,
        history: List<TvSavedItem> = listOf(currentRecent, otherRecent),
        searchQuery: String = "",
        onItemClick: (TvSavedItem, List<TvChannelZapEntry>) -> Unit = { _, _ -> },
    ) {
        val focusRequester = FocusRequester()
        val compositionIdentity = Any()
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    key(compositionIdentity) {
                        RecentContent(
                            history = history,
                            favorites = listOf(currentFavorite, otherFavorite),
                            playlistNames = mapOf(currentPlaylistId to "Current", otherPlaylistId to "Other"),
                            selectedPlaylistId = selectedPlaylistId,
                            searchQuery = remember { mutableStateOf(searchQuery) },
                            initialFocusRequester = focusRequester,
                            onToggleFavorite = { _, _ -> },
                            onRemoveFromHistory = {},
                            onClearHistory = {},
                            onToggleWatched = { _, _ -> },
                            onItemClick = onItemClick,
                        )
                    }
                }
            }
        }
        device.waitForIdle()
    }

    private fun activateRecentScopeWithDpad(moveRight: Boolean = false) {
        // Empty Recent now establishes its own stable initial D-pad target.
        Thread.sleep(180)
        device.waitForIdle()
        if (moveRight) device.pressDPadRight()
        device.pressDPadCenter()
        device.waitForIdle()
    }

    private fun waitFor(title: String) = device.wait(Until.findObject(By.text(title)), 5_000)

    private fun assertHidden(message: String, text: String) {
        assertTrue(message, device.wait(Until.gone(By.text(text)), 5_000))
    }
}
