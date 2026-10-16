import { ServerApiError } from './server-api-client';
import { keepPages } from './server-page-pointer';
import {
    markClosed,
    markUnconfirmed,
    UNCONFIRMED_TTL_MS,
} from './server-page-registry';
import { saveUnsentWrites } from './server-unsent-writes';
import { ServerUserDataStorage } from './server-user-data-storage';
import { fakeServer, memoryStorage } from './server-user-data.test-helpers';

/** Lets microtasks run until `condition` holds (a mocked call started). */
async function until(condition: () => boolean): Promise<void> {
    for (let turn = 0; turn < 1000 && !condition(); turn += 1) {
        await Promise.resolve();
    }
    if (!condition()) {
        throw new Error('The awaited call never started');
    }
}

describe('ServerUserDataStorage taking over other page loads', () => {
    it("keeps progress this tab saved over a closed tab's older edit", async () => {
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
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const closed = new ServerUserDataStorage(
            {
                ...server.api,
                sendJson: jest.fn(() =>
                    Promise.reject(new ServerApiError(0, 'network', 'offline'))
                ),
            } as never,
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
        closed.close();

        // This tab saves newer progress before it adopts the closed one.
        const tab = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await tab.hydrate();
        tab.setItem(
            'xtream-playback-positions',
            JSON.stringify({ p1: at(30) })
        );
        // Sent on the server's value: the closed tab's write is unconfirmed.
        await tab.flush();
        await tab.flush();
        expect(server.state['xtream-playback-positions']['p1']).toEqual(at(30));

        clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
        await tab.hydrate();
        await tab.flush();
        await tab.flush();
        clock.mockRestore();

        expect(server.state['xtream-playback-positions']['p1']).toEqual(at(30));
        expect(
            JSON.parse(tab.getItem('xtream-playback-positions') ?? '{}')['p1']
        ).toEqual(at(30));
    });

    it("sends a closed tab's saved write from an idle tab", async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        // Read, and with nothing to sync it never reads again.
        const idle = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await idle.hydrate();
        const closed = new ServerUserDataStorage(
            {
                ...server.api,
                sendJson: jest.fn(() =>
                    Promise.reject(new ServerApiError(0, 'network', 'offline'))
                ),
            } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await closed.hydrate();
        closed.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await closed.flush();
        closed.close();

        clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
        expect(idle.needsSync()).toBe(false);
        idle.touch();
        await idle.flush();
        await idle.flush();
        clock.mockRestore();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
    });

    it('lets a page back from the back-forward cache give up writes another tab took', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const page = () =>
            new ServerUserDataStorage(
                {
                    ...server.api,
                    sendJson: jest.fn(() =>
                        Promise.reject(
                            new ServerApiError(0, 'network', 'offline')
                        )
                    ),
                } as never,
                shared,
                jest.fn(),
                'default',
                memoryStorage()
            );
        // Two pages frozen in the cache with a write each, not closed.
        const adopted = page();
        await adopted.hydrate();
        adopted.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await adopted.flush();
        clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
        const other = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await other.hydrate();
        await other.flush();
        await other.flush();
        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
        const kept = page();
        await kept.hydrate();
        kept.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['S', 'X', 'Y'] })
        );
        await kept.flush();
        clock.mockRestore();

        // Sent by the other tab: sending it again could undo newer edits.
        expect(adopted.resumed()).toBe(false);
        expect(kept.resumed()).toBe(true);
    });

    it("keeps a closed tab's edit giving way through repeated conflicts", async () => {
        const at = (id: number, seconds: number) => ({
            contentType: 'vod',
            contentXtreamId: id,
            positionSeconds: seconds,
        });
        const server = fakeServer({
            'xtream-playback-positions': { p1: [at(1, 10), at(2, 5)] },
        });
        const positions = () => server.state['xtream-playback-positions']['p1'];
        const shared = memoryStorage();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        const closed = new ServerUserDataStorage(
            {
                ...server.api,
                sendJson: jest.fn(() =>
                    Promise.reject(new ServerApiError(0, 'network', 'offline'))
                ),
            } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await closed.hydrate();
        closed.setItem(
            'xtream-playback-positions',
            JSON.stringify({ p1: [at(1, 20), at(2, 5)] })
        );
        await closed.flush();
        closed.close();
        clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
        const tab = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );

        // Adopted; another device moves movie 2 before it is sent.
        await tab.hydrate();
        server.state['xtream-playback-positions']['p1'] = [at(1, 10), at(2, 6)];
        await tab.flush();
        // And movie 1 before the replayed write lands.
        server.state['xtream-playback-positions']['p1'] = [at(1, 30), at(2, 6)];
        await tab.flush();
        await tab.flush();
        clock.mockRestore();

        expect(positions()).toEqual([at(1, 30), at(2, 6)]);
    });

    it("keeps what another tab saved while this tab's read travelled", async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const a = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await a.hydrate();
        let answer = (): void => undefined;
        let asked = false;
        const b = new ServerUserDataStorage(
            {
                ...server.api,
                // Answered with the state of when it was asked.
                getJson: jest.fn(() => {
                    asked = true;
                    const old = server.api.getJson();
                    return new Promise((resolve) => {
                        answer = () => resolve(old);
                    });
                }),
            } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        const reading = b.hydrate();
        // Its read is out before the other tab's write lands.
        await until(() => asked);
        a.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await a.flush();
        answer();
        await reading;

        // Tab A edits the list as it reads it now.
        const read = JSON.parse(a.getItem('xtream-favorites') ?? '{}');
        a.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: [...read.p1, 'Y'] })
        );
        await a.flush();
        await a.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X', 'Y']);
    });

    it('sends nothing more once another tab took its writes over', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        let online = false;
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        const suspended = new ServerUserDataStorage(
            {
                ...server.api,
                sendJson: jest.fn((...args: Parameters<typeof send>) =>
                    online
                        ? send(...args)
                        : Promise.reject(
                              new ServerApiError(0, 'network', 'offline')
                          )
                ),
            } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await suspended.hydrate();
        suspended.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['S', 'X'] })
        );
        await suspended.flush();
        // Suspended past the record lifetime: another tab takes it over,
        // sends it, and the user removes X there afterwards.
        clock.mockReturnValue(1_000 + UNCONFIRMED_TTL_MS + 1);
        const other = new ServerUserDataStorage(
            server.api as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await other.hydrate();
        await other.flush();
        await other.flush();
        other.setItem('xtream-favorites', JSON.stringify({ p1: ['S'] }));
        await other.flush();
        expect(server.state['xtream-favorites']['p1']).toEqual(['S']);

        // Its retry timer runs before the tab is shown again.
        online = true;
        suspended.touch();
        await suspended.flush();
        await suspended.flush();
        clock.mockRestore();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S']);
        expect(suspended.resumed()).toBe(false);
    });

    it("tells whether one playlist's writes were all taken", async () => {
        const server = fakeServer({ 'xtream-favorites': {} });
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        const tab = new ServerUserDataStorage(
            {
                ...server.api,
                // The server refuses p2's entry as too large.
                sendJson: jest.fn(async (...args: Parameters<typeof send>) =>
                    args[1].endsWith('/p2')
                        ? Promise.reject(
                              new ServerApiError(413, 'too_large', 'big')
                          )
                        : send(...args)
                ),
            } as never,
            memoryStorage(),
            jest.fn(),
            'default',
            memoryStorage()
        );
        await tab.hydrate();
        tab.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['live:1'], p2: ['live:2'] })
        );

        await expect(tab.flushed('p1')).resolves.toBe(true);
        await expect(tab.flushed('p2')).resolves.toBe(false);
        await expect(tab.flushed()).resolves.toBe(false);
        expect(server.state['xtream-favorites']['p1']).toEqual(['live:1']);
    });

    it('stays closed when a page-hide write fails after pagehide', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        const page = new ServerUserDataStorage(
            {
                ...server.api,
                // Offline: the page-hide write fails at once.
                sendJson: jest.fn(() =>
                    Promise.reject(new ServerApiError(0, 'network', 'offline'))
                ),
                sendKeepalive: jest.fn(async () => ({
                    status: 'failed' as const,
                })),
            } as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        await page.hydrate();
        page.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));

        // pagehide: flush, then close; the failure is answered after.
        page.flushWithKeepalive();
        page.close();
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }

        // The reload takes its writes over at once, not after ten minutes.
        const reloaded = new ServerUserDataStorage(
            server.api as never,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        await reloaded.hydrate();
        await reloaded.flush();
        await reloaded.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
    });

    it('keeps a write another tab confirmed while this read travelled', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const shared = memoryStorage();
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        let land = (): void => undefined;
        const a = new ServerUserDataStorage(
            {
                ...server.api,
                // Tab A's write is still on its way when B asks.
                sendJson: jest.fn(
                    (...args: Parameters<typeof send>) =>
                        new Promise((resolve) => {
                            land = () => resolve(send(...args));
                        })
                ),
            } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        await a.hydrate();
        a.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        const sending = a.flush();
        let answer = (): void => undefined;
        let asked = false;
        const b = new ServerUserDataStorage(
            {
                ...server.api,
                getJson: jest.fn(() => {
                    asked = true;
                    const old = server.api.getJson();
                    return new Promise((resolve) => {
                        answer = () => resolve(old);
                    });
                }),
            } as never,
            shared,
            jest.fn(),
            'default',
            memoryStorage()
        );
        const reading = b.hydrate();
        // Its read is out before the other tab's write lands.
        await until(() => asked);
        // A's write lands (its record is cleared), then B's old answer.
        land();
        await sending;
        answer();
        await reading;

        // Tab A removes S from the list as it reads it now.
        const read = JSON.parse(a.getItem('xtream-favorites') ?? '{}');
        a.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: read.p1.filter((id: string) => id !== 'S') })
        );
        land = () => undefined;
        const removing = a.flush();
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }
        land();
        await removing;

        expect(server.state['xtream-favorites']['p1']).toEqual(['X']);
    });

    it('finds a kept page load again on a second reload', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        let online = false;
        const send = server.api.sendJson.getMockImplementation();
        if (!send) {
            throw new Error('The fake server answers sendJson');
        }
        const api = {
            ...server.api,
            sendJson: jest.fn((...args: Parameters<typeof send>) =>
                online
                    ? send(...args)
                    : Promise.reject(
                          new ServerApiError(0, 'network', 'offline')
                      )
            ),
        } as never;
        const first = new ServerUserDataStorage(
            api,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        await first.hydrate();
        first.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await first.flush();
        first.close();
        // Its registry record is gone too: only this tab can find it.
        for (const key of local.keys()) {
            if (key.startsWith('iptvnator-server:unconfirmed:')) {
                local.removeItem(key);
            }
        }
        // Storage is full: the reloads cannot save their own copies.
        const setItem = local.setItem;
        local.setItem = (key: string, value: string) => {
            if (key.startsWith('iptvnator-server:unsent-writes:')) {
                throw new DOMException('full', 'QuotaExceededError');
            }
            setItem(key, value);
        };
        const second = new ServerUserDataStorage(
            api,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        expect(second.hasUnsentWrites()).toBe(true);
        second.close();

        // Reloaded again before any copy was saved.
        const third = new ServerUserDataStorage(
            api,
            local,
            jest.fn(),
            'default',
            tabStore
        );
        expect(third.hasUnsentWrites()).toBe(true);
        local.setItem = setItem;
        online = true;
        await third.hydrate();
        await third.flush();
        await third.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'X']);
    });

    it("leaves a running tab's kept page loads to it in a duplicate", async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const local = memoryStorage();
        const tabStore = memoryStorage();
        const api = {
            ...server.api,
            sendJson: jest.fn(() =>
                Promise.reject(new ServerApiError(0, 'network', 'offline'))
            ),
        } as never;
        const page = (store: ReturnType<typeof memoryStorage>) =>
            new ServerUserDataStorage(api, local, jest.fn(), 'default', store);
        const first = page(tabStore);
        await first.hydrate();
        first.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        await first.flush();
        first.close();
        // The reload cannot save its copy: it keeps the first one's.
        const setItem = local.setItem;
        local.setItem = (key: string, value: string) => {
            if (key.startsWith('iptvnator-server:unsent-writes:')) {
                throw new DOMException('full', 'QuotaExceededError');
            }
            setItem(key, value);
        };
        const running = page(tabStore);
        expect(running.hasUnsentWrites()).toBe(true);

        // A duplicate copies the tab's session storage, pointer and all.
        const copied = memoryStorage();
        for (const key of tabStore.keys()) {
            copied.setItem(key, tabStore.getItem(key) ?? '');
        }
        const duplicate = page(copied);

        // The running tab owns those writes and may hold newer ones.
        expect(duplicate.hasUnsentWrites()).toBe(false);
        running.close();
        duplicate.touch();
        expect(duplicate.hasUnsentWrites()).toBe(true);
    });

    describe('a page load and the older one it kept', () => {
        // The older page added X; the newer one took that over and then
        // removed X again; neither copy could replace the other.
        function journals() {
            const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
            const local = memoryStorage();
            const tag = `t${JSON.stringify(['S']).replace(/"/g, "'")}`;
            const entry = (steps: { before: unknown; after: unknown }[]) => [
                {
                    namespace: 'xtream-favorites' as const,
                    playlistId: 'p1',
                    value: steps[steps.length - 1].after,
                    tag,
                    steps,
                },
            ];
            saveUnsentWrites(
                local,
                'default',
                'older',
                entry([{ before: ['S'], after: ['S', 'X'] }])
            );
            saveUnsentWrites(
                local,
                'default',
                'newer',
                entry([
                    { before: ['S'], after: ['S', 'X'] },
                    { before: ['S', 'X'], after: ['S'] },
                ])
            );
            // Another device adds Y meanwhile: the replay decides.
            server.state['xtream-favorites']['p1'] = ['S', 'Y'];
            return { server, local };
        }

        async function send(page: ServerUserDataStorage) {
            await page.hydrate();
            await page.flush();
            await page.flush();
        }

        it('replays them oldest first on a reload', async () => {
            const { server, local } = journals();
            const tabStore = memoryStorage();
            keepPages(tabStore, 'default', 'newer', ['older']);

            await send(
                new ServerUserDataStorage(
                    server.api as never,
                    local,
                    jest.fn(),
                    'default',
                    tabStore
                )
            );

            // X stays removed.
            expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'Y']);
        });

        it('replays them oldest first when a duplicate adopts them', async () => {
            const { server, local } = journals();
            const tabStore = memoryStorage();
            keepPages(tabStore, 'default', 'newer', ['older']);
            // The newer page load still runs when the duplicate opens.
            markUnconfirmed(local, 'default', 'newer', ['xtream-favorites|p1']);
            const duplicate = new ServerUserDataStorage(
                server.api as never,
                local,
                jest.fn(),
                'default',
                tabStore
            );
            markClosed(local, 'default', 'newer');
            duplicate.touch();

            await send(duplicate);

            expect(server.state['xtream-favorites']['p1']).toEqual(['S', 'Y']);
        });
    });

    it('lands a page-hide batch before a flush scheduled in the same turn', async () => {
        const server = fakeServer({ 'xtream-favorites': { p1: ['S'] } });
        const keepalive = server.api.sendKeepalive.getMockImplementation();
        if (!keepalive) {
            throw new Error('The fake server answers sendKeepalive');
        }
        let land = (): void => undefined;
        let started = false;
        const tab = new ServerUserDataStorage(
            {
                ...server.api,
                // The page-hide write is still on its way.
                sendKeepalive: jest.fn(
                    (...args: Parameters<typeof keepalive>) =>
                        new Promise((resolve) => {
                            started = true;
                            land = () => resolve(keepalive(...args));
                        })
                ),
            } as never,
            memoryStorage(),
            jest.fn(),
            'default',
            memoryStorage()
        );
        await tab.hydrate();
        tab.setItem('xtream-favorites', JSON.stringify({ p1: ['S', 'X'] }));
        const flushing = tab.flush();
        tab.flushWithKeepalive();
        // Removed again before either batch was answered.
        tab.setItem('xtream-favorites', JSON.stringify({ p1: ['S'] }));
        await until(() => started);
        // The scheduled flush has its turn while the page-hide write travels.
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }
        land();
        await flushing;
        await tab.flush();
        await tab.flush();

        expect(server.state['xtream-favorites']['p1']).toEqual(['S']);
    });
});
