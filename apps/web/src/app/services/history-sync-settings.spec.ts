import {
    previewLocalHistory,
    importLocalHistory,
} from './history-sync-settings';
import { HistorySyncClient } from '@iptvnator/services/history-sync';
import {
    emptyHistoryRecord,
    emptyHistoryState,
    type HistoryRecord,
    type HistoryScope,
} from '@iptvnator/shared/interfaces/history-sync';

function fixture() {
    let generation = 'consent';
    let incarnation = 'first';
    const scope: HistoryScope = {
        instanceId: 'nas',
        sourceId: 'source',
        sourceIncarnation: 'first',
        provider: 'xtream',
    };
    let record: HistoryRecord = emptyHistoryRecord();
    const client = new HistorySyncClient(
        {
            read: async () => JSON.parse(JSON.stringify(record)),
            mutate: async (_scope, update) =>
                (record = update(JSON.parse(JSON.stringify(record)))),
        },
        {
            instanceId: 'nas',
            deviceId: 'device',
            active: () => true,
            consent: () => generation,
            contexts: [scope],
            remember: () => undefined,
            changed: () => undefined,
            request: async (request) => {
                if (request.operation !== 'history-read')
                    throw new Error('offline');
                return {
                    status: 200,
                    body: {
                        scope: { ...scope, sourceIncarnation: incarnation },
                        state: emptyHistoryState(),
                    },
                };
            },
        }
    );
    const source = { _id: 'source', serverUrl: 'https://synthetic.invalid' };
    const raw = {
        getRecentItems: async () => [
            {
                id: 2,
                xtream_id: 42,
                type: 'series',
                title: 'Synthetic newer',
                viewed_at: new Date(20).toISOString(),
            },
            {
                id: 1,
                xtream_id: 41,
                type: 'movie',
                title: 'Synthetic older',
                viewed_at: new Date(10).toISOString(),
            },
        ],
    };
    const preview = () =>
        previewLocalHistory(
            client,
            raw.getRecentItems as never,
            {} as never,
            [source] as never,
            async () => source as never
        );
    return {
        client,
        raw,
        preview,
        record: () => record,
        generation: (v: string) => (generation = v),
        incarnation: (v: string) => (incarnation = v),
    };
}

describe('explicit local history import', () => {
    it('previews mixed SQLite and ISO times in UTC order', async () => {
        const f = fixture();
        f.raw.getRecentItems = async () => [
            {
                id: 1,
                xtream_id: 41,
                type: 'movie',
                title: 'Synthetic UTC archive',
                viewed_at: '2026-11-05 12:00:00',
            },
            {
                id: 2,
                xtream_id: 42,
                type: 'series',
                title: 'Synthetic ISO archive',
                viewed_at: '2026-11-05T11:30:00Z',
            },
        ];
        const preview = await f.preview();
        expect(preview.sources[0].items.map((item) => item.viewedAt)).toEqual([
            Date.parse('2026-11-05T12:00:00Z'),
            Date.parse('2026-11-05T11:30:00Z'),
        ]);
    });
    it('does not enqueue during preview and imports parent-series identity in old-to-new order', async () => {
        const f = fixture();
        const preview = await f.preview();
        expect(f.record().pending).toEqual([]);
        expect(preview.sources[0].items.map((i) => i.reference)).toEqual([
            { provider: 'xtream', kind: 'series', id: '42' },
            { provider: 'xtream', kind: 'movie', id: '41' },
        ]);
        await expect(importLocalHistory(f.client, preview)).rejects.toThrow(
            'offline'
        );
        expect(
            f
                .record()
                .pending.map((p) =>
                    p.operation.reference?.provider === 'xtream'
                        ? p.operation.reference.id
                        : null
                )
        ).toEqual(['41', '42']);
    });
    it.each(['consent', 'source'] as const)(
        'rejects a preview after its %s changes',
        async (change) => {
            const f = fixture();
            const preview = await f.preview();
            if (change === 'consent') f.generation('replacement');
            else f.incarnation('replacement');
            await expect(importLocalHistory(f.client, preview)).rejects.toThrow(
                'expired'
            );
            expect(f.record().pending).toEqual([]);
        }
    );
    it('keeps a device clear in the local archive used by preview', async () => {
        const f = fixture();
        await f.client.command('source', { kind: 'clear' }, true);
        const preview = await f.preview();
        expect(preview.sources[0].items).toEqual([]);
        expect(f.record().pending).toEqual([]);
    });
    it('previews every archive row beyond the native browsing limit', async () => {
        const f = fixture();
        const read = jest.fn(async () =>
            Array.from({ length: 105 }, (_, index) => ({
                id: index + 1,
                xtream_id: index + 1,
                type: 'movie',
                title: 'Synthetic archived item',
                viewed_at: new Date(index + 1).toISOString(),
            }))
        );
        const preview = await previewLocalHistory(
            f.client,
            read as never,
            {} as never,
            [
                { _id: 'source', serverUrl: 'https://synthetic.invalid' },
            ] as never,
            async () => ({}) as never
        );
        expect(preview.sources[0].items).toHaveLength(105);
        expect(read).toHaveBeenCalledWith('source');
        expect(f.record().pending).toEqual([]);
    });
});
