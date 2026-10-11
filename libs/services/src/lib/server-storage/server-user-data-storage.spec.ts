import { ServerUserDataStorage } from './server-user-data-storage';

function memoryStorage() {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
    };
}

/** Lets chained promises run without advancing the fake timers. */
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
            sendKeepalive: jest.fn().mockResolvedValue(true),
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
        expect(local.values.get('iptvnator-server:xtream-favorites')).toBe(
            '{"p1":["live:1"]}'
        );
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
            { value: ['live:9'] }
        );
        expect(api.request).toHaveBeenCalledWith(
            '/user-state/xtream-favorites/p1',
            { method: 'DELETE' }
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
            { value: [] }
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
            { value: ['live:2'] }
        );

        // The next edit does not send a delete for the kept entry.
        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1', 'live:3'], p2: ['live:2'] })
        );
        await jest.runOnlyPendingTimersAsync();
        expect(api.request).not.toHaveBeenCalledWith(
            '/user-state/xtream-favorites/p2',
            { method: 'DELETE' }
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
            { value: ['live:1', 'live:2'] }
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
            { value: ['b'] }
        );
    });

    it('queues a page-hide write again when the server did not take it', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        api.sendKeepalive.mockResolvedValueOnce(false);

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
            { value: ['big'] }
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
        let acknowledge: (ok: boolean) => void = () => undefined;
        api.sendKeepalive.mockReturnValueOnce(
            new Promise<boolean>((resolve) => (acknowledge = resolve))
        );

        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['old'] }));
        storage.flushWithKeepalive();
        // Back on the page, a newer edit.
        storage.setItem('xtream-favorites', JSON.stringify({ p1: ['new'] }));
        const newer = storage.flush();
        await settle();
        expect(api.sendJson).not.toHaveBeenCalled();

        acknowledge(true);
        await newer;
        expect(api.sendJson).toHaveBeenCalledWith(
            'PUT',
            '/user-state/xtream-favorites/p1',
            { value: ['new'] }
        );
    });

    it('sends only the edited entry before the first read finished', () => {
        const { api, local, storage } = setup();
        // The cache from the last visit; no read from the server yet.
        local.setItem(
            'iptvnator-server:xtream-favorites',
            JSON.stringify({ p1: ['a'], p2: ['b'] })
        );

        storage.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['a', 'c'], p2: ['b'] })
        );
        void storage.flush();

        return settle().then(() => {
            expect(api.sendJson.mock.calls).toEqual([
                [
                    'PUT',
                    '/user-state/xtream-favorites/p1',
                    { value: ['a', 'c'] },
                ],
            ]);
        });
    });

    it('never retries an older page-hide write over a newer one', async () => {
        const { api, storage } = setup();
        await storage.hydrate();
        const acks: ((ok: boolean) => void)[] = [];
        api.sendKeepalive.mockImplementation(
            () => new Promise<boolean>((resolve) => acks.push(resolve))
        );

        for (const value of ['A', 'B', 'C']) {
            storage.setItem(
                'xtream-favorites',
                JSON.stringify({ p1: [value] })
            );
            storage.flushWithKeepalive();
            await settle();
            // Each page-hide write waits for the previous one.
            acks[acks.length - 1](value !== 'B');
            await settle();
        }

        await storage.flush();
        expect(api.sendJson).not.toHaveBeenCalled();
    });
});
