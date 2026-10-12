import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';

/** One playlist's Xtream user data from one place (browser or server). */
export type XtreamUserData = Partial<Record<ServerUserStateNamespace, unknown>>;

const SNAPSHOTS = 'xtream-collection-items';

/**
 * Older favorites and history name content by its bare Xtream id, which
 * repeats across live, movie and series. Before two copies are combined,
 * each one's bare ids become typed keys (`live:42`) using that copy's own
 * collection snapshots, the same evidence the PWA reads them with; ids
 * without a snapshot stay as they are.
 */
export function typeLegacyXtreamRefs(data: XtreamUserData): XtreamUserData {
    const snapshots = isRecord(data[SNAPSHOTS]) ? data[SNAPSHOTS] : {};
    const typed = (key: unknown): unknown => {
        if (typeof key !== 'number') {
            return key;
        }
        const snapshot = snapshots[String(key)];
        return isRecord(snapshot) &&
            snapshot['xtream_id'] === key &&
            typeof snapshot['type'] === 'string'
            ? `${snapshot['type']}:${key}`
            : key;
    };

    const result: XtreamUserData = { ...data };
    const favorites = data['xtream-favorites'];
    if (Array.isArray(favorites)) {
        result['xtream-favorites'] = favorites.map(typed);
    }
    const recent = data['xtream-recent-items'];
    if (Array.isArray(recent)) {
        result['xtream-recent-items'] = recent.map((item) =>
            isRecord(item) ? { ...item, id: typed(item['id']) } : item
        );
    }
    if (isRecord(data[SNAPSHOTS])) {
        const rekeyed: Record<string, unknown> = {};
        for (const [key, snapshot] of Object.entries(snapshots)) {
            rekeyed[String(/^\d+$/.test(key) ? typed(Number(key)) : key)] =
                snapshot;
        }
        result[SNAPSHOTS] = rekeyed;
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
