import { Injectable } from '@angular/core';
import type {
    MultiviewPickRequest,
    MultiviewTileKind,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import type { MultiviewPickerSectionId } from './multiview-picker-sections';

/** What the picker dialog is opened with. */
export interface MultiviewPickerDialogData {
    readonly request: MultiviewPickRequest;
    /** Title of the main tile, or of the view's playback before a session. */
    readonly mainTitle: string | null;
    readonly mainKind: MultiviewTileKind | null;
    /** The current playlist (spec Q2); its budget is in the footer. */
    readonly playlistId: string | null;
    /** Number and title of the tile a "replace" picker replaces. */
    readonly replaceNumber: number | null;
    readonly replaceTitle: string | null;
}

/** What the dialog closes with when the viewer picked something. */
export interface MultiviewPickerResult {
    readonly source: MultiviewTileSource;
    /** The picked item, recorded in recently viewed (R10). */
    readonly item: UnifiedCollectionItem;
}

/** The section the viewer chose last, for the next open (spec 9.5). */
@Injectable({ providedIn: 'root' })
export class MultiviewPickerMemory {
    lastSection: MultiviewPickerSectionId | null = null;
}
