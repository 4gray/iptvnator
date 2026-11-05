import type { KeepaliveOutcome } from './server-api-client';
import { ServerUserDataStorage } from './server-user-data-storage';

const FAVORITES_CACHE = 'iptvnator-server:cache:default:xtream-favorites';

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        keys: () => [...values.keys()],
    };
}

/** Lets chained promises run without advancing the fake timers. */
/** The saved writes of the one page load that has any, for `instanceId`. */
function savedWrites(
    local: ReturnType<typeof memoryStorage>,
    instanceId = 'default'
): unknown[] {
    const prefix = `iptvnator-server:unsent-writes:${instanceId}:`;
    const key = [...local.values.keys()].find((name) =>
        name.startsWith(prefix)
    );
    return key ? JSON.parse(local.values.get(key) ?? '[]') : [];
}

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

describe('ServerUserDataStorage', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function setup() {
        const local = memoryStorage();
        const api = {
            getJson: jest.fn().mockResolvedValue({
                entries: {
                    'xtream-favorites': { p1: ['live:1'] },
                    'xtream-recent-items': {},
                    'xtream-collection-items': {},
                    'xtream-playback-positions': {},
                },
            }),
            sendJson: jest.fn().mockResolvedValue(undefined),
            request: jest.fn().mockResolvedValue(undefined),
            sendKeepalive: jest.fn().mockResolvedValue({ status: 'saved' }),
            readJson: jest.fn().mockResolvedValue({}),
        };
        const onWriteFailure = jest.fn();
        const storage = new ServerUserDataStorage(
            api as never,
            local,
            onWriteFailure
        );
        return { api, local, storage, onWriteFailure };
    }

    it('hydrates synced keys into a prefixed cache', async () => {
        const { local, storage } = setup();

        await storage.hydrate();

        expect(storage.getItem('xtream-favorites')).toBe('{"p1":["live:1"]}');
        expect(local.values.get(FAVORITES_CACHE)).toBe('{"p1":["live:1"]}');
        expect(local.values.has('xtream-favorites')).toBe(false);
    });

    it('sends only changed and removed playlist entries', async () => {
        const { api, storage } = setup();
        await storage.hydrate();

        storage.setItem('xtream-favorites', JSON.stringify({ p2: ['live:9'] }));
        await jest.runOnlyPendingTimersAsync();

        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p2',
            { value: ['live:9'] },
            {}
        );
        expect(api.request).toHaveBeenCalledWith(
            '/user-state/xtream-favorites/p1',
            { method: 'DELETE', headers: {} }
        );
        expect(api.sendJson).toHaveBeenCalledTimes(1);
    });

    it('passes other keys to plain storage', () => {
        const { api, local, storage } = setup();

        storage.setItem('xtream-playlists', '[]');

        expect(local.values.get('xtream-playlists')).toBe('[]');
        expect(api.sendJson).not.toHaveBeenCalled();
    });

    it('flushes pending entries with keepalive', async () => {
        const { api, storage } = setup();
        await storage.hydrate();

        storage.setItem('xtream-recent-items', JSON.stringify({ p1: [] }));
        storage.flushWithKeepalive();

        expect(api.sendKeepalive).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-recent-items/p1',
            { value: [] },
            {}
        );
        await jest.runOnlyPendingTimersAsync();
        expect(api.sendJson).not.toHaveBeenCalled();
    });

    it('reports failed sends', async () => {
        const { api, storage, onWriteFailure } = setup();
        await storage.hydrate();
        api.sendJson.mockRejectedValueOnce(new Error('offline'));

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['live:2'] }));
        await jest.runOnlyPendingTimersAsync();

        expect(onWriteFailure).toHaveBeenCalled();
    });

    it('keeps an edit made while a refresh is reading', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        let answer: (value: unknown) => void = () => undefined;
        api.getJson.mockReturnValueOnce(
            new Promise((resolve) => (answer = resolve))
        );

        const refresh = storage.hydrate();
        await settle();
        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1'], p2: ['live:2'] })
        );
        // The server's older snapshot arrives after the edit.
        answer({ entries: { 'xtream-favorites': { p1: ['live:1'] } } });
        await refresh;

        expect(JSON.parse(storage.getItem('xtream-favorites') ?? '')).toEqual({
            p1: ['live:1'],
            p2: ['live:2'],
        });
        await jest.runOnlyPendingTimersAsync();
        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p2',
            { value: ['live:2'] },
            {}
        );

        // The next edit does not send a delete for the kept entry.
        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1', 'live:3'], p2: ['live:2'] })
        );
        await jest.runOnlyPendingTimersAsync();
        expect(api.request).not.toHaveBeenCalledWith(
            '/user-state/xtream-favorites/p2',
            { method: 'DELETE', headers: {} }
        );
    });

    it('sends a newer batch only after the older one finished', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        const order: string[] = [];
        let finishFirst: () => void = () => undefined;
        api.sendJson
            .mockImplementationOnce(
                (_method: string, _path: string, body: { value: unknown }) => {
                    order.push(`start ${JSON.stringify(body.value)}`);
                    return new Promise<void>((resolve) => {
                        finishFirst = () => {
                            order.push('end first');
                            resolve();
                        };
                    });
                }
            )
            .mockImplementation(
                (_method: string, _path: string, body: { value: unknown }) => {
                    order.push(`start ${JSON.stringify(body.value)}`);
                    return Promise.resolve();
                }
            );

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['a'] }));
        const first = storage.flush();
        await settle();
        // A newer edit while the first batch is still travelling.
        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['b'] }));
        const second = storage.flush();
        await settle();
        expect(order).toEqual(['start ["a"]']);

        finishFirst();
        await first;
        await second;
        expect(order).toEqual(['start ["a"]', 'end first', 'start ["b"]']);
    });

    it('keeps a failed write for the next flush and through a re-read', async () => {
        const { api, storage, onWriteFailure } = setup();
        await storage.hydrate();
        api.sendJson.mockRejectedValueOnce(new Error('offline'));

        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1', 'live:2'] })
        );
        await storage.flush();
        expect(onWriteFailure).toHaveBeenCalled();

        // Back online: the re-read sends it first, so the server has it.
        api.getJson.mockResolvedValueOnce({
            entries: { 'xtream-favorites': { p1: ['live:1', 'live:2'] } },
        });
        await storage.hydrate();
        expect(api.sendJson).toHaveBeenLastCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['live:1', 'live:2'] },
            {}
        );
        expect(JSON.parse(storage.getItem('xtream-favorites') ?? '')).toEqual({
            p1: ['live:1', 'live:2'],
        });
    });

    it('keeps an unsent edit when a re-read succeeds while writes fail', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        api.sendJson.mockRejectedValue(new Error('500'));

        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1', 'live:2'] })
        );
        await storage.hydrate();

        expect(JSON.parse(storage.getItem('xtream-favorites') ?? '')).toEqual({
            p1: ['live:1', 'live:2'],
        });
    });

    it('holds keepalive writes until a travelling batch finished', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        let finish: () => void = () => undefined;
        api.sendJson.mockReturnValueOnce(
            new Promise<void>((resolve) => (finish = resolve))
        );

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['a'] }));
        const travelling = storage.flush();
        await settle();
        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['b'] }));
        storage.flushWithKeepalive();
        expect(api.sendKeepalive).not.toHaveBeenCalled();

        finish();
        await travelling;
        await settle();
        expect(api.sendKeepalive).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['b'] },
            {}
        );
    });

    it('queues a page-hide write again when the server did not take it', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        api.sendKeepalive.mockResolvedValueOnce({ status: 'failed' });

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['big'] }));
        storage.flushWithKeepalive();
        await settle();

        // Back on the page: the re-read sends it normally and keeps it.
        api.getJson.mockResolvedValueOnce({
            entries: { 'xtream-favorites': { p1: ['big'] } },
        });
        await storage.hydrate();
        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['big'] },
            {}
        );
    });

    it('runs re-reads one after another', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        let answerFirst: (value: unknown) => void = () => undefined;
        api.getJson.mockReturnValueOnce(
            new Promise((resolve) => (answerFirst = resolve))
        );

        const first = storage.hydrate();
        const second = storage.hydrate();
        await settle();
        expect(api.getJson).toHaveBeenCalledTimes(2);

        answerFirst({ entries: {} });
        await first;
        await second;
        expect(api.getJson).toHaveBeenCalledTimes(3);
    });

    it('lets a newer write wait for a page-hide write still travelling', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        let acknowledge: (outcome: KeepaliveOutcome) => void = () => undefined;
        api.sendKeepalive.mockReturnValueOnce(
            new Promise<KeepaliveOutcome>((resolve) => (acknowledge = resolve))
        );

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['old'] }));
        storage.flushWithKeepalive();
        // Back on the page, a newer edit.
        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['new'] }));
        const newer = storage.flush();
        await settle();
        expect(api.sendJson).not.toHaveBeenCalled();

        acknowledge({ status: 'saved' });
        await newer;
        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['new'] },
            {}
        );
    });

    it('applies an edit made before the first read to the server value', async () => {
        const { api, local, storage } = setup();
        // The cache from the last visit; no read from the server yet.
        local.setItem(
            FAVORITES_CACHE,
            JSON.stringify({ p1: ['a'], p2: ['b'] })
        );

        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['a', 'c'], p2: ['b'] })
        );
        await storage.flush();
        expect(api.sendJson).not.toHaveBeenCalled();

        // Meanwhile another device added 'live:1' and 'z'.
        api.getJson.mockResolvedValueOnce({
            entries: {
                'xtream-favorites': { p1: ['live:1', 'a'], p2: ['b', 'z'] },
            },
        });
        await storage.hydrate();
        await storage.flush();

        expect(api.sendJson.mock.calls).toEqual([
            [
                'PUT',
                '/user-state/xtream-favorites/p1',
                { value: ['live:1', 'a', 'c'] },
                {},
            ],
        ]);
        expect(JSON.parse(storage.getItem('xtream-favorites') ?? '')).toEqual({
            p1: ['live:1', 'a', 'c'],
            p2: ['b', 'z'],
        });
    });

    it('keeps the server favorites when a new device adds one early', async () => {
        const { api, storage } = setup();
        let answer: (value: unknown) => void = () => undefined;
        api.getJson.mockReturnValueOnce(
            new Promise((resolve) => (answer = resolve))
        );

        const firstRead = storage.hydrate();
        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['live:9'] }));
        answer({
            entries: { 'xtream-favorites': { p1: ['live:1', 'live:2'] } },
        });
        await firstRead;
        await storage.flush();

        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['live:1', 'live:2', 'live:9'] },
            {}
        );
    });

    it('never retries an older page-hide write over a newer one', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        const acks: ((outcome: KeepaliveOutcome) => void)[] = [];
        api.sendKeepalive.mockImplementation(
            () => new Promise<KeepaliveOutcome>((resolve) => acks.push(resolve))
        );

        for (const value of ['A', 'B', 'C']) {
            storage.setItem(
                'xtream-favorites',
                JSON.stringify({ p1: [value] })
            );
            storage.flushWithKeepalive();
            await settle();
            // Each page-hide write waits for the previous one.
            acks[acks.length - 1]({
                status: value === 'B' ? 'failed' : 'saved',
            });
            await settle();
        }

        await storage.flush();
        expect(api.sendJson).not.toHaveBeenCalled();
    });

    it('keeps a value that does not fit the cache readable and consistent', async () => {
        const { api, local, storage } = setup();
        await storage.hydrate();
        // The server now has a second playlist the cache cannot take.
        api.getJson.mockResolvedValueOnce({
            entries: {
                'xtream-favorites': { p1: ['live:1'], p2: ['live:2'] },
            },
        });
        const setItem = local.setItem;
        local.setItem = (key: string, value: string) => {
            if (key === FAVORITES_CACHE) {
                throw new DOMException('full', 'QuotaExceededError');
            }
            setItem(key, value);
        };
        await storage.hydrate();

        // The app reads, edits and writes back, as PwaCollectionStorage does.
        const current = JSON.parse(storage.getItem('xtream-favorites') ?? '');
        expect(current).toEqual({ p1: ['live:1'], p2: ['live:2'] });
        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ ...current, p1: ['live:1', 'live:3'] })
        );
        await storage.flush();
        local.setItem = setItem;

        expect(api.request).not.toHaveBeenCalled();
        expect(api.sendJson.mock.calls).toEqual([
            [
                'PUT',
                '/user-state/xtream-favorites/p1',
                { value: ['live:1', 'live:3'] },
                {},
            ],
        ]);
    });

    it('keeps unconfirmed writes across a reload and sends them first', async () => {
        const first = setup();
        await first.storage.hydrate();
        first.api.sendJson.mockRejectedValue(new Error('offline'));
        first.storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1', 'live:9'] })
        );
        await first.storage.flush();
        expect(first.storage.hasUnsentWrites()).toBe(true);
        expect(savedWrites(first.local)).toMatchObject([
            {
                namespace: 'xtream-favorites',
                playlistId: 'p1',
                value: ['live:1', 'live:9'],
            },
        ]);

        // Reload: the page unloads, a new instance over the same storage.
        first.storage.close();
        const api = {
            ...first.api,
            sendJson: jest.fn().mockResolvedValue(undefined),
            getJson: jest.fn().mockResolvedValue({
                entries: { 'xtream-favorites': { p1: ['live:1', 'live:9'] } },
            }),
        };
        const reloaded = new ServerUserDataStorage(
            api as never,
            first.local,
            jest.fn()
        );
        await reloaded.hydrate();

        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['live:1', 'live:9'] },
            {}
        );
        expect(reloaded.hasUnsentWrites()).toBe(false);
        expect(savedWrites(first.local)).toEqual([]);
    });

    it('saves a write still travelling when the page hides', async () => {
        const { api, local, storage } = setup();
        await storage.hydrate();
        api.sendJson.mockReturnValueOnce(new Promise(() => undefined));

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['x'] }));
        void storage.flush();
        await settle();
        storage.flushWithKeepalive();

        expect(savedWrites(local)).toMatchObject([
            { namespace: 'xtream-favorites', playlistId: 'p1', value: ['x'] },
        ]);
    });

    it('drops cache and saved writes of another server database', () => {
        const local = memoryStorage();
        local.setItem('iptvnator-server:cache-owner', 'old-db');
        local.setItem(
            'iptvnator-server:cache:old-db:xtream-favorites',
            '{"p1":["a"]}'
        );
        // An earlier build's unscoped key.
        local.setItem('iptvnator-server:xtream-favorites', '{"p1":["a"]}');
        local.setItem(
            'iptvnator-server:unconfirmed:old-db:tab',
            JSON.stringify({ at: 0, keys: ['xtream-favorites|p1'] })
        );
        local.setItem(
            'iptvnator-server:unsent-writes:old-db:tab',
            JSON.stringify([
                {
                    namespace: 'xtream-favorites',
                    playlistId: 'p1',
                    value: ['a'],
                },
            ])
        );

        const storage = new ServerUserDataStorage(
            {} as never,
            local,
            jest.fn(),
            'new-db'
        );

        expect(storage.hasUnsentWrites()).toBe(false);
        expect(local.values.has('iptvnator-server:xtream-favorites')).toBe(
            false
        );
        expect(
            local.values.has('iptvnator-server:cache:old-db:xtream-favorites')
        ).toBe(false);
        expect(savedWrites(local, 'old-db')).toEqual([]);
        expect(
            local.values.has('iptvnator-server:unconfirmed:old-db:tab')
        ).toBe(false);
        expect(local.values.get('iptvnator-server:cache-owner')).toBe('new-db');
    });

    it('tells, once a first read in flight settled, whether it read the server', async () => {
        const { api, storage } = setup();
        api.getJson.mockRejectedValueOnce(new Error('offline'));

        const failed = storage.hydrate().catch(() => undefined);
        await expect(storage.ready()).resolves.toBe(false);
        await failed;
        // It starts no read of its own: an offline page is not held up.
        expect(api.getJson).toHaveBeenCalledTimes(1);

        const read = storage.hydrate();
        await expect(storage.ready()).resolves.toBe(true);
        await read;
        await expect(storage.ready()).resolves.toBe(true);
        expect(api.getJson).toHaveBeenCalledTimes(2);
    });

    it('reads the server again when a backup asks for fresh data', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        api.getJson.mockClear();

        // Another device may have changed it since: read again.
        await expect(storage.ready(true)).resolves.toBe(true);
        expect(api.getJson).toHaveBeenCalledTimes(1);

        api.getJson.mockRejectedValueOnce(new Error('offline'));
        await expect(storage.ready(true)).resolves.toBe(false);
        // Without `fresh` an earlier read is enough.
        await expect(storage.ready()).resolves.toBe(true);
        expect(api.getJson).toHaveBeenCalledTimes(2);
    });

    it("never writes over another server instance's cache", async () => {
        const local = memoryStorage();
        const tab = (instanceId: string, favorites: unknown) =>
            new ServerUserDataStorage(
                {
                    getJson: jest.fn().mockResolvedValue({
                        entries: { 'xtream-favorites': favorites },
                    }),
                } as never,
                local,
                jest.fn(),
                instanceId
            );
        // The tab of the old backend stays open after a new one started.
        const old = tab('old-db', { p1: ['old'] });
        const current = tab('new-db', { p1: ['new'] });
        await current.hydrate();

        await old.hydrate();

        expect(current.getItem('xtream-favorites')).toBe('{"p1":["new"]}');
    });

    it('keeps a newer travelling write when an older one is answered', async () => {
        const { api, local, storage } = setup();
        await storage.hydrate();
        let answerOlder: () => void = () => undefined;
        api.sendJson.mockReturnValueOnce(
            new Promise<void>((resolve) => (answerOlder = resolve))
        );
        api.sendKeepalive.mockReturnValueOnce(new Promise(() => undefined));

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['old'] }));
        const older = storage.flush();
        await settle();
        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['new'] }));
        storage.flushWithKeepalive();
        answerOlder();
        await older;
        await settle();

        expect(storage.hasUnsentWrites()).toBe(true);
        expect(savedWrites(local)).toMatchObject([
            { namespace: 'xtream-favorites', playlistId: 'p1', value: ['new'] },
        ]);
    });

    it('keeps two early additions to an empty entry', async () => {
        const { api, storage } = setup();
        let answer: (value: unknown) => void = () => undefined;
        api.getJson.mockReturnValueOnce(
            new Promise((resolve) => (answer = resolve))
        );

        const firstRead = storage.hydrate();
        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['A'] }));
        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['A', 'B'] }));
        answer({ entries: { 'xtream-favorites': { p1: ['S'] } } });
        await firstRead;
        await storage.flush();

        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['S', 'A', 'B'] },
            {}
        );
    });

    it('keeps early edits across a reload before the first read', async () => {
        const first = setup();
        first.api.getJson.mockReturnValueOnce(new Promise(() => undefined));
        void first.storage.hydrate();
        first.storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['mine'] })
        );
        first.storage.close();

        const api = {
            ...first.api,
            sendJson: jest.fn().mockResolvedValue(undefined),
            getJson: jest.fn().mockResolvedValue({
                entries: { 'xtream-favorites': { p1: ['theirs'] } },
            }),
        };
        const reloaded = new ServerUserDataStorage(
            api as never,
            first.local,
            jest.fn()
        );
        await reloaded.hydrate();
        await reloaded.flush();

        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['theirs', 'mine'] },
            {}
        );
    });

    it("does not replace another tab's unconfirmed edit on a re-read", async () => {
        const shared = memoryStorage();
        const api = {
            getJson: jest.fn().mockResolvedValue({
                entries: { 'xtream-favorites': { p1: ['live:1'] } },
            }),
            sendJson: jest.fn().mockResolvedValue(undefined),
            request: jest.fn().mockResolvedValue(undefined),
            sendKeepalive: jest.fn().mockResolvedValue({ status: 'saved' }),
            readJson: jest.fn().mockResolvedValue({}),
        };
        const tab = () =>
            new ServerUserDataStorage(
                api as never,
                shared,
                jest.fn(),
                'default',
                memoryStorage()
            );
        const tabA = tab();
        const tabB = tab();
        await tabA.hydrate();
        await tabB.hydrate();

        // Tab A's edit is queued, not confirmed; tab B re-reads.
        tabA.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1', 'live:7'] })
        );
        await tabB.hydrate();

        expect(JSON.parse(tabB.getItem('xtream-favorites') ?? '')).toEqual({
            p1: ['live:1', 'live:7'],
        });
        // Tab B never takes over tab A's saved writes.
        expect(api.sendJson).not.toHaveBeenCalled();
    });

    it('keeps server favorites through a cache-full first read and a later edit', async () => {
        const { api, local, storage } = setup();
        local.setItem(FAVORITES_CACHE, '{"p1":["A"]}');
        storage.setItem('xtream-favorites', '{"p1":["A","B"]}');
        api.getJson.mockResolvedValueOnce({
            entries: { 'xtream-favorites': { p1: ['S'] } },
        });
        const setItem = local.setItem;
        local.setItem = (key: string, value: string) => {
            if (key === FAVORITES_CACHE) {
                throw new DOMException('full', 'QuotaExceededError');
            }
            setItem(key, value);
        };
        await storage.hydrate();

        const current = JSON.parse(storage.getItem('xtream-favorites') ?? '');
        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: [...current.p1, 'C'] })
        );
        await storage.flush();
        local.setItem = setItem;

        expect(api.sendJson).toHaveBeenLastCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['S', 'B', 'C'] },
            {}
        );
    });
});
