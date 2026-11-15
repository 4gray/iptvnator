import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
import { stalkerMediaReference } from './favorites-refs';
import { identity, type Media, type UserData } from '@iptvnator/tv/util';

export function activeFavoriteEntries(data: UserData) {
    if (data.favoritesMode !== 'shared' || !data.library) return [];
    const sources = new Map(
        data.sources.map((source) => [source.libraryId, source])
    );
    return Object.entries(data.sharedFavorites).filter(
        ([, { address, media }]) => {
            const source = sources.get(address.sourceId);
            const context = data.sharedFavoriteContexts[address.sourceId];
            return (
                address.instanceId === data.library?.instanceId &&
                address.sourceIncarnation === context?.sourceIncarnation &&
                source?.provider === address.content.provider &&
                (!media || media.sourceId === source.id)
            );
        }
    );
}

export function sharedFavoriteMedia(data: UserData): Media[] {
    return activeFavoriteEntries(data)
        .map(([, { record, media }]) =>
            record.state.member ? media : undefined
        )
        .filter((media): media is Media => !!media);
}

export function isSharedFavorite(data: UserData, item: Media): boolean {
    return sharedFavoriteMedia(data).some((media) => media.id === item.id);
}

/** Shared state takes precedence for items it knows; local copies remain intact. */
export function favoriteItems(data: UserData): Media[] {
    if (data.favoritesMode !== 'shared') return data.favorites;
    const visible = new Map(data.favorites.map((item) => [item.id, item]));
    const localStalker = new Map<string, Media>();
    for (const item of data.favorites) {
        const reference = stalkerMediaReference(item);
        if (reference)
            localStalker.set(
                JSON.stringify([
                    item.sourceId,
                    favoriteReferenceKey(reference),
                ]),
                item
            );
    }
    for (const [, { address, record, media }] of activeFavoriteEntries(data)) {
        if (
            address.content.provider === 'xtream' &&
            record.state.snapshot?.identityConflict
        ) {
            const source = data.sources.find(
                (candidate) => candidate.libraryId === address.sourceId
            );
            if (source)
                visible.delete(
                    identity(source, address.content.kind, address.content.id)
                );
        }
        if (!media) continue;
        const local =
            address.content.provider === 'stalker'
                ? localStalker.get(
                      JSON.stringify([
                          media.sourceId,
                          favoriteReferenceKey(address.content),
                      ])
                  )
                : visible.get(media.id);
        if (record.state.member) {
            if (local) {
                visible.set(local.id, {
                    ...local,
                    raw: {
                        ...local.raw,
                        ...(address.content.provider === 'xtream'
                            ? {
                                  sharedFavoriteHints:
                                      media.raw.sharedFavoriteHints,
                              }
                            : {}),
                        ...(address.content.provider === 'stalker'
                            ? { sharedReference: address.content }
                            : {}),
                    },
                });
            } else visible.set(media.id, media);
        } else if (record.base.revision || record.pending.length) {
            visible.delete(local?.id ?? media.id);
        }
    }
    return [...visible.values()];
}

export function sharedFavoriteCounts(data: UserData) {
    let members = 0;
    let pending = 0;
    let conflicts = 0;
    for (const [, { record }] of activeFavoriteEntries(data)) {
        if (record.state.member) members++;
        pending += record.pending.filter(
            (intent) => intent.consentGeneration === data.favoritesConsent
        ).length;
        if (record.conflict) conflicts++;
    }
    return { members, pending, conflicts };
}

export function sameFavorite(first: Media, second: Media): boolean {
    if (first.id === second.id) return true;
    if (first.sourceId !== second.sourceId || first.kind !== second.kind)
        return false;
    const left = stalkerMediaReference(first);
    const right = stalkerMediaReference(second);
    return (
        !!left &&
        !!right &&
        favoriteReferenceKey(left) === favoriteReferenceKey(right)
    );
}
