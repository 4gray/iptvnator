import type { MultiviewTileKind } from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import {
    isRadio,
    type MultiviewPickerRow,
    pickerSessionKey,
} from './multiview-picker-row';

export type MultiviewPickerSectionId =
    'live-now' | 'continue' | 'favorites' | 'recent' | 'playlist';

/** "Quick" navigation, in order (spec 9.5). */
export const MULTIVIEW_PICKER_QUICK_SECTIONS = [
    'live-now',
    'continue',
    'favorites',
    'recent',
] as const satisfies readonly MultiviewPickerSectionId[];

export type MultiviewPickerGroupId = 'from-favorites' | 'more-on-air' | 'all';

export interface MultiviewPickerGroup {
    readonly id: MultiviewPickerGroupId;
    readonly rows: readonly MultiviewPickerRow[];
}

export interface MultiviewPickerSection {
    readonly id: MultiviewPickerSectionId;
    readonly groups: readonly MultiviewPickerGroup[];
    /** Shown beside the section in the navigation. */
    readonly count: number;
}

export interface MultiviewContinueItem {
    readonly item: UnifiedCollectionItem;
    readonly position: PlaybackPositionData;
}

/** What the sections are built from; each list already in its own order. */
export interface MultiviewPickerSources {
    readonly favorites: readonly UnifiedCollectionItem[];
    /** Most recently viewed first. */
    readonly recent: readonly UnifiedCollectionItem[];
    readonly continueItems: readonly MultiviewContinueItem[];
    /** Live channels of the current playlist, in playlist order (Q2). */
    readonly playlist: readonly UnifiedCollectionItem[];
    /** Parental lock and unavailable catalog rows, as in the source lists. */
    readonly isAllowed: (item: UnifiedCollectionItem) => boolean;
    readonly toRow: (
        item: UnifiedCollectionItem,
        position?: PlaybackPositionData
    ) => MultiviewPickerRow;
}

function uniqueRows(
    items: readonly UnifiedCollectionItem[],
    sources: MultiviewPickerSources,
    seen = new Set<string>()
): MultiviewPickerRow[] {
    const rows: MultiviewPickerRow[] = [];
    for (const item of items) {
        if (isRadio(item) || !sources.isAllowed(item)) continue;
        const key = pickerSessionKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(sources.toRow(item));
    }
    return rows;
}

const isLive = (item: UnifiedCollectionItem) => item.contentType === 'live';

function section(
    id: MultiviewPickerSectionId,
    groups: readonly MultiviewPickerGroup[]
): MultiviewPickerSection {
    const filled = groups.filter((group) => group.rows.length > 0);
    return {
        id,
        groups: filled,
        count: filled.reduce((sum, group) => sum + group.rows.length, 0),
    };
}

/**
 * "Live now": favourite channels first, then the rest on air — recently
 * viewed first, then the current playlist in its order (D9). A channel is
 * listed once.
 */
function liveNow(sources: MultiviewPickerSources): MultiviewPickerSection {
    const seen = new Set<string>();
    const favorites = uniqueRows(
        sources.favorites.filter(isLive),
        sources,
        seen
    );
    const more = uniqueRows(
        [...sources.recent.filter(isLive), ...sources.playlist],
        sources,
        seen
    );
    return section('live-now', [
        { id: 'from-favorites', rows: favorites },
        { id: 'more-on-air', rows: more },
    ]);
}

function continueWatching(
    sources: MultiviewPickerSources
): MultiviewPickerSection {
    const rows = sources.continueItems
        .filter(({ item }) => sources.isAllowed(item))
        .map(({ item, position }) => sources.toRow(item, position));
    return section('continue', [{ id: 'all', rows }]);
}

/** Every section of the picker, in navigation order. */
export function composePickerSections(
    sources: MultiviewPickerSources
): MultiviewPickerSection[] {
    return [
        liveNow(sources),
        continueWatching(sources),
        section('favorites', [
            { id: 'all', rows: uniqueRows(sources.favorites, sources) },
        ]),
        section('recent', [
            { id: 'all', rows: uniqueRows(sources.recent, sources) },
        ]),
        section('playlist', [
            { id: 'all', rows: uniqueRows(sources.playlist, sources) },
        ]),
    ];
}

/**
 * Spec 9.5: the section the picker opens on. Next to a film the viewer
 * likely wants something live, next to a channel something to continue;
 * once they chose a section themselves, that one.
 */
export function defaultPickerSection(
    mainKind: MultiviewTileKind | null,
    lastUsed: MultiviewPickerSectionId | null
): MultiviewPickerSectionId {
    if (lastUsed) return lastUsed;
    return mainKind === 'live' ? 'continue' : 'live-now';
}
