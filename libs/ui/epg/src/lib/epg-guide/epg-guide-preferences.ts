import {
    EPG_GUIDE_ZOOM_DEFAULT,
    EPG_GUIDE_ZOOM_MAX,
    EPG_GUIDE_ZOOM_MIN,
    EpgGuideDensity,
} from './epg-guide-layout.util';

export const EPG_GUIDE_DENSITY_KEY = 'epg-guide:density';
export const EPG_GUIDE_ZOOM_KEY = 'epg-guide:zoom';
export const EPG_GUIDE_ONLY_WITH_EPG_KEY = 'epg-guide:only-with-epg';
export const EPG_GUIDE_DOCK_COLLAPSED_KEY = 'epg-guide:dock-collapsed';

export interface EpgGuidePreferences {
    density: EpgGuideDensity;
    zoom: number;
    onlyWithEpg: boolean;
}

function isDensity(value: unknown): value is EpgGuideDensity {
    return value === 'comfortable' || value === 'compact';
}

export function clampGuideZoom(value: number): number {
    if (!Number.isFinite(value)) {
        return EPG_GUIDE_ZOOM_DEFAULT;
    }
    return Math.min(EPG_GUIDE_ZOOM_MAX, Math.max(EPG_GUIDE_ZOOM_MIN, value));
}

function read(storage: Storage, key: string): string | null {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

function write(storage: Storage, key: string, value: string): void {
    try {
        storage.setItem(key, value);
    } catch {
        // Storage may be unavailable (private mode, quota); the guide simply
        // starts from defaults next time.
    }
}

function defaultStorage(): Storage {
    return globalThis.localStorage;
}

export function restoreEpgGuidePreferences(
    storage: Storage = defaultStorage()
): EpgGuidePreferences {
    const density = read(storage, EPG_GUIDE_DENSITY_KEY);
    const zoom = Number(read(storage, EPG_GUIDE_ZOOM_KEY));
    return {
        density: isDensity(density) ? density : 'comfortable',
        zoom: clampGuideZoom(zoom === 0 ? Number.NaN : zoom),
        onlyWithEpg: read(storage, EPG_GUIDE_ONLY_WITH_EPG_KEY) === '1',
    };
}

export function persistEpgGuidePreferences(
    preferences: EpgGuidePreferences,
    storage: Storage = defaultStorage()
): void {
    write(storage, EPG_GUIDE_DENSITY_KEY, preferences.density);
    write(storage, EPG_GUIDE_ZOOM_KEY, String(clampGuideZoom(preferences.zoom)));
    write(storage, EPG_GUIDE_ONLY_WITH_EPG_KEY, preferences.onlyWithEpg ? '1' : '0');
}

export function restoreEpgGuideDockCollapsed(
    storage: Storage = defaultStorage()
): boolean {
    return read(storage, EPG_GUIDE_DOCK_COLLAPSED_KEY) === '1';
}

export function persistEpgGuideDockCollapsed(
    collapsed: boolean,
    storage: Storage = defaultStorage()
): void {
    write(storage, EPG_GUIDE_DOCK_COLLAPSED_KEY, collapsed ? '1' : '0');
}
