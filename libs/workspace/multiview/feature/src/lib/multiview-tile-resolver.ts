import { Injectable, inject, signal } from '@angular/core';
import type { MultiviewTileSource } from '@iptvnator/playback/multiview/data-access';
import {
    MultiviewCatalogService,
    VodSourceResolverService,
} from '@iptvnator/portal/shared/data-access';
import { createInlinePlaybackPositionWriter } from '@iptvnator/portal/shared/util';
import { PlaybackPositionService } from '@iptvnator/services';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import {
    type MultiviewPickerRow,
    providerContentId,
} from './multiview-picker-row';

/** The picked row cannot become a tile (series, radio, other VOD). */
export class MultiviewUnresolvableError extends Error {
    constructor() {
        super('This item cannot be played in a tile');
    }
}

/**
 * Turns a picked row into a tile source (spec 9.5 "Resolve to playback").
 * Live channels resolve through the catalog, which checks the parental lock
 * again before and after; Xtream films through the multi-source VOD
 * resolver, starting at their saved position and saving progress the way
 * the film's own player does (R9).
 */
@Injectable({ providedIn: 'root' })
export class MultiviewTileResolverService {
    private readonly catalog = inject(MultiviewCatalogService);
    private readonly vod = inject(VodSourceResolverService);
    private readonly positions = inject(PlaybackPositionService);

    async resolve(row: MultiviewPickerRow): Promise<MultiviewTileSource> {
        const { item } = row;
        if (row.kind === 'live') {
            const playback = await this.catalog.resolve({ item, group: '' });
            return {
                playback,
                playbackSessionKey: row.sessionKey,
                kind: 'live',
                playlistId: item.playlistId,
                contentId: String(providerContentId(item)),
                title: item.name,
            };
        }
        if (
            row.kind === 'vod' &&
            item.sourceType === 'xtream' &&
            item.xtreamId != null
        ) {
            return this.resolveXtreamFilm(row, item.xtreamId);
        }
        throw new MultiviewUnresolvableError();
    }

    private async resolveXtreamFilm(
        row: MultiviewPickerRow,
        xtreamId: number
    ): Promise<MultiviewTileSource> {
        const { item } = row;
        const position = row.position?.positionSeconds;
        const resolved = await this.vod.resolve(
            {
                id: `${item.playlistId}:xtream:${xtreamId}`,
                playlistId: item.playlistId,
                playlistName: item.playlistName,
                portalType: 'xtream',
                contentId: xtreamId,
                rawTitle: item.name,
                matchConfidence: 'exact',
                posterUrl: item.posterUrl ?? null,
            },
            { startTime: position }
        );
        if (!resolved) throw new MultiviewUnresolvableError();
        const writer = createInlinePlaybackPositionWriter({
            playback: signal<ResolvedPortalPlayback | null>(resolved.playback),
            save: (playlistId, data) =>
                void this.positions.savePlaybackPosition(playlistId, data),
        });
        return {
            playback: resolved.playback,
            playbackSessionKey: row.sessionKey,
            kind: 'vod',
            playlistId: item.playlistId,
            contentId: String(xtreamId),
            title: item.name,
            position,
            persistPosition: (event) => void writer.handleTimeUpdate(event),
        };
    }
}
