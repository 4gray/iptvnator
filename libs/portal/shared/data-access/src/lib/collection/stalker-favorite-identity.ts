import {
    isStalkerRadioItem,
    type StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import { stalkerFavoriteReference } from '@iptvnator/shared/interfaces/favorites-sync';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

function providerId(item: StalkerPortalItem): string | undefined {
    return [item.id, item.stream_id, item.series_id, item.movie_id]
        .map((id) => String(id ?? '').trim())
        .find(Boolean);
}

export function stalkerCollectionReference(
    item: StalkerPortalItem,
    shared: boolean
) {
    // Local historical radio favorites can carry the radio hint in their command.
    return stalkerFavoriteReference(
        !shared && isStalkerRadioItem(item) ? { ...item, radio: true } : item
    );
}

export function stalkerFavoriteRowIdentities(
    favorites: readonly StalkerPortalItem[],
    shared: boolean
) {
    const ids = favorites.map(providerId);
    const counts = new Map<string, number>();
    for (const id of ids) {
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return favorites.map((favorite, index) => {
        const id = ids[index];
        const reference = stalkerCollectionReference(favorite, shared);
        const useTypedId = shared || (id && (counts.get(id) ?? 0) > 1);
        return {
            providerId: id,
            kind: reference?.kind,
            rowId: useTypedId && reference ? JSON.stringify(reference) : id,
        };
    });
}

export function matchStalkerFavoriteRows(
    favorites: readonly StalkerPortalItem[],
    rows: readonly UnifiedCollectionItem[],
    shared: boolean
): Set<StalkerPortalItem> {
    const byProviderId = new Map<string, StalkerPortalItem[]>();
    const byIdentity = new Map<string, StalkerPortalItem[]>();
    const identity = (favorite: StalkerPortalItem, id: string) =>
        JSON.stringify(stalkerCollectionReference(favorite, shared) ?? id);
    for (const favorite of favorites) {
        const id = providerId(favorite);
        if (!id) continue;
        const key = identity(favorite, id);
        const sameId = byProviderId.get(id) ?? [];
        sameId.push(favorite);
        byProviderId.set(id, sameId);
        const sameIdentity = byIdentity.get(key) ?? [];
        sameIdentity.push(favorite);
        byIdentity.set(key, sameIdentity);
    }

    const selected = new Set<StalkerPortalItem>();
    for (const row of rows) {
        const item = row.stalkerItem as StalkerPortalItem | undefined;
        if (item) {
            const id = providerId(item);
            if (id) {
                for (const match of byIdentity.get(identity(item, id)) ?? []) {
                    selected.add(match);
                }
            }
            continue;
        }
        const id = String(row.stalkerId ?? row.uid.split('::')[2] ?? '').trim();
        const matches = byProviderId.get(id);
        if (matches?.length === 1) selected.add(matches[0]);
    }
    return selected;
}
