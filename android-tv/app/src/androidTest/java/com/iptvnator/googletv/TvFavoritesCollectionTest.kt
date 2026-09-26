package com.iptvnator.googletv

import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
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
class TvFavoritesCollectionTest {
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private lateinit var firstTypeFocus: FocusRequester
    private val favoritesFilterQuery = mutableStateOf("")

    @Before
    fun setUp() {
        firstTypeFocus = FocusRequester()
        val channel = TvSavedItem(
            playlistId = "favorite-fixture-source",
            itemType = TvSavedItemType.CHANNEL,
            itemKey = "favorite-fixture-channel",
            title = "Channel fixture",
            uri = "https://example.invalid/live.m3u8",
            coverUrl = null,
            savedAt = 1L,
            lastPlayedAt = null,
            isFavorite = true,
            categoryId = "Noticias",
        )
        val sportsChannel = channel.copy(
            itemKey = "favorite-fixture-sports-channel",
            title = "Sports channel fixture",
            categoryId = "Deportes",
        )
        val movie = TvSavedItem(
            playlistId = "favorite-fixture-source",
            itemType = TvSavedItemType.VOD,
            itemKey = "42",
            title = "Movie fixture",
            uri = "https://example.invalid/movie.mp4",
            coverUrl = null,
            savedAt = 2L,
            lastPlayedAt = null,
            isFavorite = true,
        )
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    FavoritesContent(
                        favorites = listOf(channel, sportsChannel, movie),
                        playlistNames = mapOf(channel.playlistId to "Test playlist"),
                        selectedPlaylistId = null,
                        searchQuery = favoritesFilterQuery,
                        initialFocusRequester = firstTypeFocus,
                        onRemoveFavorite = {},
                        onClearFavorites = { _, _ -> },
                        onFavoriteClick = { _, _ -> },
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
    fun dpadSwitchesTheFavoriteCollectionContentType() {
        val liveFilter = device.wait(Until.findObject(By.text("TV en directo")), 5_000)
        assertNotNull("The live-favorites filter should be visible", liveFilter)
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(firstTypeFocus.requestFocus()) }
        device.waitForIdle()
        assertTrue("Compose rejected the initial favorites filter focus request", focusAccepted.get())

        device.pressDPadRight()
        device.waitForIdle()
        device.pressDPadCenter()
        device.waitForIdle()

        assertNotNull("The selected movie favorite should be shown", device.wait(
            Until.findObject(By.text("Movie fixture")), 5_000,
        ))
        assertNull("The live favorite should be filtered out", device.findObject(By.text("Channel fixture")))
    }

    @Test
    fun dpadFiltersLiveFavoritesBySourceGroup() {
        assertNotNull("The source-group filters should be visible", device.wait(Until.findObject(By.text("Noticias")), 5_000))
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(firstTypeFocus.requestFocus()) }
        device.waitForIdle()
        assertTrue("Compose rejected the initial favorites filter focus request", focusAccepted.get())

        device.pressDPadDown()
        // Categories are sorted case-insensitively: Deportes precedes Noticias.
        device.pressDPadRight()
        device.pressDPadRight()
        device.pressDPadCenter()
        device.waitForIdle()

        assertNotNull("The selected group favorite should remain visible", device.findObject(By.text("Channel fixture")))
        assertNull("Favorites from another group should be filtered out", device.findObject(By.text("Sports channel fixture")))
    }

    @Test
    fun sectionFilterQuerySearchesTheCurrentlySelectedFavoriteType() {
        scenario.onActivity { favoritesFilterQuery.value = "SPORTS" }

        assertNotNull("The section-level filter should find a matching favorite", device.wait(
            Until.findObject(By.text("Sports channel fixture")), 5_000,
        ))
        assertNull("The same filter should hide nonmatching favorites", device.findObject(By.text("Channel fixture")))
    }

    @Test
    fun sectionFilterQuerySearchesFavoriteSourceGroup() {
        scenario.onActivity { favoritesFilterQuery.value = "NOTICIAS" }

        assertNotNull("Searching a source group should find its favorite channel", device.wait(
            Until.findObject(By.text("Channel fixture")), 5_000,
        ))
        assertNull("A different source group should not match", device.findObject(By.text("Sports channel fixture")))
    }

