package com.iptvnator.googletv

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class TvThemeTest {
    @Test
    fun themePreferenceDefaultsToSystemAndCyclesThroughAllModes() {
        assertEquals(TvVisualTheme.SYSTEM, TvVisualTheme.fromPreference(null))
        assertEquals(TvVisualTheme.DARK, TvVisualTheme.fromPreference("dark"))
        assertEquals(TvVisualTheme.LIGHT, TvVisualTheme.fromPreference("light"))
        assertEquals(TvVisualTheme.SYSTEM, TvVisualTheme.fromPreference("system"))
        assertEquals(TvVisualTheme.SYSTEM, TvVisualTheme.fromPreference("unknown"))
        assertEquals(TvVisualTheme.DARK, TvVisualTheme.SYSTEM.next())
        assertEquals(TvVisualTheme.LIGHT, TvVisualTheme.DARK.next())
        assertEquals(TvVisualTheme.SYSTEM, TvVisualTheme.LIGHT.next())
    }

    @Test
    fun darkThemeMapsLegacyTokensOntoNocturnoTones() {
        assertEquals(TvTone.Canvas.dark, resolveTvPaletteColor(Color(0xFF161A22), isLight = false))
        assertEquals(TvTone.Surface.dark, resolveTvPaletteColor(Color(0xFF1A1E27), isLight = false))
        assertEquals(TvTone.Text.dark, resolveTvPaletteColor(Color(0xFFD8DCE8), isLight = false))
        assertEquals(TvTone.Focused.dark, resolveTvPaletteColor(Color(0xFF536A9F), isLight = false))
        assertEquals(TvTone.Selected.dark, resolveTvPaletteColor(Color(0xFF304A75), isLight = false))
        // Every former blue accent now resolves to the single amber signature.
        assertEquals(TvTone.Accent.dark, resolveTvPaletteColor(Color(0xFF78ADFF), isLight = false))
        assertEquals(TvTone.Accent.dark, resolveTvPaletteColor(Color(0xFF9CC1FF), isLight = false))
        assertEquals(TvTone.Warn.dark, resolveTvPaletteColor(Color(0xFFFFD166), isLight = false))
    }

    @Test
    fun paletteKeepsTranslucencyAndLeavesUnknownColorsUntouched() {
        val translucent = resolveTvPaletteColor(Color(0xE62C4168), isLight = false)
        assertEquals(TvTone.Selected.dark.copy(alpha = Color(0xE62C4168).alpha), translucent)
        assertEquals(Color(0xFF123456), resolveTvPaletteColor(Color(0xFF123456), isLight = false))
        assertEquals(Color.White, resolveTvPaletteColor(Color.White, isLight = true))
    }

    @Test
    fun lightThemeReversesSurfacesAndTextButKeepsSemanticStatusLegible() {
        assertEquals(TvTone.Canvas.light, resolveTvPaletteColor(Color(0xFF161A22), isLight = true))
        assertEquals(TvTone.Surface.light, resolveTvPaletteColor(Color(0xFF1A1E27), isLight = true))
        assertEquals(TvTone.Text.light, resolveTvPaletteColor(Color(0xFFD8DCE8), isLight = true))
        assertEquals(TvTone.Focused.light, resolveTvPaletteColor(Color(0xFF536A9F), isLight = true))
        assertEquals(TvTone.Good.light, resolveTvPaletteColor(Color(0xFF9FD6A5), isLight = true))
        assertEquals(TvTone.Live.light, resolveTvPaletteColor(Color(0xFFFF7181), isLight = true))
        assertNotEquals(
            resolveTvPaletteColor(Color(0xFF161A22), isLight = false),
            resolveTvPaletteColor(Color(0xFF161A22), isLight = true),
        )
    }
}
