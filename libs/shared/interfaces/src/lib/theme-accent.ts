/**
 * Accent colours a user can lay over any theme preset. The hex is the
 * accent's hue and saturation only: the applied colour is moved lighter or
 * darker per theme until it keeps its contrast against that theme's
 * surfaces (`apps/web/src/app/services/theme-accent-tokens.ts`).
 *
 * The ids are persisted in settings; keep them stable.
 */
export const THEME_ACCENTS = [
    { id: 'blue', hex: '#3b82f6' },
    { id: 'teal', hex: '#14b8a6' },
    { id: 'green', hex: '#22c55e' },
    { id: 'amber', hex: '#f59e0b' },
    { id: 'coral', hex: '#f97357' },
    { id: 'magenta', hex: '#e11d74' },
    { id: 'violet', hex: '#8b5cf6' },
] as const;

export type ThemeAccent = (typeof THEME_ACCENTS)[number]['id'];

/** A saved accent id, or `null` for the theme's own selection colour. */
export function normalizeThemeAccent(value: unknown): ThemeAccent | null {
    return THEME_ACCENTS.some((accent) => accent.id === value)
        ? (value as ThemeAccent)
        : null;
}

export function resolveThemeAccentHex(value: unknown): string | null {
    return THEME_ACCENTS.find((accent) => accent.id === value)?.hex ?? null;
}
