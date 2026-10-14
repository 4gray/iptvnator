import { ServerApiError } from './server-api-client';
import { UNCONFIRMED_TTL_MS } from './server-unsent-writes';
import { ServerUserDataStorage } from './server-user-data-storage';
import { fakeServer, memoryStorage } from './server-user-data.test-helpers';

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
        const b = new ServerUserDataStorage(
            {
                ...server.api,
                // Answered with the state of when it was asked.
                getJson: jest.fn(() => {
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
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }
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
});
