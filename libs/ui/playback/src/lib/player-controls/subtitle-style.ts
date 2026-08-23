import {
    DEFAULT_SUBTITLE_STYLE,
    type PlayerSubtitleStyle,
    isDefaultSubtitleStyle,
    normalizeSubtitleStyle,
} from '@iptvnator/shared/interfaces';
import type { PlayerPreset } from './player-controls.model';

/**
 * UI-side subtitle presentation preferences. The canonical shape and the
 * clamp/normalize rules live in `@iptvnator/shared/interfaces`
 * (`subtitle-style.util.ts`) so the Electron main process re-validates IPC
 * input with the exact same implementation; this file adds only what the
 * controls UI needs — presets, the delay step, persistence, and labels.
 *
 * The style (size/color) persists across sessions through the same
 * localStorage mechanism the players already use for the shared 'volume' key,
 * so every engine adapter reads one source of truth. The delay and any loaded
 * external subtitle file are deliberately per-session: they correct one
 * specific stream, not a user preference.
 */

export {
    DEFAULT_SUBTITLE_STYLE,
    SUBTITLE_DELAY_LIMIT_SECONDS,
    SUBTITLE_SIZE_MAX_PERCENT,
    SUBTITLE_SIZE_MIN_PERCENT,
    clampSubtitleDelay,
    isDefaultSubtitleStyle,
    normalizeSubtitleStyle,
} from '@iptvnator/shared/interfaces';

export const SUBTITLE_STYLE_STORAGE_KEY = 'subtitleStyle';

export const SUBTITLE_SIZE_PRESETS: ReadonlyArray<PlayerPreset<number>> = [
    { value: 75, label: '75%' },
    { value: 100, label: '100%' },
    { value: 125, label: '125%' },
    { value: 150, label: '150%' },
    { value: 200, label: '200%' },
];

/** Swatch values; null = engine default. Labels are translation keys. */
export const SUBTITLE_COLOR_PRESETS: ReadonlyArray<PlayerPreset<string | null>> =
    [
        { value: null, label: 'EMBEDDED_MPV.PLAYER.SUBTITLE_COLOR_DEFAULT' },
        { value: '#ffffff', label: 'EMBEDDED_MPV.PLAYER.SUBTITLE_COLOR_WHITE' },
        {
            value: '#ffe94f',
            label: 'EMBEDDED_MPV.PLAYER.SUBTITLE_COLOR_YELLOW',
        },
        { value: '#7fdbff', label: 'EMBEDDED_MPV.PLAYER.SUBTITLE_COLOR_CYAN' },
    ];

export const SUBTITLE_DELAY_STEP_SECONDS = 0.5;

export function readStoredSubtitleStyle(): PlayerSubtitleStyle {
    try {
        const raw = localStorage.getItem(SUBTITLE_STYLE_STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_SUBTITLE_STYLE };
        }
        return normalizeSubtitleStyle(JSON.parse(raw));
    } catch {
        return { ...DEFAULT_SUBTITLE_STYLE };
    }
}

export function persistSubtitleStyle(style: PlayerSubtitleStyle): void {
    try {
        const normalized = normalizeSubtitleStyle(style);
        if (isDefaultSubtitleStyle(normalized)) {
            localStorage.removeItem(SUBTITLE_STYLE_STORAGE_KEY);
            return;
        }
        localStorage.setItem(
            SUBTITLE_STYLE_STORAGE_KEY,
            JSON.stringify(normalized)
        );
    } catch {
        // Storage may be unavailable (private mode); the style stays session-local.
    }
}

/** "+0.5 s" / "−1.5 s" / "0 s" display label for the delay row. */
export function subtitleDelayLabel(seconds: number): string {
    if (!Number.isFinite(seconds)) {
        return '0 s';
    }
    const rounded = Math.round(seconds * 10) / 10;
    // Derive the sign AFTER rounding: 0.02 rounds to 0 and must render as
    // "0 s", not "−0.0 s".
    if (rounded === 0) {
        return '0 s';
    }
    const magnitude = Math.abs(rounded).toFixed(1);
    return `${rounded > 0 ? '+' : '−'}${magnitude} s`;
}
