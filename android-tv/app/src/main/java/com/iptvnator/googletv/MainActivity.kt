package com.iptvnator.googletv

import android.annotation.SuppressLint
import android.os.Bundle
import android.os.Build
import android.graphics.Rect
import android.content.pm.ApplicationInfo
import android.util.Rational
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent

@androidx.annotation.RequiresApi(Build.VERSION_CODES.O)
internal fun createTvPictureInPictureParams(
    sourceRectHint: Rect?,
    autoEnterEnabled: Boolean,
): android.app.PictureInPictureParams {
    val builder = android.app.PictureInPictureParams.Builder()
        .setAspectRatio(Rational(16, 9))
        .setSourceRectHint(sourceRectHint)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        builder.setAutoEnterEnabled(autoEnterEnabled)
    }
    return builder.build()
}

class MainActivity : ComponentActivity() {
    var playbackRemoteKeyListener: ((Int) -> Unit)? = null
    private var pictureInPictureSourceRectHint: Rect? = null

    @SuppressLint("RestrictedApi") // Required to observe keys consumed by Media3's focused native buttons.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val handled = super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) {
            // Native Media3 buttons can own focus outside the Compose key
            // hierarchy; still let the player wake its shared overlay.
            playbackRemoteKeyListener?.invoke(event.keyCode)
        }
        return handled
    }

    companion object {
        const val EXTRA_DEBUG_DATABASE_NAME = "com.iptvnator.googletv.DEBUG_DATABASE_NAME"
        private val UI_TEST_DATABASE_NAMES = setOf(
            "iptvnator-xtream-ui-import-test.db",
            "iptvnator-m3u-ui-import-test.db",
            "iptvnator-stalker-import-test.db",
        )
    }

    fun supportsTvPictureInPicture(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            packageManager.hasSystemFeature("android.software.picture_in_picture")

    fun updateTvPictureInPicture(playerSurface: View?, autoEnterEnabled: Boolean) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            !packageManager.hasSystemFeature("android.software.picture_in_picture")
        ) return
        val sourceRect = playerSurface
            ?.takeIf { it.isAttachedToWindow && it.width > 0 && it.height > 0 }
            ?.let { view ->
                val location = IntArray(2)
                view.getLocationInWindow(location)
                Rect(location[0], location[1], location[0] + view.width, location[1] + view.height)
            }
        pictureInPictureSourceRectHint = sourceRect
        setPictureInPictureParams(
            createTvPictureInPictureParams(
                sourceRect,
                autoEnterEnabled = autoEnterEnabled && sourceRect != null,
            ),
        )
    }

    fun enterTvPictureInPicture(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            !packageManager.hasSystemFeature("android.software.picture_in_picture")
        ) return false
        return enterPictureInPictureMode(
            createTvPictureInPictureParams(
                sourceRectHint = pictureInPictureSourceRectHint,
                autoEnterEnabled = true,
            ),
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // TV keyboards are delivered as a separate overlay window. Do not let
        // adjustResize shrink the activity to the IME's measured height: on
        // Google TV emulator images that can reduce a dialog viewport to a
        // few hundred pixels and clip the focused field. The import form
        // applies imePadding and scrolls its own content instead.
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
        val debugDatabaseName = intent.getStringExtra(EXTRA_DEBUG_DATABASE_NAME)
            ?.takeIf {
                applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0 &&
                    it in UI_TEST_DATABASE_NAMES
            }
        setContent { TvApp(databaseName = debugDatabaseName) }
    }
}
