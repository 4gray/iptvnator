import type { MultiviewPickerRow } from './multiview-picker-row';

/** Search results, grouped as the picker lists them (spec 9.5). */
export interface MultiviewPickerSearchResults {
    /** Live rows whose current programme matches. */
    readonly onAir: readonly MultiviewPickerRow[];
    readonly channels: readonly MultiviewPickerRow[];
    readonly movies: readonly MultiviewPickerRow[];
    readonly series: readonly MultiviewPickerRow[];
}

export const EMPTY_PICKER_SEARCH: MultiviewPickerSearchResults = {
    onAir: [],
    channels: [],
    movies: [],
    series: [],
};

/** Case- and accent-insensitive form used for matching. */
export function normalizeSearchText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLocaleLowerCase()
        .trim();
}

function matcher(term: string): ((text: string | null) => boolean) | null {
    const words = normalizeSearchText(term).split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return (text) => {
        if (!text) return false;
        const value = normalizeSearchText(text);
        return words.every((word) => value.includes(word));
    };
}

/**
 * Client-side search over rows the picker already has: the PWA's whole
 * search, and the part of the Electron search that covers favourites,
 * recent and the current playlist's channels. Each row appears once per
 * group, in the order it was given.
 */
export function searchPickerRows(
    rows: readonly MultiviewPickerRow[],
    term: string
): MultiviewPickerSearchResults {
    const matches = matcher(term);
    if (!matches) return EMPTY_PICKER_SEARCH;
    const groups = {
        onAir: [] as MultiviewPickerRow[],
        channels: [] as MultiviewPickerRow[],
        movies: [] as MultiviewPickerRow[],
        series: [] as MultiviewPickerRow[],
    };
    const seen = {
        onAir: new Set<string>(),
        channels: new Set<string>(),
        movies: new Set<string>(),
        series: new Set<string>(),
    };
    const add = (group: keyof typeof groups, row: MultiviewPickerRow) => {
        if (seen[group].has(row.sessionKey)) return;
        seen[group].add(row.sessionKey);
        groups[group].push(row);
    };
    for (const row of rows) {
        const type = row.item.contentType;
        if (type === 'live' && matches(row.program?.title ?? null)) {
            add('onAir', row);
        }
        if (!matches(row.item.name)) continue;
        add(
            type === 'live'
                ? 'channels'
                : type === 'movie'
                  ? 'movies'
                  : 'series',
            row
        );
    }
    return groups;
}

/** Adds rows found elsewhere (the SQLite search) after the loaded ones. */
export function mergePickerSearch(
    first: MultiviewPickerSearchResults,
    second: MultiviewPickerSearchResults
): MultiviewPickerSearchResults {
    const merge = (
        a: readonly MultiviewPickerRow[],
        b: readonly MultiviewPickerRow[]
    ) => {
        const keys = new Set(a.map((row) => row.sessionKey));
        return [...a, ...b.filter((row) => !keys.has(row.sessionKey))];
    };
    return {
        onAir: merge(first.onAir, second.onAir),
        channels: merge(first.channels, second.channels),
        movies: merge(first.movies, second.movies),
        series: merge(first.series, second.series),
    };
}
