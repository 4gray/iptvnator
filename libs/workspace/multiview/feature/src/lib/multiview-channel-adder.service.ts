import { Injectable, inject } from '@angular/core';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import type {
    MultiviewChannelResolver,
    MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { UnifiedRecentDataService } from '@iptvnator/portal/shared/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { recordWhenPlaying } from './multiview-history';
import { MultiviewRelockGuard } from './multiview-relock-guard.service';
import { toPickerRow } from './multiview-picker-row';
import {
    isPickableRow,
    MultiviewTileResolverService,
    MultiviewUnresolvableError,
} from './multiview-tile-resolver';

/**
 * Alt+click and drag from a channel list (R5): the row becomes a tile
 * source exactly as if it was picked — parental lock checked by the
 * catalog (R11), recently viewed once it plays (R10).
 */
@Injectable({ providedIn: 'root' })
export class MultiviewChannelAdder implements MultiviewChannelResolver {
    private readonly resolver = inject(MultiviewTileResolverService);
    private readonly history = inject(PlaybackHistoryGate);
    private readonly recent = inject(UnifiedRecentDataService);
    private readonly relock = inject(MultiviewRelockGuard);

    async resolve(item: UnifiedCollectionItem): Promise<MultiviewTileSource> {
        const row = toPickerRow(item, []);
        if (row.kind !== 'live' || !isPickableRow(row)) {
            throw new MultiviewUnresolvableError();
        }
        const source = await this.resolver.resolve(row);
        recordWhenPlaying(this.history, this.recent, { source, item });
        this.relock.track(source, item);
        return source;
    }
}