    @Test
    fun favoritePlaybackCapturesTheVisibleSortedChannelOrderAcrossSources() {
        val alpha = favorite("favorite-source-a", "favorite-alpha", "Alpha favorite")
        val zulu = favorite("favorite-source-b", "favorite-zulu", "Zulu favorite")
        val movie = favorite("favorite-source-a", "favorite-movie", "Alpha movie", TvSavedItemType.VOD)
        val capturedItem = AtomicReference<TvSavedItem?>()
        val capturedQueue = AtomicReference<List<TvChannelZapEntry>>()
        val preferences = InstrumentationRegistry.getInstrumentation().targetContext
            .getSharedPreferences("iptvnator-tv-ui", android.content.Context.MODE_PRIVATE)
        val previousSortMode = preferences.getString("favorites_channel_sort_mode", null)

        try {
            scenario.onActivity { activity ->
                preferences.edit().putString("favorites_channel_sort_mode", "name_asc").commit()
                activity.setContent {
                    MaterialTheme {
                        FavoritesContent(
                            favorites = listOf(zulu, movie, alpha),
                            playlistNames = mapOf("favorite-source-a" to "Source A", "favorite-source-b" to "Source B"),
                            selectedPlaylistId = null,
                            searchQuery = favoritesFilterQuery,
                            initialFocusRequester = firstTypeFocus,
                            onRemoveFavorite = {},
                            onClearFavorites = { _, _ -> },
                            onFavoriteClick = { item, queue ->
                                capturedItem.set(item)
                                capturedQueue.set(queue)
                            },
                        )
                    }
                }
            }

            val row = device.wait(Until.findObject(By.text(zulu.title)), 5_000)
            assertNotNull("The second source's favorite should be visible", row)
            row.click()
            device.waitForIdle()

            assertEquals(zulu.itemKey, capturedItem.get()?.itemKey)
            assertEquals(
                listOf(
                    TvChannelZapEntry(alpha.playlistId, alpha.itemKey),
                    TvChannelZapEntry(zulu.playlistId, zulu.itemKey),
                ),
                capturedQueue.get(),
            )
        } finally {
            preferences.edit().apply {
                if (previousSortMode == null) remove("favorites_channel_sort_mode")
                else putString("favorites_channel_sort_mode", previousSortMode)
            }.commit()
        }
    }

    @Test
    fun emptyFavoritesShowsOriginalStyleCallToActionAndReturnsHomeWithDpad() {
        val returnedHome = AtomicReference(false)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    FavoritesContent(
                        favorites = emptyList(),
                        playlistNames = emptyMap(),
                        selectedPlaylistId = null,
                        searchQuery = favoritesFilterQuery,
                        initialFocusRequester = firstTypeFocus,
                        onRemoveFavorite = {},
                        onClearFavorites = { _, _ -> },
                        onFavoriteClick = { _, _ -> },
                        onGoHome = { returnedHome.set(true) },
                    )
                }
            }
        }
        device.waitForIdle()
        assertNotNull("The empty-state title should be centered and visible", device.wait(
            Until.findObject(By.text("Aún no hay favoritos")), 5_000,
        ))
        assertNotNull("The empty state should explain how to save an item", device.findObject(
            By.textContains("Marca con la estrella"),
        ))
        val homeAction = device.wait(Until.findObject(By.text("Volver a Inicio")), 3_000)
        assertNotNull("The empty state should provide a route back to Home", homeAction)
        val focusAccepted = AtomicReference(false)
        scenario.onActivity { focusAccepted.set(firstTypeFocus.requestFocus()) }
        device.waitForIdle()
        assertTrue("The empty-state Home action should accept D-pad focus", focusAccepted.get())
        val capture = java.io.File(
            InstrumentationRegistry.getInstrumentation().targetContext.externalCacheDir,
            "favorites-empty-state.png",
        )
        assertTrue("The empty favorites state should be capturable", device.takeScreenshot(capture))
        device.pressDPadCenter()
        device.waitForIdle()
        assertTrue("Confirming the empty-state action should return to Home", returnedHome.get())
    }

    private fun favorite(
        playlistId: String,
        itemKey: String,
        title: String,
        type: TvSavedItemType = TvSavedItemType.CHANNEL,
    ) = TvSavedItem(
        playlistId = playlistId,
        itemType = type,
        itemKey = itemKey,
        title = title,
        uri = "https://example.invalid/$itemKey",
        coverUrl = null,
        savedAt = 1L,
        lastPlayedAt = null,
        isFavorite = true,
    )
}
