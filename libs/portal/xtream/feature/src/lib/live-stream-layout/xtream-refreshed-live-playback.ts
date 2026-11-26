import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatabaseService, SourceActivityService } from '@iptvnator/services';
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import type { XtreamLiveSource } from './xtream-external-live-sessions.service';
import {
    replaceXtreamQueuedCopy,
    type XtreamLiveChannelItem,
} from './xtream-live-channel-navigation.service';

export async function readRefreshedLivePlayback(
    db: Pick<
        DatabaseService,
        'getContentByXtreamId' | 'getAllXtreamCategories'
    >,
    playlistId: string,
    item: XtreamLiveChannelItem
): Promise<{ item: XtreamLiveChannelItem; categoryId: number | 'unknown' }> {
    const preferred = Number(item.category_id);
    if (!Number.isSafeInteger(preferred) || preferred <= 0)
        return { item, categoryId: 'unknown' };
    const [row, categories] = await Promise.all([
        db.getContentByXtreamId(
            item.xtream_id,
            playlistId,
            'live',
            undefined,
            preferred,
            undefined,
            true
        ),
        db.getAllXtreamCategories(playlistId, 'live').catch(() => []),
    ]);
    const providerId = categories.find(
        (category) => category.id === row?.category_id
    )?.xtream_id;
    return {
        item: row ? { ...item, ...row } : item,
        categoryId: providerId ?? 'unknown',
    };
}

export function observeExternalLiveCatalog(
    sessions: ReadonlyMap<
        string,
        { session: ExternalPlayerSession; source: XtreamLiveSource }
    >,
    pending: ReadonlyMap<string, { source: XtreamLiveSource }>,
    update: (session: ExternalPlayerSession, source: XtreamLiveSource) => void
): void {
    const db = inject(DatabaseService);
    const destroyRef = inject(DestroyRef);
    inject(SourceActivityService)
        .liveCatalogReplacements$.pipe(takeUntilDestroyed(destroyRef))
        .subscribe((playlistId) => {
            const sources = new Set(
                [...sessions.values(), ...pending.values()].map(
                    ({ source }) => source
                )
            );
            for (const source of sources) {
                const channel = source.channel;
                if (source.playlistId !== playlistId || !channel) continue;
                void readRefreshedLivePlayback(db, playlistId, channel).then(
                    ({ item, categoryId }) => {
                        if (destroyRef.destroyed || source.channel !== channel)
                            return;
                        const active = [...sessions.values()].filter(
                            (entry) => entry.source === source
                        );
                        if (
                            !active.length &&
                            ![...pending.values()].some(
                                (entry) => entry.source === source
                            )
                        )
                            return;
                        // The launch keeps this object until the player confirms it.
                        Object.assign(source, {
                            channel: item,
                            categoryId,
                            queue: source.queue
                                ? replaceXtreamQueuedCopy(source.queue, item)
                                : undefined,
                        });
                        for (const entry of active)
                            update(entry.session, source);
                    }
                );
            }
        });
}
