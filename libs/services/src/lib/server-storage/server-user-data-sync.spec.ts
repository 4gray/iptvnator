import { ServerApiError } from './server-api-client';
import { UNCONFIRMED_TTL_MS } from './server-page-registry';
import { ServerUserDataStorage } from './server-user-data-storage';
import { fakeServer, memoryStorage } from './server-user-data.test-helpers';

const favorites = (storage: ServerUserDataStorage) =>
    JSON.parse(storage.getItem('xtream-favorites') ?? '{}');

describe('ServerUserDataStorage with other devices', () => {
    it('replays an edit on what another device saved meanwhile', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['live:1'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();

        // The TV adds live:2 after the phone read the entry.
        server.state['xtream-favorites']['p1'] = ['live:1', 'live:2'];
        phone.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1', 'live:9'] })
        );
        await phone.flush();
        await phone.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual([
            'live:1',
            'live:2',
            'live:9',
        ]);
        expect(favorites(phone)).toEqual({
            p1: ['live:1', 'live:2', 'live:9'],
        });
    });

    it('replays a newer queued edit together with the refused one', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();
        server.state['xtream-favorites']['p1'] = ['S', 'Z'];

        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        const first = phone.flush();
        phone.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['S', 'X', 'Y'] })
        );
        await first;
        await phone.flush();
        await phone.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual([
            'S',
            'Z',
            'X',
            'Y',
        ]);
    });

    it('builds a queued edit on the version its predecessor created', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();

        let answer: () => void = () => undefined;
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        server.api.sendJson.mockImplementationOnce(
            (...args: Parameters<typeof send>) =>
                new Promise(
                    (resolve) => (answer = () => resolve(send(...args)))
                )
        );
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        const first = phone.flush();
        await new Promise((resolve) => setTimeout(resolve, 0));
        // The first write is travelling when the second edit comes in.
        phone.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['S', 'X', 'Y'] })
        );
        answer();
        await first;
        await phone.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X', 'Y']);
        // No conflict round trip: the second write carried the new tag.
        expect(server.api.sendJson).toHaveBeenCalledTimes(2);
    });

    it("never sends another tab's change to an entry it did not edit", async () => {
        const server = fakeServer({
            'xtream-favorites': { p1: ['a'], p2: ['b'] },
        });
        const shared = memoryStorage();
        const tab = () =>
            new ServerUserDataStorage(
                server.api as never,
                shared,
                jest.fn(),
                'default',
                memoryStorage()
            );
        const tabA = tab();
        const tabB = tab();
        await tabA.hydrate();
        await tabB.hydrate();

        tabB.setItem(
            'xtream-favorites',
            JSON.stringify({ ...favorites(tabB), p1: ['a', 'b1'] })
        );
        tabA.setItem(
            'xtream-favorites',
            JSON.stringify({ ...favorites(tabA), p2: ['b', 'a2'] })
        );
        await tabA.flush();

        expect(server.api.sendJson.mock.calls.map(([, path]) => path)).toEqual([
            '/user-state/xtream-favorites/p2',
        ]);
    });

    it('drops queued edits and cache once a playlist is deleted', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['a'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['a', 'b'] }));

        await phone.deleting('p1', async () => {
            await phone.flush();
            delete server.state['xtream-favorites']['p1'];
        });
        await phone.flush();

        expect(server.api.sendJson).not.toHaveBeenCalled();
        expect(favorites(phone)).toEqual({});
        expect(phone.hasUnsentWrites()).toBe(false);
    });

    it('keeps the edits of a playlist whose delete failed', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['a'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['a', 'b'] }));

        await expect(
            phone.deleting('p1', async () => {
                throw new Error('offline');
            })
        ).rejects.toThrow('offline');
        await phone.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['a', 'b']);
        expect(favorites(phone)).toEqual({ p1: ['a', 'b'] });
    });

    it("re-reads another tab's unsent value without the server's tag", async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const tab = () =>
            new ServerUserDataStorage(
                server.api as never,
                shared,
                jest.fn(),
                'default',
                memoryStorage()
            );
        const tabA = tab();
        const tabB = tab();
        await tabA.hydrate();
        await tabB.hydrate();
        // Tab A's favorite is not sent yet when another device saves one.
        tabA.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        server.state['xtream-favorites']['p1'] = ['S', 'Z'];

        await tabB.hydrate();
        expect(favorites(tabB)).toEqual({ p1: ['S', 'X'] });
        tabB.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['S', 'X', 'Y'] })
        );
        // Each conflict replays the edit on the newest value: the two tabs
        // settle after a few rounds.
        for (let round = 0; round < 4; round += 1) {
            await tabB.flush();
            await tabA.flush();
        }

        expect(tabA.hasUnsentWrites() || tabB.hasUnsentWrites()).toBe(false);
        expect(
            [...(server.state['xtream-favorites']['p1'] as string[])].sort()
        ).toEqual(['S', 'X', 'Y', 'Z']);
    });

    it('sends a page-hide edit on the version a travelling write created', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();

        let answer: () => void = () => undefined;
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        server.api.sendJson.mockImplementationOnce(
            (...args: Parameters<typeof send>) =>
                new Promise(
                    (resolve) => (answer = () => resolve(send(...args)))
                )
        );
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        const first = phone.flush();
        await new Promise((resolve) => setTimeout(resolve, 0));
        // X is removed again while its addition is travelling; the page hides.
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S'] }));
        phone.flushWithKeepalive();
        answer();
        await first;
        await phone.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S']);
        expect(phone.hasUnsentWrites()).toBe(false);
    });

    it('removes an item again after a page-hide write added it', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();

        let answer: () => void = () => undefined;
        const keepalive = server.api.sendKeepalive.getMockImplementation();
        if (!keepalive) {
            throw new Error('The fake server answers sendKeepalive');
        }
        server.api.sendKeepalive.mockImplementationOnce(
            (...args: Parameters<typeof keepalive>) =>
                new Promise(
                    (resolve) => (answer = () => resolve(keepalive(...args)))
                )
        );
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        phone.flushWithKeepalive();
        // Back on the page, X is removed while the page-hide write travels.
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S'] }));
        answer();
        await phone.flush();
        await phone.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S']);
        expect(phone.hasUnsentWrites()).toBe(false);
    });

    it('recovers a removal queued behind a write whose answer was lost', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        const open = () =>
            new ServerUserDataStorage(
                server.api as never,
                local,
                jest.fn(),
                'default',
                tabStore
            );
        const before = open();
        await before.hydrate();

        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        // The server saves X, but the page reloads before the answer.
        server.api.sendJson.mockImplementationOnce(
            (...args: Parameters<typeof send>) => {
                void send(...args);
                return new Promise(() => undefined);
            }
        );
        before.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        void before.flush();
        await new Promise((resolve) => setTimeout(resolve, 0));
        before.setItem('xtream-favorites', JSON.stringify({ p1: ['S'] }));
        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);

        before.close();
        const reloaded = open();
        await reloaded.hydrate();
        await reloaded.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S']);
        expect(reloaded.hasUnsentWrites()).toBe(false);
    });

    it('replays a failed write it was queued behind on a conflict', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();

        let fail: () => void = () => undefined;
        server.api.sendJson.mockImplementationOnce(
            () =>
                new Promise((_, reject) => {
                    fail = () =>
                        reject(new ServerApiError(0, 'network', 'offline'));
                })
        );
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        const first = phone.flush();
        await new Promise((resolve) => setTimeout(resolve, 0));
        phone.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['S', 'X', 'Y'] })
        );
        // X never reached the server; another device saves Z meanwhile.
        server.state['xtream-favorites']['p1'] = ['S', 'Z'];
        fail();
        await first;
        await phone.flush();
        await phone.flush();

        expect(
            [...(server.state['xtream-favorites']['p1'] as string[])].sort()
        ).toEqual(['S', 'X', 'Y', 'Z']);
    });

    it('keeps a removal made after another tab built on the unsent item', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const tab = () =>
            new ServerUserDataStorage(
                server.api as never,
                shared,
                jest.fn(),
                'default',
                memoryStorage()
            );
        const tabA = tab();
        const tabB = tab();
        await tabA.hydrate();
        await tabB.hydrate();

        tabA.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        // Tab B sees X in the shared cache and adds Y next to it.
        tabB.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: [...favorites(tabB).p1, 'Y'] })
        );
        // Tab A takes X back before anything was sent.
        tabA.setItem(
            'xtream-favorites',
            JSON.stringify({
                p1: favorites(tabA).p1.filter((id: string) => id !== 'X'),
            })
        );
        for (let round = 0; round < 4; round += 1) {
            await tabB.flush();
            await tabA.flush();
        }

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'Y']);
    });

    it('sends the saved writes of a tab that was closed offline', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const offline = {
            ...server.api,
            sendJson: jest
                .fn()
                .mockRejectedValue(new ServerApiError(0, 'network', 'offline')),
        };
        const closed = new ServerUserDataStorage(
            offline as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await closed.hydrate();
        closed.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await closed.flush();
        // The tab is gone: its record stops being renewed.
        for (const [key, value] of shared.values) {
            if (key.startsWith('iptvnator-server:unconfirmed:default:')) {
                shared.setItem(
                    key,
                    JSON.stringify({ ...JSON.parse(value), at: 0 })
                );
            }
        }

        const next = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await next.hydrate();
        await next.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
        expect(
            [...shared.values.keys()].filter((key) =>
                key.startsWith('iptvnator-server:unsent-writes:')
            )
        ).toEqual([]);
    });

    it("keeps a removal of another tab's unsent item", async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const tab = () =>
            new ServerUserDataStorage(
                server.api as never,
                shared,
                jest.fn(),
                'default',
                memoryStorage()
            );
        const tabA = tab();
        const tabB = tab();
        await tabA.hydrate();
        await tabB.hydrate();

        tabA.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        tabB.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: [...favorites(tabB).p1, 'Y'] })
        );
        // Tab A removes the Y it sees from tab B before sending anything;
        // tab B's write lands first (leaving a tab sends its writes).
        tabA.setItem(
            'xtream-favorites',
            JSON.stringify({
                p1: favorites(tabA).p1.filter((id: string) => id !== 'Y'),
            })
        );
        await tabB.flush();
        await tabB.flush();
        await tabA.flush();
        await tabA.flush();

        expect(tabA.hasUnsentWrites() || tabB.hasUnsentWrites()).toBe(false);
        expect(
            [...(server.state['xtream-favorites']['p1'] as string[])].sort()
        ).toEqual(['S', 'X']);
    });

    it('reads and writes through memory when browser storage refuses', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const denied = () => {
            throw new DOMException('denied', 'SecurityError');
        };
        const phone = new ServerUserDataStorage(
            server.api as never,
            { getItem: denied, setItem: denied, removeItem: denied },
            jest.fn()
        );

        await phone.hydrate();
        expect(favorites(phone)).toEqual({ p1: ['S'] });
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await phone.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
    });

    it('keeps a removal made after a write whose answer was lost', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        // The server saves X, but the answer never arrives.
        server.api.sendJson.mockImplementationOnce(
            async (...args: Parameters<typeof send>) => {
                await send(...args);
                throw new ServerApiError(0, 'network', 'offline');
            }
        );
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await phone.flush();
        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);

        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S'] }));
        await phone.flush();
        await phone.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S']);
    });

    it("sends a closed tab's favorite this tab's cache already shows", async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        const offline = () =>
            Promise.reject(new ServerApiError(0, 'network', 'offline'));
        let online = false;
        const tabApi = {
            ...server.api,
            sendJson: jest.fn((...args: Parameters<typeof send>) =>
                online ? send(...args) : offline()
            ),
        };
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const closed = new ServerUserDataStorage(
            { ...server.api, sendJson: jest.fn(offline) } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await closed.hydrate();
        closed.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await closed.flush();
        const tab = new ServerUserDataStorage(
            tabApi as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await tab.hydrate();
        tab.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: [...favorites(tab).p1, 'Y'] })
        );
        await tab.flush();

        // Later the closed tab's record is stale; this tab is still offline.
        clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
        await tab.hydrate();
        online = true;
        await tab.flush();
        await tab.flush();
        clock.mockRestore();

        expect(
            [...(server.state['xtream-favorites']['p1'] as string[])].sort()
        ).toEqual(['S', 'X', 'Y']);
    });

    it('applies only the edits of a caller that read before another tab saved', async () => {
        const server = fakeServer({
            'xtream-favorites': { p1: ['a'], p2: ['b'] },
        });
        const shared = memoryStorage();
        const tab = () =>
            new ServerUserDataStorage(
                server.api as never,
                shared,
                jest.fn(),
                'default',
                memoryStorage()
            );
        const tabA = tab();
        const tabB = tab();
        await tabA.hydrate();
        await tabB.hydrate();

        const readByA = favorites(tabA);
        tabB.setItem(
            'xtream-favorites',
            JSON.stringify({ ...favorites(tabB), p2: ['b', 'B2'] })
        );
        await tabB.flush();
        // Tab A writes back the map it read before tab B saved.
        tabA.setItem(
            'xtream-favorites',
            JSON.stringify({ ...readByA, p1: ['a', 'A1'] })
        );
        await tabA.flush();
        await tabA.flush();

        expect(server.state['xtream-favorites']).toEqual({
            p1: ['a', 'A1'],
            p2: ['b', 'B2'],
        });
        expect(favorites(tabA)).toEqual({ p1: ['a', 'A1'], p2: ['b', 'B2'] });
    });

    it("keeps this tab's newer progress over a closed tab's older one", async () => {
        const at = (seconds: number) => [
            {
                contentType: 'vod',
                contentXtreamId: 1,
                positionSeconds: seconds,
            },
        ];
        const server = fakeServer({
            'xtream-playback-positions': { p1: at(10) },
        });
        const shared = memoryStorage();
        const offline = () =>
            Promise.reject(new ServerApiError(0, 'network', 'offline'));
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const closed = new ServerUserDataStorage(
            { ...server.api, sendJson: jest.fn(offline) } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await closed.hydrate();
        closed.setItem(
            'xtream-playback-positions',
            JSON.stringify({ p1: at(20) })
        );
        await closed.flush();

        // This tab starts while the server cannot be read: its edit waits.
        let readable = false;
        const tab = new ServerUserDataStorage(
            {
                ...server.api,
                getJson: jest.fn(() =>
                    readable ? server.api.getJson() : offline()
                ),
            } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await expect(tab.hydrate()).rejects.toBeInstanceOf(ServerApiError);
        tab.setItem(
            'xtream-playback-positions',
            JSON.stringify({ p1: at(30) })
        );
        // Later the closed tab's record is stale and the server answers.
        clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
        readable = true;
        await tab.hydrate();
        await tab.flush();
        await tab.flush();
        clock.mockRestore();

        expect(server.state['xtream-playback-positions']['p1']).toEqual(at(30));
    });

    it('does not replay a saved edit whose answer was cut off', async () => {
        const at = (id: number, seconds: number) => ({
            contentType: 'vod',
            contentXtreamId: id,
            positionSeconds: seconds,
        });
        const server = fakeServer({
            'xtream-playback-positions': { p1: [at(1, 10), at(2, 5)] },
        });
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        let cutOff = true;
        let answer = (): void => undefined;
        const tab = new ServerUserDataStorage(
            {
                ...server.api,
                // Saved, but the body with the new tag never arrives.
                sendJson: jest.fn(async (...args: Parameters<typeof send>) => {
                    if (!cutOff) {
                        return send(...args);
                    }
                    cutOff = false;
                    await new Promise<void>((resolve) => (answer = resolve));
                    await send(...args);
                    return {
                        json: async () => {
                            throw new TypeError('body cut off');
                        },
                    } as unknown as Response;
                }),
            } as never,
            memoryStorage(),
            jest.fn(),
            'default',
            memoryStorage()
        );
        await tab.hydrate();
        tab.setItem(
            'xtream-playback-positions',
            JSON.stringify({ p1: [at(1, 20), at(2, 5)] })
        );
        const saving = tab.flush();
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }
        // Movie 2 changes here while that write travels.
        tab.setItem(
            'xtream-playback-positions',
            JSON.stringify({ p1: [at(1, 20), at(2, 6)] })
        );
        answer();
        await saving;
        expect(server.state['xtream-playback-positions']['p1']).toEqual([
            at(1, 20),
            at(2, 5),
        ]);
        // Another device saves movie 1 at 30 s.
        server.state['xtream-playback-positions']['p1'] = [at(1, 30), at(2, 5)];
        await tab.flush();
        await tab.flush();

        expect(server.state['xtream-playback-positions']['p1']).toEqual([
            at(1, 30),
            at(2, 6),
        ]);
    });

    it("keeps the last page load's saved writes when storage refuses the copy", async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        const offline = {
            ...server.api,
            sendJson: jest
                .fn()
                .mockRejectedValue(new ServerApiError(0, 'network', 'offline')),
        };
        const before = new ServerUserDataStorage(
            offline as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        await before.hydrate();
        before.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await before.flush();
        const saved = () =>
            [...local.values.keys()].filter((key) =>
                key.startsWith('iptvnator-server:unsent-writes:')
            );
        expect(saved()).toHaveLength(1);

        // Storage is full now: the reloaded page cannot save its copy.
        const setItem = local.setItem;
        local.setItem = (key: string, value: string) => {
            if (key.startsWith('iptvnator-server:unsent-writes:')) {
                throw new DOMException('full', 'QuotaExceededError');
            }
            setItem(key, value);
        };
        const kept = saved()[0];
        before.close();
        const reloaded = new ServerUserDataStorage(
            offline as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );

        expect(reloaded.hasUnsentWrites()).toBe(true);
        expect(saved()).toEqual([kept]);

        // Space again: this page's copy replaces the one it kept.
        local.setItem = setItem;
        reloaded.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: [...favorites(reloaded).p1, 'Y'] })
        );
        expect(saved()).toHaveLength(1);
        expect(saved()).not.toEqual([kept]);
    });

    it('keeps a recovered write under an early edit made on it', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        const offline = {
            ...server.api,
            sendJson: jest
                .fn()
                .mockRejectedValue(new ServerApiError(0, 'network', 'offline')),
        };
        const before = new ServerUserDataStorage(
            offline as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        await before.hydrate();
        before.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['S', 'old'] })
        );
        await before.flush();

        // Reloaded: the recovered write fails once, the read works.
        before.close();
        const send = server.api.sendJson.getMockImplementation();
        const api = {
            ...server.api,
            sendJson: jest
                .fn()
                .mockRejectedValueOnce(
                    new ServerApiError(0, 'network', 'offline')
                )
                .mockImplementation(send),
        };
        const reloaded = new ServerUserDataStorage(
            api as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        reloaded.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: [...favorites(reloaded).p1, 'new'] })
        );
        await reloaded.hydrate();
        await reloaded.flush();
        await reloaded.flush();

        expect(
            [...(server.state['xtream-favorites']['p1'] as string[])].sort()
        ).toEqual(['S', 'new', 'old']);
    });

    it('keeps an early removal of an item a recovered write adds', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        const before = new ServerUserDataStorage(
            {
                ...server.api,
                sendJson: jest
                    .fn()
                    .mockRejectedValue(
                        new ServerApiError(0, 'network', 'offline')
                    ),
            } as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        await before.hydrate();
        before.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await before.flush();
        before.close();

        const send = server.api.sendJson.getMockImplementation();
        const reloaded = new ServerUserDataStorage(
            {
                ...server.api,
                sendJson: jest
                    .fn()
                    .mockRejectedValueOnce(
                        new ServerApiError(0, 'network', 'offline')
                    )
                    .mockImplementation(send),
            } as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        // X is taken back before the first read; another device adds Z.
        reloaded.setItem('xtream-favorites', JSON.stringify({ p1: ['S'] }));
        server.state['xtream-favorites']['p1'] = ['S', 'Z'];
        await reloaded.hydrate();
        await reloaded.flush();
        await reloaded.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'Z']);
    });

    it('drops an edit of a playlist another device deleted', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();
        phone.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        // Another device deletes the playlist before this edit is sent.
        server.deleted.add('p1');
        delete server.state['xtream-favorites']['p1'];

        await phone.flush();
        await phone.flush();

        expect(server.state['xtream-favorites']).toEqual({});
        expect(phone.hasUnsentWrites()).toBe(false);
        expect(favorites(phone)).toEqual({});
    });

    it('leaves a still running tab its saved writes when the tab is duplicated', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        const offline = {
            ...server.api,
            sendJson: jest
                .fn()
                .mockRejectedValue(new ServerApiError(0, 'network', 'offline')),
        };
        const original = new ServerUserDataStorage(
            offline as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        await original.hydrate();
        original.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['S', 'X'] })
        );
        await original.flush();

        // A duplicated tab starts with a copy of the tab's own storage.
        const copy = memoryStorage();
        for (const [key, value] of tabStore.values) {
            copy.setItem(key, value);
        }
        const duplicate = new ServerUserDataStorage(
            offline as never,
            local,
            jest.fn(),
            'default',
            copy
        );

        expect(duplicate.hasUnsentWrites()).toBe(false);
        expect(original.hasUnsentWrites()).toBe(true);
        expect(
            [...local.values.keys()].filter((key) =>
                key.startsWith('iptvnator-server:unsent-writes:')
            )
        ).toHaveLength(1);
    });

    it('takes over a reload whose close flag was lost once it goes quiet', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const before = new ServerUserDataStorage(
            {
                ...server.api,
                sendJson: jest
                    .fn()
                    .mockRejectedValue(
                        new ServerApiError(0, 'network', 'offline')
                    ),
            } as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        await before.hydrate();
        before.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await before.flush();
        // Storage is full when the page unloads: the close flag is lost.
        const setItem = local.setItem;
        local.setItem = () => {
            throw new DOMException('full', 'QuotaExceededError');
        };
        before.close();
        local.setItem = setItem;

        const reloaded = new ServerUserDataStorage(
            server.api as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        // It looks like a duplicated tab of a running one: nothing taken.
        expect(reloaded.hasUnsentWrites()).toBe(false);

        clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
        reloaded.touch();
        expect(reloaded.hasUnsentWrites()).toBe(true);
        await reloaded.hydrate();
        await reloaded.flush();
        clock.mockRestore();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
    });

    describe('a reload whose close flag was lost', () => {
        const at = (seconds: number) => [
            {
                contentType: 'vod',
                contentXtreamId: 1,
                positionSeconds: seconds,
            },
        ];
        const offline = () =>
            Promise.reject(new ServerApiError(0, 'network', 'offline'));

        /** The last page load saves its edit, then unloads on a full disk. */
        async function lastPageLoad(
            server: ReturnType<typeof fakeServer>,
            local: ReturnType<typeof memoryStorage>,
            tabStore: ReturnType<typeof memoryStorage>,
            edit: (page: ServerUserDataStorage) => Promise<void>
        ) {
            const page = new ServerUserDataStorage(
                { ...server.api, sendJson: jest.fn(offline) } as never,
                local,
                jest.fn(),
                'default',
                tabStore
            );
            await edit(page);
            const setItem = local.setItem;
            local.setItem = () => {
                throw new DOMException('full', 'QuotaExceededError');
            };
            page.close();
            local.setItem = setItem;
        }

        it('keeps the newer progress of the page that adopts it later', async () => {
            const server = fakeServer({
                'xtream-playback-positions': { p1: at(10) },
            });
            const local = memoryStorage();
            const tabStore = memoryStorage();
            const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
            await lastPageLoad(server, local, tabStore, async (page) => {
                await page.hydrate();
                page.setItem(
                    'xtream-playback-positions',
                    JSON.stringify({ p1: at(20) })
                );
                await page.flush();
            });
            let online = false;
            const send = server.api.sendJson.getMockImplementation();
            if (!send) {
                throw new Error('The fake server answers sendJson');
            }
            const reloaded = new ServerUserDataStorage(
                {
                    ...server.api,
                    sendJson: jest.fn((...args: Parameters<typeof send>) =>
                        online ? send(...args) : offline()
                    ),
                } as never,
                local,
                jest.fn(),
                'default',
                tabStore
            );
            await reloaded.hydrate();
            reloaded.setItem(
                'xtream-playback-positions',
                JSON.stringify({ p1: at(30) })
            );
            await reloaded.flush();

            clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
            reloaded.touch();
            online = true;
            await reloaded.flush();
            await reloaded.flush();
            clock.mockRestore();

            expect(server.state['xtream-playback-positions']['p1']).toEqual(
                at(30)
            );
        });

        it('sends its early edits after this page has read', async () => {
            const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
            const local = memoryStorage();
            const tabStore = memoryStorage();
            const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
            await lastPageLoad(server, local, tabStore, async (page) => {
                // Never read: the edit stays an early one.
                page.setItem(
                    'xtream-favorites',
                    JSON.stringify({ p1: ['S', 'X'] })
                );
            });
            const reloaded = new ServerUserDataStorage(
                server.api as never,
                local,
                jest.fn(),
                'default',
                tabStore
            );
            await reloaded.hydrate();

            clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
            reloaded.touch();
            await reloaded.flush();
            await reloaded.flush();
            clock.mockRestore();

            expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
        });

        it("replays its writes on the server's value when this page never read it", async () => {
            const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
            const local = memoryStorage();
            const tabStore = memoryStorage();
            const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
            await lastPageLoad(server, local, tabStore, async (page) => {
                await page.hydrate();
                page.setItem(
                    'xtream-favorites',
                    JSON.stringify({ p1: ['S', 'X'] })
                );
                await page.flush();
            });
            // Another device saves Z; this page's reads keep failing.
            server.state['xtream-favorites']['p1'] = ['S', 'Z'];
            const reloaded = new ServerUserDataStorage(
                { ...server.api, getJson: jest.fn(offline) } as never,
                local,
                jest.fn(),
                'default',
                tabStore
            );

            clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
            reloaded.touch();
            await reloaded.flush();
            await reloaded.flush();
            clock.mockRestore();

            expect(
                [...(server.state['xtream-favorites']['p1'] as string[])].sort()
            ).toEqual(['S', 'X', 'Z']);
        });
    });

    it('keeps a playlist deleted while a re-read was on its way out of the cache', async () => {
        const server = fakeServer({
            'xtream-favorites': { p1: ['a'], p2: ['b'] },
        });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();
        const get = server.api.getJson.getMockImplementation();
        if (!get) {
            throw new Error('The fake server answers getJson');
        }
        let answer: () => void = () => undefined;
        server.api.getJson.mockImplementationOnce(async () => {
            // The server answers with what it had when the read was sent.
            const before = await get();
            return new Promise((resolve) => (answer = () => resolve(before)));
        });

        const reading = phone.hydrate();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await phone.deleting('p1', async () => {
            delete server.state['xtream-favorites']['p1'];
        });
        answer();
        await reading;

        expect(favorites(phone)).toEqual({ p2: ['b'] });
    });

    it('keeps a playlist whose id is __proto__', async () => {
        const server = fakeServer({
            'xtream-favorites': JSON.parse('{"__proto__":["a"],"p2":["b"]}'),
        });
        const phone = new ServerUserDataStorage(
            server.api as never,
            memoryStorage(),
            jest.fn()
        );
        await phone.hydrate();
        expect(Object.keys(favorites(phone))).toEqual(['__proto__', 'p2']);

        const map = favorites(phone);
        Object.defineProperty(map, '__proto__', {
            value: ['a', 'c'],
            enumerable: true,
        });
        phone.setItem('xtream-favorites', JSON.stringify(map));
        await phone.flush();

        expect(
            Object.getOwnPropertyDescriptor(
                server.state['xtream-favorites'],
                '__proto__'
            )?.value
        ).toEqual(['a', 'c']);
        expect(JSON.parse(JSON.stringify(favorites(phone)))).toEqual(
            JSON.parse('{"__proto__":["a","c"],"p2":["b"]}')
        );
    });

    it('leaves saved writes without a record to the tab that saved them', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const tabStore = memoryStorage();
        const offline = {
            ...server.api,
            sendJson: jest
                .fn()
                .mockRejectedValue(new ServerApiError(0, 'network', 'offline')),
        };
        const open = new ServerUserDataStorage(
            offline as never,
            shared,
            jest.fn(),
            'default',
            tabStore
        );
        await open.hydrate();
        open.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await open.flush();
        // Storage refused the record but kept the saved writes.
        for (const key of [...shared.values.keys()]) {
            if (key.startsWith('iptvnator-server:unconfirmed:')) {
                shared.removeItem(key);
            }
        }

        const other = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await other.hydrate();
        await other.flush();
        expect(server.state['xtream-favorites']['p1']).toEqual(['S']);

        // The tab's own reload takes them over.
        const reloaded = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            tabStore
        );
        await reloaded.hydrate();
        await reloaded.flush();
        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
    });
});
