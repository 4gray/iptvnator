export type LiveSidebarState = 'expanded' | 'collapsed';

export const LIVE_SIDEBAR_STATE_STORAGE_KEY = 'live-sidebar-state';
export const DEFAULT_LIVE_SIDEBAR_STATE: LiveSidebarState = 'expanded';

export function isLiveSidebarState(value: unknown): value is LiveSidebarState {
    return value === 'expanded' || value === 'collapsed';
}

export function restoreLiveSidebarState(
    storageKey: string = LIVE_SIDEBAR_STATE_STORAGE_KEY,
    fallback: LiveSidebarState = DEFAULT_LIVE_SIDEBAR_STATE
): LiveSidebarState {
    const storedValue = localStorage.getItem(storageKey);
    return isLiveSidebarState(storedValue) ? storedValue : fallback;
}
