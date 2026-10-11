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
        TestBed.resetTestingModule();
    });

    function setup(auth: 'none' | 'token') {
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
});
