import type { MultiviewTile } from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { VideoPlayer } from '@iptvnator/shared/interfaces';

/** Synthetic collection rows for the picker specs. */
export function liveItem(
    id: number,
    overrides: Partial<UnifiedCollectionItem> = {}
): UnifiedCollectionItem {
    return {
        uid: `xtream::playlist-1::${id}`,
        name: `Synthetic Channel ${id}`,
        contentType: 'live',
        sourceType: 'xtream',
        playlistId: 'playlist-1',
        playlistName: 'Synthetic Provider',
        xtreamId: id,
        categoryId: 10,
        ...overrides,
    };
}

export function movieItem(
    id: number,
    overrides: Partial<UnifiedCollectionItem> = {}
): UnifiedCollectionItem {
    return {
        uid: `xtream::playlist-1::movie:${id}`,
        name: `Synthetic Film ${id}`,
        contentType: 'movie',
        sourceType: 'xtream',
        playlistId: 'playlist-1',
        playlistName: 'Synthetic Provider',
        xtreamId: id,
        ...overrides,
    };
}

export function tile(
    overrides: Partial<MultiviewTile> & Pick<MultiviewTile, 'id'>
): MultiviewTile {
    return {
        playback: { streamUrl: 'https://stream.example/tile.m3u8', title: 't' },
        playbackSessionKey: `key:${overrides.id}`,
        kind: 'live',
        playlistId: 'playlist-1',
        title: 'Tile',
        engine: VideoPlayer.Html5Player,
        status: 'playing',
        lastPosition: 0,
        ...overrides,
    };
}
