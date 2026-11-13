import type { MultiviewPickerRow } from './multiview-picker-row';
import type { MultiviewPickerSearchResults } from './multiview-picker-search';
import type {
    MultiviewPickerGroupId,
    MultiviewPickerSection,
} from './multiview-picker-sections';

/** The type chips above the list (spec 9.5). */
export type MultiviewPickerType = 'all' | 'live' | 'movie' | 'series';

export const MULTIVIEW_PICKER_TYPES: readonly MultiviewPickerType[] = [
    'all',
    'live',
    'movie',
    'series',
];

/** A captioned run of rows as the list renders it. */
export interface MultiviewPickerListGroup {
    readonly id: string;
    /** Translation key of the caption; null for an uncaptioned list. */
    readonly captionKey: string | null;
    readonly rows: readonly MultiviewPickerRow[];
}

const GROUP_CAPTIONS: Readonly<Record<MultiviewPickerGroupId, string | null>> =
    {
        'from-favorites': 'PLAYER.MULTIVIEW.PICKER.GROUP_FROM_FAVORITES',
        'more-on-air': 'PLAYER.MULTIVIEW.PICKER.GROUP_MORE_ON_AIR',
        all: null,
    };

function matchesType(row: MultiviewPickerRow, type: MultiviewPickerType) {
    return type === 'all' || row.item.contentType === type;
}

function filtered(
    groups: readonly MultiviewPickerListGroup[],
    type: MultiviewPickerType
): MultiviewPickerListGroup[] {
    return groups
        .map((group) => ({
            ...group,
            rows: group.rows.filter((row) => matchesType(row, type)),
        }))
        .filter((group) => group.rows.length > 0);
}

export function sectionGroups(
    section: MultiviewPickerSection | undefined
): MultiviewPickerListGroup[] {
    return (section?.groups ?? []).map((group) => ({
        id: group.id,
        captionKey: GROUP_CAPTIONS[group.id],
        rows: group.rows,
    }));
}

export function searchGroups(
    results: MultiviewPickerSearchResults
): MultiviewPickerListGroup[] {
    return [
        {
            id: 'on-air',
            captionKey: 'PLAYER.MULTIVIEW.PICKER.SEARCH_ON_AIR',
            rows: results.onAir,
        },
        {
            id: 'channels',
            captionKey: 'PLAYER.MULTIVIEW.PICKER.SEARCH_CHANNELS',
            rows: results.channels,
        },
        {
            id: 'movies',
            captionKey: 'PLAYER.MULTIVIEW.PICKER.SEARCH_MOVIES',
            rows: results.movies,
        },
        {
            id: 'series',
            captionKey: 'PLAYER.MULTIVIEW.PICKER.SEARCH_SERIES',
            rows: results.series,
        },
    ].filter((group) => group.rows.length > 0);
}

/** Every row of the groups, in order (no `flatMap`: the web lib is ES2018). */
export function rowsOf(
    groups: readonly { readonly rows: readonly MultiviewPickerRow[] }[]
): MultiviewPickerRow[] {
    const rows: MultiviewPickerRow[] = [];
    for (const group of groups) rows.push(...group.rows);
    return rows;
}

/** The visible list for a type chip. */
export function listForType(
    groups: readonly MultiviewPickerListGroup[],
    type: MultiviewPickerType
): MultiviewPickerListGroup[] {
    return filtered(groups, type);
}

/** Counts per type chip, of the list before filtering. */
export function typeCounts(
    groups: readonly MultiviewPickerListGroup[]
): Readonly<Record<MultiviewPickerType, number>> {
    const keys = new Set<string>();
    const counts = { all: 0, live: 0, movie: 0, series: 0 };
    for (const group of groups) {
        for (const row of group.rows) {
            if (keys.has(row.sessionKey)) continue;
            keys.add(row.sessionKey);
            counts.all++;
            counts[row.item.contentType]++;
        }
    }
    return counts;
}

/**
 * The row the arrow keys land on next: the following (or previous)
 * enabled row, wrapping around; the first enabled row without a current.
 */
export function nextActiveKey(
    keys: readonly string[],
    current: string | null,
    step: 1 | -1
): string | null {
    if (keys.length === 0) return null;
    const index = current === null ? -1 : keys.indexOf(current);
    if (index === -1) return step === 1 ? keys[0] : keys[keys.length - 1];
    return keys[(index + step + keys.length) % keys.length];
}
