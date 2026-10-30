import { PortalRailSection } from '@iptvnator/portal/shared/util';

/**
 * The one debounce between a keystroke in the header search box and the
 * applied term; pages that search on the applied term (global search
 * included) run at once. 300 ms sits above the inter-key gap of steady
 * typing, so a word typed in one go is applied once.
 * See docs/architecture/performance-journeys.md (J4).
 */
export const SEARCH_INPUT_DEBOUNCE_MS = 300;

/**
 * How long a purely local Xtream load (reading the saved catalog from SQLite)
 * may run before the full-screen import overlay appears. A warm catalog
 * finishes in tens of milliseconds; showing the overlay for that only flashes
 * it between the skeleton and the loaded page. Remote imports and refresh
 * preparation are not delayed.
 */
export const XTREAM_LOCAL_LOAD_OVERLAY_DELAY_MS = 300;

export const SEARCH_PLAYLIST_PLACEHOLDER =
    'WORKSPACE.SHELL.SEARCH_PLAYLIST_PLACEHOLDER';
export const SEARCH_SECTION_PLACEHOLDER =
    'WORKSPACE.SHELL.SEARCH_SECTION_PLACEHOLDER';
export const FILTER_SECTION_PLACEHOLDER =
    'WORKSPACE.SHELL.FILTER_SECTION_PLACEHOLDER';
export const SEARCH_SOURCES_PLACEHOLDER =
    'WORKSPACE.SHELL.SEARCH_SOURCES_PLACEHOLDER';
export const SEARCH_SETTINGS_PLACEHOLDER =
    'WORKSPACE.SHELL.SEARCH_SETTINGS_PLACEHOLDER';
export const SEARCH_LOADED_ONLY_STATUS =
    'WORKSPACE.SHELL.SEARCH_STATUS_LOADED_ONLY';

export const RAIL_TOOLTIP_KEYS: Readonly<
    Partial<Record<PortalRailSection, string>>
> = {
    vod: 'WORKSPACE.SHELL.RAIL_MOVIES',
    live: 'WORKSPACE.SHELL.RAIL_LIVE',
    itv: 'WORKSPACE.SHELL.RAIL_LIVE',
    radio: 'WORKSPACE.SHELL.RAIL_RADIO',
    series: 'WORKSPACE.SHELL.RAIL_SERIES',
    'recently-added': 'WORKSPACE.SHELL.RAIL_RECENTLY_ADDED',
    search: 'WORKSPACE.SHELL.RAIL_SEARCH',
    recent: 'WORKSPACE.SHELL.RAIL_RECENT',
    favorites: 'WORKSPACE.SHELL.RAIL_FAVORITES',
    downloads: 'WORKSPACE.SHELL.RAIL_DOWNLOADS',
    all: 'WORKSPACE.SHELL.RAIL_ALL_CHANNELS',
    groups: 'WORKSPACE.SHELL.RAIL_GROUPS',
};

export type XtreamImportPhaseTone = 'remote' | 'local' | null;

/**
 * Header toggle for the live-channel rail of the current route. It exists in
 * both rail states so the control never moves: inside the rail the chevron
 * disappears together with the rail it hides.
 */
export interface WorkspaceHeaderSidebarToggle {
    /** True while the rail is visible; drives `aria-pressed`. */
    expanded: boolean;
    tooltip: string;
    ariaLabel: string;
}
