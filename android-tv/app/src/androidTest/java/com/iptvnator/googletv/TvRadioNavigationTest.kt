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
import com.iptvnator.googletv.playlist.TvChannel
import com.iptvnator.googletv.playlist.TvPlaylist
import com.iptvnator.googletv.playlist.TvPlaylistRepository
import com.iptvnator.googletv.playlist.TvPlaylistStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class TvRadioNavigationTest {
    private val databaseName = "iptvnator-radio-navigation-test.db"
    private val playlistId = "radio-navigation-fixture"
    private lateinit var context: Context
    private lateinit var store: TvPlaylistStore
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var device: UiDevice
    private val activatedChannel = AtomicReference<TvChannel?>(null)

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteDatabase(databaseName)
        store = TvPlaylistStore(context, databaseName)
        store.replacePlaylist(
            playlistId,
            TvPlaylist(
                "Mixed TV and Radio",
                listOf(
                    TvChannel("tv-news", "TV Nacional", "http://127.0.0.1/tv/news.m3u8", group = "News"),
                    TvChannel("radio-news", "Radio Noticias", "http://127.0.0.1/radio/news.aac", group = "News", radio = true),
                    TvChannel("tv-sport", "TV Deportes", "http://127.0.0.1/tv/sport.m3u8", group = "Sports"),
                    TvChannel("radio-music", "Radio Musica", "http://127.0.0.1/radio/music.aac", group = "Music", radio = true),
                ),
            ),
        )
        val repository = TvPlaylistRepository(store)
        val playlist = repository.loadStored(catalogLimit = 500).single()
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        scenario = ActivityScenario.launch(MainActivity::class.java)
        scenario.onActivity { activity ->
            activity.setContent {
                MaterialTheme {
                    LiveContent(
                        playlists = listOf(playlist),
                        repository = repository,
                        sortPreferences = context.getSharedPreferences("radio-navigation-test", Context.MODE_PRIVATE),
                        epgByChannel = emptyMap(),
                        favorites = emptyList(),
                        history = emptyList(),
                        onToggleFavorite = { _, _ -> },
                        onEditEpg = { _, _ -> },
                        onSaveHiddenGroups = { _, _ -> },
                        onPlay = { _, channel, _, _ -> activatedChannel.set(channel) },
                        radioOnly = true,
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
    fun radioScreenFiltersOutTvAndDpadActivatesAnAudioChannel() {
        assertNotNull("The radio group rail should be focusable", device.wait(Until.findObject(By.text("Todos")), 5_000))
        assertNotNull("The radio channel should be rendered", device.wait(Until.findObject(By.textContains("Radio Noticias")), 5_000))
        assertNull("TV entries must not leak into the radio list", device.findObject(By.text("TV Nacional")))

        device.pressDPadRight()
        device.pressDPadCenter()

        assertEquals("Radio Noticias", activatedChannel.get()?.name)
        assertEquals(true, activatedChannel.get()?.radio)
    }
}
