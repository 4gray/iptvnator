import type { PlayerPreset, PlayerSubtitleStyle } from './player-controls.model';

/**
 * Shared subtitle presentation preferences. The style (size/color) persists
 * across sessions through the same localStorage mechanism the players already
 * use for the shared 'volume' key, so every engine adapter reads one source of
 * truth. The delay and any loaded external subtitle file are deliberately
 * per-session: they correct one specific stream, not a user preference.
 */

export const SUBTITLE_STYLE_STORAGE_KEY = 'subtitleStyle';

export const DEFAULT_SUBTITLE_STYLE: PlayerSubtitleStyle = {
    sizePercent: 100,
    color: null,
};

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
export const SUBTITLE_DELAY_LIMIT_SECONDS = 60;

const MIN_SIZE_PERCENT = 25;
const MAX_SIZE_PERCENT = 400;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function clampSubtitleDelay(seconds: number): number {
    if (!Number.isFinite(seconds)) {
        return 0;
    }
    const clamped = Math.max(
        -SUBTITLE_DELAY_LIMIT_SECONDS,
        Math.min(SUBTITLE_DELAY_LIMIT_SECONDS, seconds)
    );
    // Avoid float drift from repeated ±0.5 steps ("0.30000000000000004").
    return Math.round(clamped * 1000) / 1000;
}

export function normalizeSubtitleStyle(value: unknown): PlayerSubtitleStyle {
    if (typeof value !== 'object' || value === null) {
        return { ...DEFAULT_SUBTITLE_STYLE };
    }
    const candidate = value as Partial<PlayerSubtitleStyle>;
    const sizePercent =
        typeof candidate.sizePercent === 'number' &&
        Number.isFinite(candidate.sizePercent)
            ? Math.max(
                  MIN_SIZE_PERCENT,
                  Math.min(MAX_SIZE_PERCENT, Math.round(candidate.sizePercent))
              )
            : DEFAULT_SUBTITLE_STYLE.sizePercent;
    const color =
        typeof candidate.color === 'string' &&
        HEX_COLOR_PATTERN.test(candidate.color)
            ? candidate.color.toLowerCase()
            : null;
    return { sizePercent, color };
}

export function isDefaultSubtitleStyle(style: PlayerSubtitleStyle): boolean {
    return (
        style.sizePercent === DEFAULT_SUBTITLE_STYLE.sizePercent &&
        style.color === DEFAULT_SUBTITLE_STYLE.color
    );
}

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
    if (!Number.isFinite(seconds) || seconds === 0) {
        return '0 s';
    }
    const rounded = Math.round(seconds * 10) / 10;
    const magnitude = Math.abs(rounded).toFixed(1);
    return `${rounded > 0 ? '+' : '−'}${magnitude} s`;
}
