import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistStorageBackend } from '../playlist-storage-backend';
import { RuntimeCapabilitiesService } from '../runtime-capabilities.service';
import { SERVER_ACCESS_TOKEN_STORAGE_KEY } from '../server-access-token';
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

    it('starts with a stored token', async () => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 't');
        const { session, status } = setup('token');

        await session.start();

        expect(status.state()).toBe('online');
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
