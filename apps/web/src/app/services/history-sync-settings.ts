import type { HistorySyncClient } from '@iptvnator/services/history-sync';
import {
    projectHistory,
    visibleHistory,
    type HistoryScope,
    type HistoryReference,
    type HistorySnapshot,
} from '@iptvnator/shared/interfaces/history-sync';
import {
    normalizeStalkerDate,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import type { XtreamRecentItem } from '@iptvnator/portal/xtream/data-access';
import type { HistoryPlaylistAdapter } from './history-playlist-adapter';
import {
    xtreamFavoriteReference,
    xtreamFavoriteSnapshot,
} from './favorites-reference-adapters';
export interface HistoryPreview {
    instanceId: string;
    generation: string;
    sources: {
        scope: HistoryScope;
        items: {
            reference: HistoryReference;
            snapshot?: HistorySnapshot;
            viewedAt: number;
        }[];
    }[];
    unresolved: number;
}
export async function previewLocalHistory(
    client: HistorySyncClient,
    readRecent: (id: string) => Promise<XtreamRecentItem[]>,
    adapter: HistoryPlaylistAdapter,
    sources: Playlist[],
    read: (id: string) => Promise<Playlist>
): Promise<HistoryPreview> {
    const generation = client.options.consent();
    if (!generation) throw new Error('History consent disabled');
    const preview: HistoryPreview = {
        instanceId: client.options.instanceId,
        generation,
        sources: [],
        unresolved: 0,
    };
    for (const source of sources) {
        const scope = await client.refresh(source._id);
        const archive = source.serverUrl
            ? {
                  items: (await readRecent(source._id)).map((item) => ({
                      reference: xtreamFavoriteReference(item),
                      snapshot: xtreamFavoriteSnapshot(item),
                      viewedAt:
                          Date.parse(normalizeStalkerDate(item.viewed_at)) || 0,
                  })),
                  unresolved: 0,
              }
            : await adapter.local(await read(source._id));
        const local = await client.store.read(scope);
        const original = archive.items.map((item) => ({
            reference: item.reference,
            snapshot: item.snapshot,
            viewedAt: item.viewedAt,
        }));
        const merged = projectHistory({
            base: {
                revision: original.length,
                cleared: 0,
                items: original.map((item, index) => ({
                    ...item,
                    revision: index + 1,
                    removedAt: 0,
                    removed: false,
                })),
            },
            pending: [],
            local: local?.archive ?? [],
        });
        merged.revision = Math.max(merged.revision, original.length);
        preview.sources.push({ scope, items: visibleHistory(merged) });
        preview.unresolved += archive.unresolved;
    }
    if (generation !== client.options.consent())
        throw new Error('History preview expired');
    return preview;
}
export async function importLocalHistory(
    client: HistorySyncClient,
    preview: HistoryPreview
): Promise<void> {
    for (const source of preview.sources) {
        const scope = await client.refresh(source.scope.sourceId);
        const record = await client.store.read(scope);
        client.current(scope);
        if (
            preview.instanceId !== client.options.instanceId ||
            preview.generation !== client.options.consent() ||
            scope.sourceIncarnation !== source.scope.sourceIncarnation
        )
            throw new Error('History preview expired');
        if (record?.pending.some((item) => item.consent !== preview.generation))
            throw new Error('Resolve parked history before import');
    }
    const ordered = preview.sources
        .map(({ scope, items }) => items.map((item) => ({ scope, item })))
        .reduce((all, items) => all.concat(items), [])
        .sort((a, b) => a.item.viewedAt - b.item.viewedAt);
    for (const { scope, item } of ordered) {
        client.current(scope);
        if (preview.generation !== client.options.consent())
            throw new Error('History preview expired');
        await client.command(scope.sourceId, {
            kind: 'touch',
            reference: item.reference,
            snapshot: item.snapshot,
        });
        // Server timestamps follow acceptance order across all sources.
        await client.flush(scope.sourceId);
    }
}
