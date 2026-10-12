import { ServerApiError } from './server-api-client';
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

/** A server that keeps entries, tags them by content and refuses stale tags. */
function fakeServer(initial: Record<string, Record<string, unknown>> = {}) {
    const state: Record<string, Record<string, unknown>> = {
        'xtream-favorites': {},
        'xtream-recent-items': {},
        'xtream-collection-items': {},
        'xtream-playback-positions': {},
        ...structuredClone(initial),
    };
    const tagOf = (value: unknown) =>
        value === undefined
            ? null
            : `t${JSON.stringify(value).replace(/"/g, "'")}`;
    const answer = (body: unknown) =>
        ({ json: async () => body }) as unknown as Response;
    const write = (
        path: string,
        headers: Record<string, string>,
        value?: unknown
    ) => {
        const [, , namespace, playlistId] = path.split('/');
        const current = state[namespace][playlistId];
        const expected =
            headers['If-None-Match'] === '*'
                ? null
                : headers['If-Match']?.replace(/^"|"$/g, '');
        if (expected !== undefined && expected !== tagOf(current)) {
            throw new ServerApiError(412, 'conflict', 'changed', {
                ...(current === undefined ? {} : { value: current }),
                tag: tagOf(current),
            });
        }
        if (value === undefined) {
            delete state[namespace][playlistId];
        } else {
            state[namespace][playlistId] = value;
        }
        return answer({ tag: tagOf(value) });
    };
    const api = {
        getJson: jest.fn(async () => {
            const tags: Record<string, Record<string, string>> = {};
            for (const [namespace, entries] of Object.entries(state)) {
                tags[namespace] = Object.fromEntries(
                    Object.entries(entries).map(([id, value]) => [
                        id,
                        tagOf(value) as string,
                    ])
                );
            }
            return { entries: structuredClone(state), tags };
        }),
        sendJson: jest.fn(
            async (
                _method: string,
                path: string,
                body: { value: unknown },
                headers: Record<string, string> = {}
            ) => write(path, headers, body.value)
        ),
        request: jest.fn(
            async (path: string, init: { headers?: Record<string, string> }) =>
                write(path, init.headers ?? {})
        ),
        readJson: jest.fn((response: Response) => response.json()),
        sendKeepalive: jest.fn(
            async (
                _method: string,
                path: string,
                body?: { value: unknown },
                headers: Record<string, string> = {}
            ) => {
                try {
                    const response = write(path, headers, body?.value);
                    const { tag } = await response.json();
                    return { status: 'saved' as const, tag };
                } catch (error) {
                    return error instanceof ServerApiError && error.current
                        ? {
                              status: 'conflict' as const,
                              current: error.current,
                          }
                        : { status: 'failed' as const };
                }
            }
        ),
    };
    return { state, api };
}

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
        const registry = 'iptvnator-server:unconfirmed:default';
        const records = JSON.parse(shared.values.get(registry) ?? '{}');
        for (const record of Object.values(records)) {
            (record as { at: number }).at = 0;
        }
        shared.setItem(registry, JSON.stringify(records));

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
});
