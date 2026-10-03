package com.iptvnator.googletv.playlist

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TvPlaylistStoreDrmPersistenceTest {
    @Test
    fun widevineLicenseHeadersSurviveM3uImportAndSqliteReload() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val databaseName = "iptvnator-drm-persistence-test.db"
        context.deleteDatabase(databaseName)
        val store = TvPlaylistStore(context, databaseName)
        try {
            val playlist = M3uPlaylistParser.parse(
                """#EXTM3U
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
#KODIPROP:inputstream.adaptive.license_key=https://license.example/widevine|Authorization=Bearer%20token&Content-Type=application/octet-stream|R{SSM}|R
#EXTINF:-1 tvg-id="protected",Protected DASH
https://stream.example/manifest.mpd""",
            )
            store.replacePlaylist("drm", playlist)

            val restored = store.getChannelPage("drm", 0).single().drm
            assertTrue(restored?.supported == true)
            assertEquals("https://license.example/widevine", restored?.licenseUrl)
            assertEquals("Bearer token", restored?.licenseHeaders?.get("Authorization"))
            assertEquals("application/octet-stream", restored?.licenseHeaders?.get("Content-Type"))
            assertEquals("R{SSM}", restored?.licenseRequestData)
            assertEquals("R", restored?.licenseResponseData)
        } finally {
            store.close()
            context.deleteDatabase(databaseName)
        }
    }
}
