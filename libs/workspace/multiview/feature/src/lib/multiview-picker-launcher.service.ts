import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import {
    MultiviewAnchorRegistry,
    type MultiviewPickRequest,
    MultiviewSessionStore,
    type MultiviewSourcePicker,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { UnifiedRecentDataService } from '@iptvnator/portal/shared/data-access';
import { firstValueFrom } from 'rxjs';
import type {
    MultiviewPickerDialogData,
    MultiviewPickerResult,
} from './multiview-picker-context';
import { MultiviewPickerDialogComponent } from './multiview-picker-dialog.component';

/** Spec 9.5: one 820 px dialog; its list area has a fixed height. */
const PICKER_DIALOG_CONFIG = {
    width: '820px',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    autoFocus: 'input[type="search"]',
    panelClass: 'multiview-picker-dialog',
} as const;

/**
 * The workspace's multiview source picker: opens the dialog with what it
 * needs to know about the session and records the picked item in recently
 * viewed once the tile really plays (R10, Q3).
 */
@Injectable({ providedIn: 'root' })
export class MultiviewPickerLauncher implements MultiviewSourcePicker {
    private readonly dialog = inject(MatDialog);
    private readonly store = inject(MultiviewSessionStore);
    private readonly anchors = inject(MultiviewAnchorRegistry);
    private readonly history = inject(PlaybackHistoryGate);
    private readonly recent = inject(UnifiedRecentDataService);

    async pick(
        request: MultiviewPickRequest
    ): Promise<MultiviewTileSource | null> {
        const ref = this.dialog.open<
            MultiviewPickerDialogComponent,
            MultiviewPickerDialogData,
            MultiviewPickerResult
        >(MultiviewPickerDialogComponent, {
            ...PICKER_DIALOG_CONFIG,
            data: this.contextFor(request),
        });
        const result = await firstValueFrom(ref.afterClosed());
        if (!result) return null;
        this.recordWhenPlaying(result);
        return result.source;
    }

    contextFor(request: MultiviewPickRequest): MultiviewPickerDialogData {
        const main =
            this.store.tiles()[0] ??
            this.anchors.current()?.host.source() ??
            null;
        const replaced =
            request.context === 'replace'
                ? this.store.tile(request.tileId)
                : null;
        return {
            request,
            mainTitle: main?.title ?? null,
            mainKind: main?.kind ?? null,
            playlistId: main?.playlistId ?? null,
            replaceNumber: replaced ? this.store.tileNumber(replaced.id) : null,
            replaceTitle: replaced?.title ?? null,
        };
    }

    /**
     * Deferred under the tile's own session key: the tile's player confirms
     * it once the stream advances, so a tile that never plays is not
     * history (the gate's contract).
     */
    private recordWhenPlaying({ source, item }: MultiviewPickerResult): void {
        this.history.defer(
            {
                sourceId: item.playlistId,
                sessionKey: source.playbackSessionKey,
                streamUrls: [source.playback.streamUrl],
            },
            () => void this.recent.recordLivePlayback(item).catch(() => null)
        );
    }
}
