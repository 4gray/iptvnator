import {
    createHistoryBackupRestorer,
    projectHistoryBackup,
} from './history-backup';
import { HistorySyncClient } from '@iptvnator/services/history-sync';
import {
    emptyHistoryRecord,
    applyHistoryOperation,
    visibleHistory,
    projectHistory,
    type HistoryScope,
    type HistoryOperation,
} from '@iptvnator/shared/interfaces/history-sync';
import type {
    Playlist,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';

const scope: HistoryScope = {
    instanceId: 'nas',
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream',
};
const source = { _id: 'source' } as Playlist;
const op = (
    id: number,
    kind: 'touch' | 'remove' = 'touch'
): HistoryOperation => ({
    kind,
    reference: { provider: 'xtream', kind: 'movie', id: String(id) },
    snapshot: { title: `Synthetic item ${id}` },
    operationId: `${kind}-${id}`,
    deviceId: 'device',
    viewedAt: id,
    baseRevision: 0,
});
function fixture() {
    let record = emptyHistoryRecord();
    const copy = () => JSON.parse(JSON.stringify(record));
    const request = jest.fn(async () => {
        throw new Error('Unexpected network request');
    });
    const client = new HistorySyncClient(
        {
            read: async () => copy(),
            mutate: async (_scope, update) => (record = update(copy())),
        },
        {
            instanceId: 'nas',
            deviceId: 'device',
            active: () => true,
            consent: () => 'consent',
            contexts: [scope],
            remember: () => undefined,
            changed: () => undefined,
            request,
        }
    );
    const entry = {
        portalType: 'xtream',
        exportedId: 'source',
        title: 'Synthetic source',
        autoRefresh: false,
        connection: {
            serverUrl: 'https://synthetic.invalid',
            username: 'synthetic',
        },
        userState: {
            hiddenCategories: [],
            favorites: [],
            recentlyViewed: [],
            playbackPositions: [],
        },
    } as XtreamPlaylistBackupEntry;
    return { client, record: () => record, entry, request };
}
describe('durable history backup', () => {
    it('keeps UTC ordering when exporting and restoring legacy timestamp strings', async () => {
        const f = fixture();
        f.entry.userState.recentlyViewed = [
            {
                contentType: 'movie',
                xtreamId: 41,
                viewedAt: '2026-11-05 12:00:00',
            },
            {
                contentType: 'series',
                xtreamId: 42,
                viewedAt: '2026-11-05T11:30:00Z',
            },
        ];
        const exported = (await projectHistoryBackup(
            f.client,
            {} as never,
            source,
            f.entry
        )) as XtreamPlaylistBackupEntry;
        expect(
            exported.userState.recentlyViewed.map((item) => item.xtreamId)
        ).toEqual([41, 42]);
        await createHistoryBackupRestorer(
            f.client,
            {} as never,
            async () => source
        )('source', f.entry);
        expect(
            f
                .record()
                .archive?.filter((op) => op.kind === 'touch')
                .map((op) => op.viewedAt)
        ).toEqual([
            Date.parse('2026-11-05T11:30:00Z'),
            Date.parse('2026-11-05T12:00:00Z'),
        ]);
    });
    it('exports all shared entries and removals without a catalog or network, retaining unrelated local history', async () => {
        const f = fixture();
        for (let id = 1; id <= 105; id++)
            f.record().base = applyHistoryOperation(
                f.record().base,
                op(id),
                true
            ).state;
        f.record().base = applyHistoryOperation(
            f.record().base,
            op(1, 'remove'),
            true
        ).state;
        f.entry.userState.recentlyViewed = [
            {
                contentType: 'movie',
                xtreamId: 1,
                viewedAt: new Date(1).toISOString(),
            },
            {
                contentType: 'series',
                xtreamId: 200,
                viewedAt: new Date(200).toISOString(),
            },
        ];
        const exported = (await projectHistoryBackup(
            f.client,
            {} as never,
            source,
            f.entry
        )) as XtreamPlaylistBackupEntry;
        expect(exported.userState.recentlyViewed).toHaveLength(105);
        expect(
            exported.userState.recentlyViewed.some(
                (item) => item.xtreamId === 1
            )
        ).toBe(false);
        expect(
            exported.userState.recentlyViewed.find(
                (item) => item.xtreamId === 105
            )?.collectionItem
        ).toMatchObject({
            title: 'Synthetic item 105',
            xtream_id: 105,
            type: 'movie',
        });
        expect(f.request).not.toHaveBeenCalled();
    });
    it('restores a local copy without changing shared state or the existing delivery queue', async () => {
        const f = fixture();
        f.record().base = applyHistoryOperation(f.record().base, op(1)).state;
        f.record().pending = [{ consent: 'consent', operation: op(2) }];
        f.entry.userState.recentlyViewed = [
            {
                contentType: 'series',
                xtreamId: 42,
                viewedAt: new Date(100).toISOString(),
                collectionItem: {
                    type: 'series',
                    xtream_id: 42,
                    title: 'Synthetic restored',
                },
            },
        ];
        const restore = createHistoryBackupRestorer(
            f.client,
            {} as never,
            async () => source
        );
        await restore('source', f.entry);
        expect(f.record().pending).toHaveLength(1);
        expect(f.record().base.items[0].reference).toEqual(op(1).reference);
        expect(
            visibleHistory(projectHistory(f.record())).map(
                (item) => item.reference
            )
        ).toEqual([{ provider: 'xtream', kind: 'series', id: '42' }]);
        expect(f.record().archive?.[1].viewedAt).toBe(100);
        expect(f.request).not.toHaveBeenCalled();
        f.entry.userState.recentlyViewed = [];
        await restore('source', f.entry);
        expect(visibleHistory(projectHistory(f.record()))).toEqual([]);
    });
    it('rejects a restorer captured before a source replacement', async () => {
        const f = fixture();
        const restore = createHistoryBackupRestorer(
            f.client,
            {} as never,
            async () => source
        );
        f.client.contexts.set('source', {
            ...scope,
            sourceIncarnation: 'replacement',
        });
        await expect(restore('source', f.entry)).rejects.toThrow('superseded');
        expect(f.record()).toEqual(emptyHistoryRecord());
    });
});
