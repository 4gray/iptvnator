import { Settings } from '@iptvnator/shared/interfaces';

/**
 * Boolean settings that default ON and are stored as an explicit opt-out.
 *
 * Absent in settings stored before the default flip means "never chose" —
 * those users get the default; only an explicit `false` opts out, so junk
 * such as the string `'false'` falls back to the default too.
 */
export const DEFAULT_ON_SETTINGS = [
    'webPlayerSharedControls',
    'portalConnectivityGuard',
    'embeddedMpvAutoReconnect',
    'showCoverTitles',
    'm3uCatalogTabs',
] as const satisfies readonly (keyof Settings)[];

export type DefaultOnSetting = (typeof DEFAULT_ON_SETTINGS)[number];

/** Every default-on flag resolved: `true` unless stored as exactly `false`. */
export function resolveDefaultOnSettings(
    stored: Partial<Settings>
): Record<DefaultOnSetting, boolean> {
    // `reduce` rather than `Object.fromEntries`: the web build lib target
    // predates ES2019.
    return DEFAULT_ON_SETTINGS.reduce(
        (resolved, key) => {
            resolved[key] = stored[key] !== false;
            return resolved;
        },
        {} as Record<DefaultOnSetting, boolean>
    );
}

/** Only the default-on flags the caller supplied, coerced the same way. */
export function coerceProvidedDefaultOnSettings(
    settings: Partial<Settings>
): Partial<Record<DefaultOnSetting, boolean>> {
    return DEFAULT_ON_SETTINGS.reduce(
        (coerced, key) => {
            if (settings[key] !== undefined) {
                coerced[key] = settings[key] !== false;
            }
            return coerced;
        },
        {} as Partial<Record<DefaultOnSetting, boolean>>
    );
}
