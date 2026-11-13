import {
    type MultiviewTileKind,
    type MultiviewTileSource,
    pickerSessionKey,
    tileNumberFor,
} from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type {
    EpgProgram,
    PlaybackPositionData,
} from '@iptvnator/shared/interfaces';

export {
    pickerSessionKey,
    providerContentId,
    tileNumberFor,
} from '@iptvnator/playback/multiview/data-access';

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
