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

describe('ServerUserDataStorage', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function setup(useLocal = false) {
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
            sendKeepalive: jest.fn(),
        };
        const onWriteFailure = jest.fn();
        const storage = new ServerUserDataStorage(
            api as never,
            local,
            () => useLocal,
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

    it('passes other keys and the browser override to plain storage', () => {
        const { api, local, storage } = setup(true);

        storage.setItem('xtream-favorites', '{"legacy":[]}');
        storage.setItem('xtream-playlists', '[]');

        expect(local.values.get('xtream-favorites')).toBe('{"legacy":[]}');
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
});
