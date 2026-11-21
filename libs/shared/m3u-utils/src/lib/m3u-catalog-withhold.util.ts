import {
    M3uCatalogEntry,
    M3uCatalogGroup,
    M3uCatalogIndex,
} from './m3u-catalog-index.util';
import { M3uContentKind } from './m3u-content-kind.util';

/**
 * The groups a parental lock withholds right now: a set of exact
 * `group-title` values, `'all'` when the lock store cannot be read (the
 * lock fails closed), or null when nothing is withheld.
 */
export type M3uWithheldGroups = ReadonlySet<string> | 'all' | null;

/** Whether a row of `groupTitle` is withheld. Rows with no group use ''. */
export function isM3uGroupWithheld(
    withheld: M3uWithheldGroups,
    groupTitle: string | null | undefined
): boolean {
    return withheld === 'all' || !!withheld?.has(groupTitle ?? '');
}

const KINDS: readonly M3uContentKind[] = ['live', 'movie', 'episode', 'radio'];

/**
 * The index with every withheld group taken out, as the channel list
 * already hides locked groups. `hasNonLiveContent` is kept from the full
 * index on purpose: locking a group must not switch the Movies/Series split
 * itself off and pour the remaining films back into the channel list.
 */
export function withholdM3uCatalogGroups<T extends M3uCatalogEntry>(
    index: M3uCatalogIndex<T>,
    withheld: M3uWithheldGroups
): M3uCatalogIndex<T> {
    if (!withheld) {
        return index;
    }

    const visible = (row: T) => !isM3uGroupWithheld(withheld, row.group?.title);
    const byKind = {} as Record<M3uContentKind, readonly T[]>;
    const groupsByKind = {} as Record<
        M3uContentKind,
        readonly M3uCatalogGroup<T>[]
    >;
    const counts = {} as Record<M3uContentKind, number>;
    for (const kind of KINDS) {
        byKind[kind] = index.byKind[kind].filter(visible);
        groupsByKind[kind] = index.groupsByKind[kind].filter(
            (group) => !isM3uGroupWithheld(withheld, group.title)
        );
        counts[kind] = byKind[kind].length;
    }

    return {
        byKind,
        liveChannels: index.liveChannels.filter(visible),
        groupsByKind,
        counts,
        hasNonLiveContent: index.hasNonLiveContent,
    };
}
