import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { writeServerAccessToken } from '../server-access-token';
import { takeSlowStart } from '../server-slow-start';
import { ServerStorageStatusService } from '../server-storage-status.service';
import { SERVER_STORAGE_CONFIG } from './server-storage.config';
import { ServerStorageSession } from './server-storage-session';

describe('ServerStorageSession', () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        // start() arms a 3 s startup race and a 30 s retry interval.
        jest.useFakeTimers();
        (globalThis as { fetch: unknown }).fetch = fetchMock;
        fetchMock.mockResolvedValue({
            status: 200,
            ok: true,
            headers: new Headers(),
            json: async () => ({ entries: {} }),
        });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        fetchMock.mockReset();
        localStorage.clear();
        sessionStorage.clear();
        TestBed.resetTestingModule();
    });

    function setup(auth: 'none' | 'token', startedOffline = false) {
        TestBed.configureTestingModule({
            providers: [
                provideRouter([{ path: 'server-sign-in', children: [] }]),
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsSqlite: false },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                {
                    provide: SERVER_STORAGE_CONFIG,
                    useValue: {
                        baseUrl: '/api',
                        startedOffline,
                        instance: {
                            service: 'iptvnator',
                            apiVersion: 1,
                            instanceId: 'i-1',
                            storage: 'server',
                            auth,
                        },
                    },
                },
            ],
        });
        return {
            session: TestBed.inject(ServerStorageSession),
            backend: TestBed.inject(PlaylistStorageBackend),
            status: TestBed.inject(ServerStorageStatusService),
        };
    }

    it('switches playlists to the server and hydrates user data', async () => {
        const { session, backend, status } = setup('none');

        await session.start();

        expect(backend.kind()).toBe('server');
        expect(status.state()).toBe('online');
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/user-state',
            expect.anything()
        );
    });

    it('stops at unauthorized when a token is required but missing', async () => {
        const { session, status } = setup('token');

        await session.start();

        expect(status.state()).toBe('unauthorized');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('marks the page closed on page hide also while sign-in is pending', async () => {
        const { session } = setup('token');
        const close = jest.spyOn(session.userData, 'close');

        await session.start();
        window.dispatchEvent(new Event('pagehide'));

        expect(close).toHaveBeenCalled();
    });

    it('starts with a stored token', async () => {
        writeServerAccessToken('t', 'i-1');
        const { session, status } = setup('token');

        await session.start();

        expect(status.state()).toBe('online');
    });

    it("asks for a token when the stored one is another instance's", async () => {
        writeServerAccessToken('t', 'i-2');
        const { session, status } = setup('token');

        await session.start();

        expect(status.state()).toBe('unauthorized');
    });

    it('retries a write the server refused while it stays online', async () => {
        const { session, status } = setup('none');
        await session.start();
        const ok = fetchMock.getMockImplementation();
        fetchMock.mockImplementation(
            async (url: string, init?: { method?: string }) =>
                init?.method === 'PUT'
                    ? {
                          status: 500,
                          ok: false,
                          headers: new Headers(),
                          json: async () => ({ code: 'x', message: 'down' }),
                      }
                    : ok?.(url, init)
        );

        session.userData.setItem(
            'xtream-favorites',
            JSON.stringify({ p1: ['x'] })
        );
        await session.userData.flush();
        expect(status.state()).toBe('online');
        expect(session.userData.hasUnsentWrites()).toBe(true);

        fetchMock.mockImplementation(async () => ({
            status: 200,
            ok: true,
            headers: new Headers(),
            json: async () => ({ entries: {}, tag: 't' }),
        }));
        await jest.advanceTimersByTimeAsync(30_000);

        expect(session.userData.hasUnsentWrites()).toBe(false);
    });

    it('reloads a page back from the back-forward cache whose writes another tab took', async () => {
        const { session } = setup('none');
        const reload = jest
            .spyOn(session as unknown as { reloadPage(): void }, 'reloadPage')
            .mockImplementation(() => undefined);
        await session.start();
        const resumed = jest
            .spyOn(session.userData, 'resumed')
            .mockReturnValue(true);
        const pageshow = (persisted: boolean) =>
            window.dispatchEvent(
                Object.assign(new Event('pageshow'), { persisted })
            );

        pageshow(false);
        pageshow(true);
        expect(resumed).toHaveBeenCalledTimes(1);
        expect(reload).not.toHaveBeenCalled();

        resumed.mockReturnValue(false);
        pageshow(true);
        expect(reload).toHaveBeenCalledTimes(1);

        // So does a background tab the browser suspended as long.
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(reload).toHaveBeenCalledTimes(2);
        delete (document as { visibilityState?: unknown }).visibilityState;

        // And its retry timer, which may run before it is shown again.
        jest.advanceTimersByTime(30_000);
        expect(reload).toHaveBeenCalledTimes(3);
    });

    it('goes to sign-in on every sign-out, also when already signed out', async () => {
        const { session } = setup('none');
        await session.start();
        const navigate = jest
            .spyOn(TestBed.inject(Router), 'navigateByUrl')
            .mockResolvedValue(false);

        session.signOut();
        // A guard kept the page (unsaved Settings); the user signs out again.
        session.signOut();

        expect(navigate).toHaveBeenCalledTimes(2);
        expect(navigate).toHaveBeenLastCalledWith('/server-sign-in');
    });

    describe('after losing the server', () => {
        const answer = (body: unknown) => ({
            status: 200,
            ok: true,
            headers: new Headers(),
            json: async () => body,
        });

        it('checks the instance before the token and writes go out again', async () => {
            writeServerAccessToken('t', 'i-1');
            const { session, status } = setup('token');
            await session.start();
            expect(status.accessToken()).toBe('t');

            status.reportOffline();

            expect(status.accessToken()).toBeNull();
            fetchMock.mockClear();
            await expect(
                session.api.sendJson('PUT', '/user-state/a/b', { value: 1 })
            ).rejects.toThrow();
            expect(fetchMock).not.toHaveBeenCalled();

            fetchMock.mockResolvedValue(
                answer({ instanceId: 'i-1', entries: {} })
            );
            await session.refresh();

            expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/instance');
            expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
                'Authorization'
            );
            expect(status.accessToken()).toBe('t');
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/v1/user-state',
                expect.anything()
            );
        });

        it('checks only the instance at once when it goes offline', async () => {
            const { session, status } = setup('none');
            await session.start();
            // The instance answers, its user data does not.
            fetchMock.mockImplementation(async (url: string) =>
                url.endsWith('/instance')
                    ? answer({ instanceId: 'i-1' })
                    : { status: 503, ok: false, headers: new Headers() }
            );
            fetchMock.mockClear();

            status.reportOffline();
            TestBed.tick();
            for (let turn = 0; turn < 10; turn += 1) {
                await Promise.resolve();
            }

            expect(status.isVerified()).toBe(true);
            // A failing read waits for the retry interval, not a loop.
            expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
                '/api/v1/instance',
            ]);
        });

        it('checks at once only once per retry interval', async () => {
            const { session, status } = setup('none');
            await session.start();
            // Headers arrive, the body is cut off: success, then offline.
            fetchMock.mockResolvedValue({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => {
                    throw new TypeError('body cut off');
                },
            });
            fetchMock.mockClear();

            status.reportOffline();
            for (let round = 0; round < 5; round += 1) {
                TestBed.tick();
                for (let turn = 0; turn < 10; turn += 1) {
                    await Promise.resolve();
                }
            }

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it('keeps checking an unverified page a late answer set online', async () => {
            writeServerAccessToken('t', 'i-1');
            const { session, status } = setup('token');
            await session.start();
            fetchMock.mockRejectedValue(new TypeError('offline'));
            status.reportOffline();
            TestBed.tick();
            for (let turn = 0; turn < 10; turn += 1) {
                await Promise.resolve();
            }
            // A request sent before the outage is answered late.
            status.reportSuccess();
            expect(status.state()).toBe('online');
            expect(status.isVerified()).toBe(false);
            fetchMock.mockReset();
            fetchMock.mockResolvedValue(
                answer({ instanceId: 'i-1', entries: {} })
            );

            jest.advanceTimersByTime(30_000);
            for (let turn = 0; turn < 10; turn += 1) {
                await Promise.resolve();
            }

            expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/instance');
            expect(status.isVerified()).toBe(true);
        });

        it('reloads when another instance answers at the address', async () => {
            const { session, status } = setup('none');
            const reload = jest
                .spyOn(
                    session as unknown as { reloadPage(): void },
                    'reloadPage'
                )
                .mockImplementation(() => undefined);
            await session.start();
            status.reportOffline();
            fetchMock.mockClear();
            fetchMock.mockResolvedValue(answer({ instanceId: 'other' }));

            await session.refresh();

            expect(reload).toHaveBeenCalled();
            expect(fetchMock).not.toHaveBeenCalledWith(
                '/api/v1/user-state',
                expect.anything()
            );
        });
    });

    describe('after an offline start', () => {
        it('stays offline until the server answers, then reloads once', async () => {
            const { session, status } = setup('none', true);
            const reload = jest
                .spyOn(
                    session as unknown as { reloadPage(): void },
                    'reloadPage'
                )
                .mockImplementation(() => undefined);
            fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

            await session.start();
            expect(status.state()).toBe('offline');
            expect(reload).not.toHaveBeenCalled();

            fetchMock.mockResolvedValue({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => ({ entries: {} }),
            });
            await session.refresh();
            await session.refresh();

            expect(reload).toHaveBeenCalledTimes(1);
            // The reloaded page's probe waits as long as this request did.
            expect(takeSlowStart()).toBe(true);
        });

        it('sends no write before the reload checks the instance', async () => {
            // A write this tab's last page load could not send.
            sessionStorage.setItem('iptvnator-server:page:i-1', 'last');
            localStorage.setItem(
                'iptvnator-server:unsent-writes:i-1:last',
                JSON.stringify([
                    {
                        namespace: 'xtream-favorites',
                        playlistId: 'p1',
                        value: ['x'],
                    },
                ])
            );
            const { session } = setup('none', true);
            jest.spyOn(
                session as unknown as { reloadPage(): void },
                'reloadPage'
            ).mockImplementation(() => undefined);

            await session.start();
            session.userData.flushWithKeepalive();
            await session.userData.flush();

            expect(
                fetchMock.mock.calls.map(([url, init]) => [
                    url,
                    init?.method ?? 'GET',
                ])
            ).toEqual([['/api/v1/instance', 'GET']]);
            expect(session.userData.hasUnsentWrites()).toBe(true);
        });

        it('checks the instance before a token may go out', async () => {
            const { session, status } = setup('token', true);
            const reload = jest
                .spyOn(
                    session as unknown as { reloadPage(): void },
                    'reloadPage'
                )
                .mockImplementation(() => undefined);
            await session.start();
            writeServerAccessToken('t', 'i-1');
            expect(status.accessToken()).toBeNull();

            fetchMock.mockResolvedValue({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => ({ instanceId: 'other' }),
            });
            await expect(session.ensureVerified()).rejects.toThrow();
            expect(reload).toHaveBeenCalled();
            expect(status.accessToken()).toBeNull();

            fetchMock.mockResolvedValue({
                status: 200,
                ok: true,
                headers: new Headers(),
                json: async () => ({ instanceId: 'i-1' }),
            });
            await session.ensureVerified();
            expect(status.accessToken()).toBe('t');
        });

        it('never reloads after a normal start', async () => {
            const { session } = setup('none');
            const reload = jest
                .spyOn(
                    session as unknown as { reloadPage(): void },
                    'reloadPage'
                )
                .mockImplementation(() => undefined);

            await session.start();
            await session.refresh();

            expect(reload).not.toHaveBeenCalled();
        });
    });
});
