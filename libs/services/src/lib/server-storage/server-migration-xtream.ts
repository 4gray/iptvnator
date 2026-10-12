import type { ServerUserStateNamespace } from '@iptvnator/shared/interfaces';

/** One playlist's Xtream user data from one place (browser or server). */
export type XtreamUserData = Partial<Record<ServerUserStateNamespace, unknown>>;

const SNAPSHOTS = 'xtream-collection-items';

/**
 * Older favorites and history name content by its bare Xtream id, which
 * repeats across live, movie and series. Before two copies are combined,
 * each one's bare ids become typed keys (`live:42`) using that copy's own
 * collection snapshots, the same evidence the PWA reads them with; ids
 * without a snapshot stay as they are. Snapshots gain the typed key and
 * keep the bare one.
 */
export function typeLegacyXtreamRefs(data: XtreamUserData): XtreamUserData {
    const snapshots = isRecord(data[SNAPSHOTS]) ? data[SNAPSHOTS] : {};
    const typed = (key: unknown): unknown => {
        // Bare ids were stored as numbers and, older still, numeric strings.
        const id =
            typeof key === 'number'
                ? key
                : typeof key === 'string' && /^\d+$/.test(key)
                  ? Number(key)
                  : null;
        if (id === null) {
            return key;
        }
        const snapshot = snapshots[String(id)];
        return isRecord(snapshot) &&
            snapshot['xtream_id'] === id &&
            typeof snapshot['type'] === 'string'
            ? `${snapshot['type']}:${id}`
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
        // The bare key stays as an alias: a reference not yet rewritten (a
        // failed write, an older client) still finds its snapshot, and a
        // retry can type it again. A typed snapshot that exists is newer.
        const aliased: Record<string, unknown> = { ...snapshots };
        for (const [key, snapshot] of Object.entries(snapshots)) {
            const typedKey = String(typed(Number(key)));
            if (/^\d+$/.test(key) && !(typedKey in snapshots)) {
                aliased[typedKey] = snapshot;
            }
        }
        result[SNAPSHOTS] = aliased;
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
