package com.iptvnator.googletv

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

internal enum class TvVisualTheme(val preferenceValue: String, val label: String) {
    SYSTEM("system", "Sistema"),
    DARK("dark", "Oscuro"),
    LIGHT("light", "Claro");

    fun next(): TvVisualTheme = entries[(ordinal + 1) % entries.size]

    companion object {
        fun fromPreference(value: String?): TvVisualTheme =
            entries.firstOrNull { it.preferenceValue == value } ?: SYSTEM
    }
}

internal val LocalTvLightTheme = staticCompositionLocalOf { false }

/**
 * Semantic tones of the "Nocturno" TV design system: warm ink surfaces, a
 * paper-white text ramp and one amber signature accent. Live/recording keeps
 * its own coral so it never competes with focus.
 */
internal enum class TvTone(val dark: Color, val light: Color) {
    Canvas(Color(0xFF0E0F13), Color(0xFFF4F0E9)),
    Deep(Color(0xFF09090C), Color(0xFFEAE4DA)),
    Surface(Color(0xFF17191F), Color(0xFFFFFCF7)),
    SurfaceHigh(Color(0xFF1E2129), Color(0xFFFFFFFF)),
    SurfaceTop(Color(0xFF292D37), Color(0xFFE9E2D6)),
    Selected(Color(0xFF3A2B15), Color(0xFFF7E3C2)),
    Focused(Color(0xFF55401D), Color(0xFFF3D19A)),
    Text(Color(0xFFF4EFE6), Color(0xFF1D1A16)),
    TextSoft(Color(0xFFBDB6AA), Color(0xFF4F493F)),
    Muted(Color(0xFF9A948A), Color(0xFF6C655B)),
    Faint(Color(0xFF6B675F), Color(0xFF8F887D)),
    Accent(Color(0xFFFFB547), Color(0xFFB0620A)),
    AccentSoft(Color(0xFFFFD493), Color(0xFF8A4A00)),
    AccentInk(Color(0xFF1D1407), Color(0xFFFFF8EE)),
    Live(Color(0xFFFF5E62), Color(0xFFC62A3A)),
    LiveSoft(Color(0xFF3A1B1E), Color(0xFFF8DCDD)),
    LiveInk(Color(0xFFFFD6D7), Color(0xFF7D1A24)),
    LiveDeep(Color(0xFF7A2A31), Color(0xFFE9A9AE)),
    Good(Color(0xFF86D9A0), Color(0xFF237A43)),
    Warn(Color(0xFFFFD166), Color(0xFF8A5A00));

    fun resolve(isLight: Boolean): Color = if (isLight) light else dark
}

@Composable
internal fun tvTone(tone: TvTone): Color = tone.resolve(LocalTvLightTheme.current)

/** Maps the legacy IPTVnator design tokens used across the TV screens onto the Nocturno palette. */
@Composable
internal fun tvColor(color: Color): Color = resolveTvPaletteColor(color, LocalTvLightTheme.current)

internal fun resolveTvPaletteColor(color: Color, isLight: Boolean): Color {
    val opaque = color.copy(alpha = 1f)
    val tone = legacyTvTone(opaque) ?: return color
    val resolved = tone.resolve(isLight)
    return if (color.alpha < 1f) resolved.copy(alpha = color.alpha) else resolved
}

private val legacyToneTable: Map<Color, TvTone> = buildMap {
    fun put(tone: TvTone, vararg values: Long) = values.forEach { put(Color(it), tone) }
    put(TvTone.Canvas, 0xFF161A22)
    put(TvTone.Deep, 0xFF101217, 0xFF101318, 0xFF111318, 0xFF171B24)
    put(TvTone.Surface, 0xFF1A1E27, 0xFF1C2029, 0xFF20232C, 0xFF20232B)
    put(
        TvTone.SurfaceHigh,
        0xFF202532, 0xFF202632, 0xFF202936, 0xFF202B3E, 0xFF202B43, 0xFF202944, 0xFF20254D,
    )
    put(
        TvTone.SurfaceTop,
        0xFF252B35, 0xFF252B38, 0xFF272C3A, 0xFF29334B, 0xFF2A2F3B, 0xFF2B3039, 0xFF2B303B,
        0xFF2B303D, 0xFF2E3442, 0xFF30343E, 0xFF303644, 0xFF343A48, 0xFF3A3E49, 0xFF414858,
    )
    put(
        TvTone.Selected,
        0xFF263A5A, 0xFF263858, 0xFF30405D, 0xFF304A75, 0xFF27265B, 0xFF2C4168, 0xFF35496E,
    )
    put(
        TvTone.Focused,
        0xFF536A9F, 0xFF4F82D4, 0xFF2C3445, 0xFF3A397C, 0xFF3D5B8C, 0xFF2C62B6, 0xFF302A70,
    )
    put(
        TvTone.Text,
        0xFFD8DCE8, 0xFFD0D0E4, 0xFFE7E9F0, 0xFFF2F3F7, 0xFFE8ECF3, 0xFFD4E1F5,
    )
    put(TvTone.TextSoft, 0xFFB6BBC8, 0xFFB3BACB, 0xFFADB2C0)
    put(TvTone.Muted, 0xFF8891A4, 0xFF8B93A8, 0xFF9BA3B7, 0xFF737F92, 0xFF596476)
    put(TvTone.Faint, 0xFF606A7C, 0xFF616878, 0xFF777D8C, 0xFF737B8D, 0xFF626B7A)
    put(
        TvTone.Accent,
        0xFF6F91CE, 0xFF9CC1FF, 0xFF9DBEFF, 0xFF9ED0FF, 0xFF9BC4FF, 0xFF8FAFEA, 0xFF8FC0FF,
        0xFF8FB8FF, 0xFF83B5FF, 0xFF78ADFF, 0xFF7AAEFF, 0xFF72AAFF, 0xFF6EA8FF, 0xFF6EA7FF,
        0xFF638FD4, 0xFF5A93E6, 0xFF456DAA, 0xFF245BA6, 0xFF8D6BE0, 0xFF6843B5,
    )
    put(TvTone.AccentSoft, 0xFFBBD3FF, 0xFFD7E5FF, 0xFFB9D4FF, 0xFF315C96, 0xFFFFC48A)
    put(TvTone.AccentInk, 0xFF111827)
    put(TvTone.LiveSoft, 0xFF2A2028, 0xFF2B2026, 0xFF49303A, 0xFFF7DDE1)
    put(
        TvTone.Live,
        0xFFFFB4AB, 0xFFFF7181, 0xFFFF9AAB, 0xFFFF9A9A, 0xFFFF9E9E, 0xFFFF8181, 0xFFB3263E,
    )
    put(TvTone.LiveInk, 0xFFFFD7D9)
    put(TvTone.LiveDeep, 0xFF8E3944)
    put(TvTone.Warn, 0xFFFFD166, 0xFF8A5A00)
    put(TvTone.Good, 0xFF9FD6A5, 0xFF26733C)
}

private fun legacyTvTone(color: Color): TvTone? = legacyToneTable[color]
