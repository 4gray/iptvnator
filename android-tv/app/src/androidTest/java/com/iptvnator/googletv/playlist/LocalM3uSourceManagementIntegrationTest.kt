package com.iptvnator.googletv.playlist

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.iptvnator.googletv.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.StringReader

@RunWith(AndroidJUnit4::class)
class LocalM3uSourceManagementIntegrationTest {
    @Test
    fun replacesLegacyLocalSourceThroughVisibleTvMenuWithoutLosingFavorites() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "iptvnator-m3u-ui-import-test.db"
        val fixtureName = "iptvnator-replace-file-fixture.m3u"
        val fixture = File(requireNotNull(context.getExternalFilesDir(null)), fixtureName)
        val preferences = context.getSharedPreferences("iptvnator-tv-ui", Context.MODE_PRIVATE)
        val previousStartup = preferences.getString("startup_section", null)
        val previousDashboard = if (preferences.contains("show_dashboard")) preferences.getBoolean("show_dashboard", true) else null
        val previousRecentSources = if (preferences.contains("show_recent_sources")) preferences.getBoolean("show_recent_sources", true) else null
        val previousSelected = preferences.getString("selected_playlist_id", null)
        context.deleteDatabase(databaseName)
        try {
            fixture.writeText("""#EXTM3U
#EXTINF:-1 tvg-id="stable",Channel from selected file
https://provider.example/new.m3u8""".trimIndent())
            val originalStore = TvPlaylistStore(context, databaseName)
            val original = try {
                val imported = TvPlaylistRepository(originalStore).importM3uReader(
                    StringReader("""#EXTM3U
#EXTINF:-1 tvg-id="stable",Original channel
https://provider.example/old.m3u8""".trimIndent()).buffered(),
                    "Legacy local fixture",
                    identitySeed = "legacy-local-fixture",
                )
                originalStore.setFavorite(
                    TvSavedItem(
                        playlistId = imported.id,
                        itemType = TvSavedItemType.CHANNEL,
                        itemKey = imported.channels.single().id,
                        title = "Original channel",
                        uri = imported.channels.single().url,
                        coverUrl = null,
                        savedAt = 1L,
                        lastPlayedAt = null,
                    ),
                    true,
                )
                imported
            } finally {
                originalStore.close()
            }
            preferences.edit().putString("startup_section", "Home")
                .putBoolean("show_dashboard", true)
                .putBoolean("show_recent_sources", true)
                .apply()
            val scenario = ActivityScenario.launch<MainActivity>(
                Intent(context, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_DEBUG_DATABASE_NAME, databaseName),
            )
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            try {
                val sourceMenu = device.wait(Until.findObject(By.text("⋮")), 10_000)
                    ?: throw AssertionError("Home should expose the local source menu")
                sourceMenu.click()
                val selectFile = device.wait(Until.findObject(By.text("Seleccionar archivo")), 5_000)
                    ?: throw AssertionError("Local sources should offer file reselection")
                selectFile.click()
                val pickerOpen = device.wait(
                    Until.hasObject(By.text("Elegir archivo M3U")), 5_000,
                )
                val visibleText = device.findObjects(By.clazz("android.widget.TextView"))
                    .mapNotNull { it.text?.toString() }
                    .filter(String::isNotBlank)
                    .distinct()
                    .take(30)
                assertTrue("The emulator file picker should open; visible=$visibleText", pickerOpen)
                assertTrue(
                    "Capture the in-app picker for TV layout review",
                    device.takeScreenshot(File(requireNotNull(context.externalCacheDir), "local-m3u-picker.png")),
                )
                val file = device.wait(Until.findObject(By.text(fixtureName)), 5_000)
                    ?: throw AssertionError("The app-private fixture file should be listed")
                file.click()
                assertTrue("The source picker should close after choosing the file", device.wait(
                    Until.gone(By.text("Elegir archivo M3U")), 5_000,
                ))
                assertTrue("The replacement should return to the selected source", device.wait(
                    Until.hasObject(By.text("Fuentes utilizadas")), 15_000,
                ))
            } finally {
                scenario.close()
            }
            val verifiedStore = TvPlaylistStore(context, databaseName)
            try {
                val stored = verifiedStore.getPlaylists().single()
                assertEquals(original.id, stored.id)
                assertEquals(Uri.fromFile(fixture).toString(), stored.sourceUrl)
                assertEquals("Channel from selected file", stored.channels.single().name)
                assertEquals(original.channels.single().id, verifiedStore.getFavorites().single().itemKey)
            } finally {
                verifiedStore.close()
            }
        } finally {
            fixture.delete()
            context.deleteDatabase(databaseName)
            preferences.edit().apply {
                if (previousStartup == null) remove("startup_section") else putString("startup_section", previousStartup)
                if (previousDashboard == null) remove("show_dashboard") else putBoolean("show_dashboard", previousDashboard)
                if (previousRecentSources == null) remove("show_recent_sources") else putBoolean("show_recent_sources", previousRecentSources)
                if (previousSelected == null) remove("selected_playlist_id") else putString("selected_playlist_id", previousSelected)
            }.apply()
        }
    }
}
