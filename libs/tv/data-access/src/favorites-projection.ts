import type { Media, UserData } from '@iptvnator/tv/util';

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
    return activeFavoriteEntries(data).flatMap(([, { record, media }]) =>
        record.state.member && media ? [media] : []
    );
}

export function isSharedFavorite(data: UserData, item: Media): boolean {
    return sharedFavoriteMedia(data).some((media) => media.id === item.id);
}

/** Shared state takes precedence for items it knows; local copies remain intact. */
export function favoriteItems(data: UserData): Media[] {
    if (data.favoritesMode !== 'shared') return data.favorites;
    const visible = new Map(data.favorites.map((item) => [item.id, item]));
    for (const [, { record, media }] of activeFavoriteEntries(data)) {
        if (!media) continue;
        if (record.state.member) {
            if (!visible.has(media.id)) visible.set(media.id, media);
        } else if (record.base.revision || record.pending.length) {
            visible.delete(media.id);
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
