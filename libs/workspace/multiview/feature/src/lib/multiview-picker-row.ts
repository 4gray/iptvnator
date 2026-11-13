import type {
    MultiviewTileKind,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type {
    EpgProgram,
    PlaybackPositionData,
} from '@iptvnator/shared/interfaces';

/** One row of the picker: an item with what the list shows beside it. */
export interface MultiviewPickerRow {
    readonly item: UnifiedCollectionItem;
    /** The tile it would become; null when it only opens its episodes. */
    readonly kind: MultiviewTileKind | null;
    readonly sessionKey: string;
    /** "In tile N": already on screen, so the row is disabled. */
    readonly inTile: number | null;
    /** Current programme of a live row, once its EPG is loaded. */
    readonly program: EpgProgram | null;
    /** Saved progress of a VOD row in "Continue". */
    readonly position: PlaybackPositionData | null;
}

/**
 * Radio is audio-only and never becomes a tile (spec non-goal). A series
 * becomes a tile only through one of its episodes.
 */
export function tileKindOf(
    item: UnifiedCollectionItem
): MultiviewTileKind | null {
    if (item.radio === 'true') return null;
    if (item.contentType === 'live') return 'live';
    return item.contentType === 'movie' ? 'vod' : null;
}

export function isRadio(item: UnifiedCollectionItem): boolean {
    return item.radio === 'true';
}

/** The provider's own id of the item, as the source views key it. */
export function providerContentId(
    item: UnifiedCollectionItem
): string | number {
    switch (item.sourceType) {
        case 'xtream':
            return item.xtreamId ?? item.uid;
        case 'stalker':
            return item.stalkerId ?? item.uid;
        case 'm3u':
            return item.channelId ?? item.m3uChannel?.id ?? item.uid;
    }
}

/**
 * The same canonical identity the source views give their own playback, so
 * an item picked here and the same item playing in its view are one tile.
 */
export function pickerSessionKey(item: UnifiedCollectionItem): string {
    return createPlaybackSessionKey({
        kind: item.contentType === 'live' ? 'live' : 'vod',
        sourceId: item.playlistId,
        contentId: providerContentId(item),
    });
}

/**
 * The tile already showing this item. Views key their own playback
 * differently, so besides the session key a tile matches by playlist and
 * provider id of the same kind, or by stream URL.
 */
export function tileNumberFor(
    item: UnifiedCollectionItem,
    tiles: readonly MultiviewTileSource[]
): number | null {
    const key = pickerSessionKey(item);
    const live = item.contentType === 'live';
    const ids = new Set([item.uid, String(providerContentId(item))]);
    const index = tiles.findIndex(
        (tile) =>
            tile.playbackSessionKey === key ||
            (tile.playlistId === item.playlistId &&
                (tile.kind === 'live') === live &&
                tile.contentId !== undefined &&
                ids.has(tile.contentId)) ||
            (!!item.streamUrl && tile.playback.streamUrl === item.streamUrl)
    );
    return index === -1 ? null : index + 1;
}

export function toPickerRow(
    item: UnifiedCollectionItem,
    tiles: readonly MultiviewTileSource[],
    extras: {
        readonly program?: EpgProgram | null;
        readonly position?: PlaybackPositionData | null;
    } = {}
): MultiviewPickerRow {
    return {
        item,
        kind: tileKindOf(item),
        sessionKey: pickerSessionKey(item),
        inTile: tileNumberFor(item, tiles),
        program: extras.program ?? null,
        position: extras.position ?? null,
    };
}
