/**
 * Canonical subtitle presentation contract shared by the renderer controls
 * (`libs/ui/playback`) and the Electron main process. The clamp/normalize
 * rules live HERE so the two sides cannot drift: the renderer applies them to
 * user input, and the main process re-applies the exact same rules to
 * untrusted IPC payloads (deliberate defense-in-depth, same implementation).
 */

/**
 * Engine-neutral subtitle presentation preferences. `sizePercent` is relative
 * to the engine's default rendering size (100 = default); `color` is a
 * lowercase CSS hex color, or null for the engine default.
 */
export interface PlayerSubtitleStyle {
    sizePercent: number;
    color: string | null;
}

export const DEFAULT_SUBTITLE_STYLE: PlayerSubtitleStyle = {
    sizePercent: 100,
    color: null,
};

export const SUBTITLE_DELAY_LIMIT_SECONDS = 60;
export const SUBTITLE_SIZE_MIN_PERCENT = 25;
export const SUBTITLE_SIZE_MAX_PERCENT = 400;

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
                  SUBTITLE_SIZE_MIN_PERCENT,
                  Math.min(
                      SUBTITLE_SIZE_MAX_PERCENT,
                      Math.round(candidate.sizePercent)
                  )
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
