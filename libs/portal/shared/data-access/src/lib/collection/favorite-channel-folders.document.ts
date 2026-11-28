import {
    resolveStalkerProviderId,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';

export interface FavoriteChannelFolder {
    id: string;
    name: string;
}

export interface FolderDocument {
    version: 1;
    folders: FavoriteChannelFolder[];
    assignments: Record<string, string>;
    // An interrupted provider write leaves the confirmed document intact.
    pendingAdd?: string;
}

export const STORAGE_KEY = 'global-favorite-channel-folders-v1';
export const EMPTY: FolderDocument = {
    version: 1,
    folders: [],
    assignments: {},
};
export type FolderChannel = Pick<
    UnifiedCollectionItem,
    | 'sourceType'
    | 'playlistId'
    | 'streamUrl'
    | 'xtreamId'
    | 'stalkerId'
    | 'stalkerItem'
    | 'radio'
> & { contentType?: UnifiedCollectionItem['contentType'] };

export class FavoriteFolderNameError extends Error {
    constructor(readonly reason: 'blank' | 'duplicate' | 'too-long') {
        super(reason);
    }
}

export type Digest = (bytes: Uint8Array) => Uint8Array;

export function channelReference(item: FolderChannel): string | null {
    if (!item.playlistId || (item.contentType && item.contentType !== 'live')) {
        return null;
    }
    switch (item.sourceType) {
        case 'm3u':
            return item.streamUrl?.trim() || null;
        case 'xtream':
            return item.xtreamId == null ? null : String(item.xtreamId);
        case 'stalker': {
            const id = item.stalkerItem
                ? resolveStalkerProviderId(item.stalkerItem)
                : String(item.stalkerId ?? '').trim();
            return id
                ? (item.radio === 'true' ? 'radio:' : 'live:') + id
                : null;
        }
    }
}

export function channelKey(item: FolderChannel, digest: Digest): string | null {
    const reference = channelReference(item);
    if (reference === null) return null;
    // The M3U reference may include credentials in the playlist URL.
    const key =
        item.sourceType === 'm3u'
            ? Array.from(digest(new TextEncoder().encode(reference)), (byte) =>
                  byte.toString(16).padStart(2, '0')
              ).join('')
            : reference;
    return JSON.stringify([item.sourceType, item.playlistId, key]);
}
export function parseDocument(raw: string | null): FolderDocument {
    if (raw === null) return EMPTY;
    const value = JSON.parse(raw) as FolderDocument | null;
    if (
        value?.version !== 1 ||
        !Array.isArray(value.folders) ||
        !value.folders.every(
            (folder) =>
                typeof folder?.id === 'string' &&
                typeof folder?.name === 'string'
        ) ||
        typeof value.assignments !== 'object' ||
        value.assignments === null ||
        Array.isArray(value.assignments) ||
        (value.pendingAdd !== undefined && typeof value.pendingAdd !== 'string')
    ) {
        throw new Error('Invalid favorite folders document');
    }
    return value;
}

export function validateName(
    folders: readonly FavoriteChannelFolder[],
    name: string,
    exceptId?: string
): string {
    const trimmed = name.trim();
    if (!trimmed) throw new FavoriteFolderNameError('blank');
    if (trimmed.length > 100) throw new FavoriteFolderNameError('too-long');
    const normalized = trimmed.normalize().toLowerCase();
    if (
        folders.some(
            (folder) =>
                folder.id !== exceptId &&
                folder.name.normalize().toLowerCase() === normalized
        )
    ) {
        throw new FavoriteFolderNameError('duplicate');
    }
    return trimmed;
}
