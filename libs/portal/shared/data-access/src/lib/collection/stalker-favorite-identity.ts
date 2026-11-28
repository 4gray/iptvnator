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

function stalkerCollectionReference(item: StalkerPortalItem, shared: boolean) {
    // Local historical radio favorites can carry the radio hint in their command.
    return stalkerFavoriteReference(
        !shared && isStalkerRadioItem(item) ? { ...item, radio: true } : item
    );
}

export function stalkerFavoriteRowIdentity(
    favorite: StalkerPortalItem,
    shared: boolean
) {
    const reference = stalkerCollectionReference(favorite, shared);
    const id = reference?.id ?? providerId(favorite);
    return {
        providerId: id,
        kind: reference?.kind,
        rowId: reference ? JSON.stringify(reference) : id,
    };
}

export function matchStalkerFavoriteRows(
    favorites: readonly StalkerPortalItem[],
    rows: readonly UnifiedCollectionItem[],
    shared: boolean
): Set<StalkerPortalItem> {
    const byProviderId = new Map<string, StalkerPortalItem[]>();
    const byIdentity = new Map<string, StalkerPortalItem[]>();
    const identity = (favorite: StalkerPortalItem, id: string | undefined) =>
        id
            ? JSON.stringify(stalkerCollectionReference(favorite, shared) ?? id)
            : JSON.stringify(['local snapshot', favorite]);
    for (const favorite of favorites) {
        const id = providerId(favorite);
        if (id) {
            const sameId = byProviderId.get(id) ?? [];
            sameId.push(favorite);
            byProviderId.set(id, sameId);
        }
        const key = identity(favorite, id);
        const sameIdentity = byIdentity.get(key) ?? [];
        sameIdentity.push(favorite);
        byIdentity.set(key, sameIdentity);
    }

    const selected = new Set<StalkerPortalItem>();
    for (const row of rows) {
        const item = row.stalkerItem as StalkerPortalItem | undefined;
        if (item) {
            const id = providerId(item);
            const matches = byIdentity.get(identity(item, id));
            if (id) {
                for (const match of matches ?? []) {
                    selected.add(match);
                }
            } else {
                // Each rendered local snapshot can select one persisted copy.
                const match = matches?.pop();
                if (match) selected.add(match);
            }
            continue;
        }
        const id = String(row.stalkerId ?? row.uid.split('::')[2] ?? '').trim();
        const matches = byProviderId.get(id);
        if (matches?.length === 1) selected.add(matches[0]);
    }
    return selected;
}
