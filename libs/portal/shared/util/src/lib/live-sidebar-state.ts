import type {
    PortalProvider,
    PortalRailSection,
} from './navigation/portal-rail-links';

/**
 * Live-TV panel visibility, nested from the outside in:
 *
 * - `expanded`: categories rail + channels rail + player.
 * - `categories-hidden`: channels rail + player. The categories rail is
 *   folded away but stays one click off through the channels header's
 *   category dropdown. Surfaces without a categories rail (`m3u`,
 *   `collection`) treat it exactly like `expanded`.
 * - `collapsed`: player only ("theater").
 *
 * There is deliberately no "channels hidden, categories visible" state: a
 * category click has to bring the channels back anyway.
 */
export type LiveSidebarState = 'expanded' | 'categories-hidden' | 'collapsed';

/**
 * Collapsible live-channel rails. Each surface remembers its own state:
 * hiding the list in the M3U player must not hide the channel rail of an
 * Xtream/Stalker portal or of the favorites/recent collection pages — the
 * user made that choice in one context, not in all of them.
 */
export type LiveSidebarSurface = 'm3u' | 'portal' | 'collection';

export const LIVE_SIDEBAR_SURFACES: readonly LiveSidebarSurface[] = [
    'm3u',
    'portal',
    'collection',
];

/**
 * Key every live surface shared before the per-surface split. It is no longer
 * read: a stored `collapsed` left every playlist and portal without a channel
 * list and only a 32px chevron to recover it (issue #1458). The state service
 * removes it once, so the update itself restores the list for everyone.
 */
export const LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY = 'live-sidebar-state';
/** @deprecated The legacy shared key; use `liveSidebarStateStorageKey()`. */
export const LIVE_SIDEBAR_STATE_STORAGE_KEY =
    LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY;
export const DEFAULT_LIVE_SIDEBAR_STATE: LiveSidebarState = 'expanded';

export function liveSidebarStateStorageKey(
    surface: LiveSidebarSurface
): string {
    return `${LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY}:${surface}`;
}

export function isLiveSidebarState(value: unknown): value is LiveSidebarState {
    return (
        value === 'expanded' ||
        value === 'categories-hidden' ||
        value === 'collapsed'
    );
}

export function restoreLiveSidebarState(
    storageKey: string,
    fallback: LiveSidebarState = DEFAULT_LIVE_SIDEBAR_STATE
): LiveSidebarState {
    const storedValue = localStorage.getItem(storageKey);
    return isLiveSidebarState(storedValue) ? storedValue : fallback;
}

export function persistLiveSidebarState(
    state: LiveSidebarState,
    storageKey: string
): void {
    localStorage.setItem(storageKey, state);
}

export function forgetLegacyLiveSidebarState(): void {
    try {
        localStorage.removeItem(LEGACY_LIVE_SIDEBAR_STATE_STORAGE_KEY);
    } catch {
        // Storage unavailable (private mode, blocked site data): nothing to forget.
    }
}

/**
 * The rail a portal route renders itself, for a toggle that lives outside the
 * rail (the workspace header). Favorites/recent routes return `null` on
 * purpose: the collection page owns that toggle, because only it knows
 * whether the live tab, and therefore the rail, is on screen.
 */
export function resolveRouteLiveSidebarSurface(
    provider: PortalProvider | null | undefined,
    section: PortalRailSection | null | undefined
): LiveSidebarSurface | null {
    if (!provider || !section) {
        return null;
    }

    switch (provider) {
        case 'playlists':
            return section === 'all' || section === 'groups' ? 'm3u' : null;
        case 'xtreams':
            return section === 'live' ? 'portal' : null;
        case 'stalker':
            return section === 'itv' || section === 'radio' ? 'portal' : null;
        default:
            return null;
    }
}
