package com.iptvnator.googletv

import android.content.Context
import android.content.SharedPreferences
import androidx.activity.compose.setContent
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.playlist.TvPlaylist
import com.iptvnator.googletv.playlist.TvPlaylistStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvFavoriteDpadPersistenceTest {
    private val databaseName = "iptvnator-favorite-dpad-persistence-test.db"
    private val playlistId = "favorite-dpad-persistence-source"
    private val channelId = "favorite-dpad-persistence-channel"
    private val favoriteTitle = "D-pad favorite persistence channel"
    private lateinit var context: Context
    private lateinit var device: UiDevice
    private lateinit var preferences: SharedPreferences
    private lateinit var previousStartupSection: PreferenceSnapshot
    private lateinit var previousSelectedPlaylist: PreferenceSnapshot
    private lateinit var previousFavoritesScope: PreferenceSnapshot
    private var scenario: ActivityScenario<MainActivity>? = null

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        preferences = context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
        previousStartupSection = preferences.snapshotString("startup_section")
        previousSelectedPlaylist = preferences.snapshotString("selected_playlist_id")
        previousFavoritesScope = preferences.snapshotString("collection-scope-favorites")

        context.deleteDatabase(databaseName)
        TvPlaylistStore(context, databaseName).use { store ->
            store.replacePlaylist(
                playlistId,
                TvPlaylist(
                    name = "D-pad favorite persistence source",
                    channels = listOf(
                        TvChannel(
                            id = channelId,
                            name = favoriteTitle,
                            url = "https://example.invalid/live/favorite-persistence.m3u8",
                            group = "News",
                        ),
                    ),
                ),
            )
        }
        preferences.edit()
            .putString("startup_section", TvSection.Live.name)
            .putString("selected_playlist_id", playlistId)
            .putString("collection-scope-favorites", "playlist")
            .apply()
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        launchApp()
    }

    @After
    fun tearDown() {
        scenario?.close()
        preferences.edit().apply {
            restoreString("startup_section", previousStartupSection)
            restoreString("selected_playlist_id", previousSelectedPlaylist)
            restoreString("collection-scope-favorites", previousFavoritesScope)
        }.apply()
        context.deleteDatabase(databaseName)
    }

    @Test
    fun dpadFavoriteActionPersistsAcrossActivityRecreationWithoutPlayingTheChannel() {
        assertNotNull("The live group selector should receive initial focus", device.wait(
            Until.findObject(By.text("Todos")), 5_000,
        ))
        assertNotNull("The fixture channel should be visible", device.wait(
            Until.findObject(By.textContains(favoriteTitle)), 5_000,
        ))
        assertNotNull("The empty playback surface should be visible before selecting an action", device.findObject(
            By.text("Selecciona un canal para iniciar la reproducción"),
        ))
        // Establish a deterministic focus anchor before exercising the
        // remote-only channel → EPG → favorite action path.
        device.findObject(By.text("Todos")).click()
        device.waitForIdle()

        // From the group rail: channel body → EPG → favorite star → activate.
        repeat(3) {
            device.pressDPadRight()
            device.waitForIdle()
        }
        device.pressDPadCenter()

        assertNotNull("The favorite star should turn on", device.wait(
            Until.findObject(By.text("★")), 5_000,
        ))
        assertNotNull("OK on the star must not bubble into the channel's play action", device.findObject(
            By.text("Selecciona un canal para iniciar la reproducción"),
        ))
        assertStoredFavorite()

        scenario?.close()
        scenario = null
        launchApp()

        assertNotNull("The saved star should still be on after recreating the activity", device.wait(
            Until.findObject(By.text("★")), 5_000,
        ))
        assertStoredFavorite()
    }

    private fun launchApp() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario!!.onActivity { activity ->
            activity.setContent { TvApp(databaseName = databaseName) }
        }
        assertNotNull("The app should enter the configured live section after playlist hydration", device.wait(
            Until.findObject(By.text("Todos")), 10_000,
        ))
    }

    private fun assertStoredFavorite() {
        TvPlaylistStore(context, databaseName).use { store ->
            val favorites = store.getFavorites()
            assertEquals("Exactly one item should be saved", 1, favorites.size)
            assertEquals(playlistId, favorites.single().playlistId)
            assertEquals(channelId, favorites.single().itemKey)
            assertEquals(favoriteTitle, favorites.single().title)
            assertTrue(favorites.single().isFavorite)
        }
    }

    private data class PreferenceSnapshot(val existed: Boolean, val value: String?)

    private fun SharedPreferences.snapshotString(key: String) =
        PreferenceSnapshot(contains(key), getString(key, null))

    private fun SharedPreferences.Editor.restoreString(key: String, snapshot: PreferenceSnapshot) {
        if (snapshot.existed) putString(key, snapshot.value) else remove(key)
    }
}
