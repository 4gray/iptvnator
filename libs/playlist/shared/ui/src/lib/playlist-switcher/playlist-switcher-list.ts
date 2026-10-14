import {
    matchesSourceQuery,
    matchesSourceType,
    SourcesTypeFilter,
} from '@iptvnator/playlist/shared/util';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';

export const SWITCHER_TYPE_STORAGE_KEY = 'playlist-switcher:type:v2';
/** The three checkboxes the segmented type filter replaced. */
const LEGACY_TYPE_STORAGE_KEY = 'playlist-switcher:type-filters';
/** The search is no longer kept between openings. */
const LEGACY_QUERY_STORAGE_KEY = 'playlist-switcher:search-query';
const TYPES: readonly SourcesTypeFilter[] = ['all', 'm3u', 'xtream', 'stalker'];
/** Below this many sources the "Recent" group would repeat the whole list. */
export const SWITCHER_RECENT_MIN_SOURCES = 6;

/**
 * The remembered type. The old checkbox set maps to the one type it left
 * on, or to "All" when it left several (the only states it could save).
 */
export function readSwitcherType(): SourcesTypeFilter {
    try {
        const stored = localStorage.getItem(SWITCHER_TYPE_STORAGE_KEY);
        if (TYPES.includes(stored as SourcesTypeFilter)) {
            return stored as SourcesTypeFilter;
        }
        const legacy = JSON.parse(
            localStorage.getItem(LEGACY_TYPE_STORAGE_KEY) ?? 'null'
        ) as Record<string, boolean> | null;
        localStorage.removeItem(LEGACY_QUERY_STORAGE_KEY);
        if (legacy && typeof legacy === 'object') {
            const on = (['m3u', 'xtream', 'stalker'] as const).filter(
                (type) => legacy[type] !== false
            );
            localStorage.removeItem(LEGACY_TYPE_STORAGE_KEY);
            const type = on.length === 1 ? on[0] : 'all';
            writeSwitcherType(type);
            return type;
        }
    } catch {
        // Fall through to the default.
    }
    return 'all';
}

export function writeSwitcherType(type: SourcesTypeFilter): void {
    try {
        localStorage.setItem(SWITCHER_TYPE_STORAGE_KEY, type);
    } catch {
        // The choice still applies while the app runs.
    }
}

export interface SwitcherOption {
    /** Unique per group: a recent source is also listed under "All". */
    id: string;
    group: 'recent' | 'all';
    playlist: PlaylistMeta;
}

export interface SwitcherGroups {
    recent: SwitcherOption[];
    all: SwitcherOption[];
}

/**
 * The switcher's two groups: "Recent" (newest first, only without a search
 * and when enough sources are shown to be worth it) and "All" in the given
 * order, both narrowed by type and search.
 */
export function buildSwitcherGroups(
    ordered: readonly PlaylistMeta[],
    recentIds: readonly string[],
    type: SourcesTypeFilter,
    query: string
): SwitcherGroups {
    const visible = ordered.filter(
        (playlist) =>
            matchesSourceType(playlist, type) &&
            matchesSourceQuery(playlist, query)
    );
    const option =
        (group: SwitcherOption['group']) =>
        (playlist: PlaylistMeta): SwitcherOption => ({
            id: `playlist-switcher-${group}-${playlist._id}`,
            group,
            playlist,
        });
    // Counted after the type filter: a short filtered list would show the
    // same sources twice, and the keyboard would visit each twice.
    const showRecent =
        !query.trim() && visible.length >= SWITCHER_RECENT_MIN_SOURCES;
    const byId = new Map(visible.map((playlist) => [playlist._id, playlist]));
    const recent = showRecent
        ? recentIds
              .map((id) => byId.get(id))
              .filter((playlist): playlist is PlaylistMeta => !!playlist)
              .map(option('recent'))
        : [];
    return { recent, all: visible.map(option('all')) };
}

/** The next highlight for ↑/↓, wrapping at both ends. */
export function moveHighlight(
    current: number,
    delta: 1 | -1,
    count: number
): number {
    if (count === 0) {
        return -1;
    }
    if (current < 0) {
        return delta > 0 ? 0 : count - 1;
    }
    return (current + delta + count) % count;
}
