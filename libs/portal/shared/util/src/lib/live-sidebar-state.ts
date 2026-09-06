/**
 * Live-TV panel visibility, nested from the outside in:
 *
 * - `expanded`: categories rail + channels rail + player.
 * - `categories-hidden`: channels rail + player. The categories rail is
 *   folded away but stays one click off through the channels header's
 *   category dropdown. Layouts without a categories rail (M3U, the unified
 *   live tab) treat it exactly like `expanded`.
 * - `collapsed`: player only ("theater").
 *
 * There is deliberately no "channels hidden, categories visible" state: a
 * category click has to bring the channels back anyway.
 */
export type LiveSidebarState = 'expanded' | 'categories-hidden' | 'collapsed';

export const LIVE_SIDEBAR_STATE_STORAGE_KEY = 'live-sidebar-state';
export const DEFAULT_LIVE_SIDEBAR_STATE: LiveSidebarState = 'expanded';

export function isLiveSidebarState(value: unknown): value is LiveSidebarState {
    return (
        value === 'expanded' ||
        value === 'categories-hidden' ||
        value === 'collapsed'
    );
}

/**
 * Reads the persisted state. `collapsed` is a moment mode and does not
 * survive a restart: it comes back as `categories-hidden`, so a fresh launch
 * always shows the channels list — a user who forgot they had hidden it
 * otherwise reports "all my channels disappeared" (#1458). The hidden
 * categories rail is a stable preference and is restored as stored.
 */
export function restoreLiveSidebarState(
    storageKey: string = LIVE_SIDEBAR_STATE_STORAGE_KEY,
    fallback: LiveSidebarState = DEFAULT_LIVE_SIDEBAR_STATE
): LiveSidebarState {
    const storedValue = localStorage.getItem(storageKey);
    if (!isLiveSidebarState(storedValue)) {
        return fallback;
    }
    return storedValue === 'collapsed' ? 'categories-hidden' : storedValue;
}

export function persistLiveSidebarState(
    state: LiveSidebarState,
    storageKey: string = LIVE_SIDEBAR_STATE_STORAGE_KEY
): void {
    localStorage.setItem(storageKey, state);
}
