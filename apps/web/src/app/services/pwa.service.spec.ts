import {
    HttpClientTestingModule,
    HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { config as rxjsConfig, Observable, of, Subject } from 'rxjs';
import {
    buildHostConnectivityFastFailMessage,
    CONNECTIVITY_GUARD_RESET,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_UPDATE,
    STALKER_REQUEST,
    XTREAM_REQUEST,
} from '@iptvnator/shared/interfaces';
import {
    getStalkerRequestErrorStatus,
    isStalkerProbeTimeout,
} from '@iptvnator/portal/stalker/data-access';
import {
    clearServerAccessToken,
    ServerStorageStatusService,
    writeServerAccessToken,
} from '@iptvnator/services';
import { PwaService } from './pwa.service';

describe('PwaService', () => {
    let http: HttpTestingController;
    let service: PwaService;
    let versionUpdates: Subject<void>;

    beforeEach(() => {
        versionUpdates = new Subject<void>();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);

        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [
                PwaService,
                {
                    provide: LazySnackBar,
                    useValue: {
                        open: jest.fn().mockResolvedValue(null),
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        dispatch: jest.fn(),
                    },
                },
                {
                    provide: SwUpdate,
                    useValue: {
                        versionUpdates,
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
            ],
        });

        http = TestBed.inject(HttpTestingController);
        service = TestBed.inject(PwaService);
    });

    afterEach(() => {
        http.verify();
        jest.restoreAllMocks();
    });

    it('reloads the page from the update toast once the toast is open and its action is chosen', async () => {
        let showToast!: (ref: {
            onAction: () => Observable<undefined>;
        }) => void;
        const open = TestBed.inject(LazySnackBar).open as jest.Mock;
        open.mockImplementation(
            () => new Promise((resolve) => (showToast = resolve))
        );
        service.reloadWindow = jest.fn();

        service.checkUpdates();
        versionUpdates.next();

        expect(open).toHaveBeenCalledWith('UPDATE_AVAILABLE', 'REFRESH');
        expect(service.reloadWindow).not.toHaveBeenCalled();

        // The toast chunk arrives, the user picks Refresh.
        showToast({ onAction: () => of(undefined) });
        await new Promise((resolve) => setTimeout(resolve));

        expect(service.reloadWindow).toHaveBeenCalledTimes(1);
    });

    it('passes explicit connection-test evidence through without a playback response', async () => {
        const failure = {
            connectionFailure: { kind: 'connection', canTryHttp: true },
        };
        const pending = service.sendIpcEvent(XTREAM_REQUEST, {
            url: 'https://provider.example',
            params: { username: 'user', password: 'pass' },
            connectionTest: true,
        });
        http.expectOne((req) => req.url.endsWith('/provider-targets')).flush({
            targetId: 'test-target',
        });
        await new Promise((resolve) => setTimeout(resolve));
        const request = http.expectOne((req) => req.url.endsWith('/xtream'));
        expect(request.request.params.get('connectionTest')).toBe('true');
        request.flush(failure);
        expect(await pending).toEqual(failure);
        expect(TestBed.inject(LazySnackBar).open).not.toHaveBeenCalled();
    });

    it('ignores URL imports without a payload or URL instead of calling the backend', () => {
        service.sendIpcEvent(PLAYLIST_PARSE_BY_URL);
        service.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {});

        expect(http.match(() => true)).toHaveLength(0);
    });

    it('ignores playlist refreshes without a payload, URL, or id instead of calling the backend', () => {
        service.sendIpcEvent(PLAYLIST_UPDATE);
        service.sendIpcEvent(PLAYLIST_UPDATE, { id: 'playlist-1' });
        service.sendIpcEvent(PLAYLIST_UPDATE, {
            url: 'https://example.test/playlist.m3u',
        });

        expect(http.match(() => true)).toHaveLength(0);
    });

    it.each([PLAYLIST_PARSE_BY_URL, PLAYLIST_UPDATE])(
        'passes the saved User-Agent through the proxy for %s',
        async (event) => {
            service.sendIpcEvent(event, {
                id: 'playlist-1',
                url: 'https://provider.example/list.m3u',
                userAgent: '  IPTVnator-Test/1.0  ',
            });
            http.expectOne((req) =>
                req.url.endsWith('/provider-targets')
            ).flush({ targetId: 'target-ua' });
            await new Promise((resolve) => setTimeout(resolve));
            const parse = http.expectOne((req) => req.url.endsWith('/parse'));
            expect(parse.request.params.get('userAgent')).toBe(
                'IPTVnator-Test/1.0'
            );
            expect(parse.request.headers.has('User-Agent')).toBe(false);
            parse.flush({ _id: 'playlist-1', userAgent: 'IPTVnator-Test/1.0' });
            expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    playlist: expect.objectContaining({
                        userAgent: 'IPTVnator-Test/1.0',
                    }),
                })
            );
        }
    );

    it.each([undefined, '', '   '])(
        'omits a blank User-Agent from proxy requests: %s',
        async (userAgent) => {
            service
                .getPlaylistFromUrl(
                    'https://provider.example/list.m3u',
                    userAgent
                )
                .subscribe();
            http.expectOne((req) =>
                req.url.endsWith('/provider-targets')
            ).flush({ targetId: 'target-default' });
            await new Promise((resolve) => setTimeout(resolve));
            const parse = http.expectOne((req) => req.url.endsWith('/parse'));
            expect(parse.request.params.keys()).toEqual(['targetId']);
            expect(parse.request.headers.has('User-Agent')).toBe(false);
            parse.flush({});
        }
    );

    it('translates the too-large upload message', () => {
        expect(service.getErrorMessageByStatusCode(413)).toBe(
            'HOME.URL_UPLOAD.ERROR_413'
        );
    });

    it('appends the proxy network code to the URL-import failure toast', async () => {
        // The /parse proxy reports connection-level failures as HTTP 500 with
        // a `code` field in the body (#1400). The toast must carry that code —
        // status-only mapping used to collapse ETIMEDOUT into the generic
        // fetch error. The rethrow after the snackbar has no downstream error
        // observer, so park RxJS's unhandled-error hook for the test.
        const unhandled: unknown[] = [];
        const previousHandler = rxjsConfig.onUnhandledError;
        rxjsConfig.onUnhandledError = (error) => unhandled.push(error);

        try {
            service.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
                url: 'https://provider.example/list.m3u',
            });

            await Promise.resolve();
            http.expectOne((req) =>
                req.url.endsWith('/provider-targets')
            ).flush({ targetId: 'target-1' });
            await new Promise((resolve) => setTimeout(resolve));

            http.expectOne((req) => req.url.endsWith('/parse')).flush(
                {
                    message: 'Error, something went wrong (ETIMEDOUT)',
                    status: 500,
                    code: 'ETIMEDOUT',
                },
                { status: 500, statusText: 'Internal Server Error' }
            );
            await new Promise((resolve) => setTimeout(resolve));

            expect(TestBed.inject(LazySnackBar).open).toHaveBeenCalledWith(
                'HOME.URL_UPLOAD.ERROR_FETCH_FAILED (ETIMEDOUT)',
                'CLOSE',
                { duration: 5000 }
            );
        } finally {
            rxjsConfig.onUnhandledError = previousHandler;
        }
    });

    it('settles a playlist refresh only once the backend has answered', async () => {
        let settled = false;
        const pending = Promise.resolve(
            service.sendIpcEvent(PLAYLIST_UPDATE, {
                id: 'playlist-1',
                url: 'https://provider.example/list.m3u',
            })
        ).then(() => {
            settled = true;
        });

        http.expectOne((req) => req.url.endsWith('/provider-targets')).flush({
            targetId: 'target-1',
        });
        await new Promise((resolve) => setTimeout(resolve));
        // The caller keeps the source busy while the parse is in flight.
        expect(settled).toBe(false);

        http.expectOne((req) => req.url.endsWith('/parse')).flush({
            _id: 'playlist-1',
        });
        await pending;
        expect(settled).toBe(true);
        expect(TestBed.inject(Store).dispatch).toHaveBeenCalled();
    });

    it('settles a failed playlist refresh after reporting it', async () => {
        const pending = service.sendIpcEvent(PLAYLIST_UPDATE, {
            id: 'playlist-1',
            url: 'https://provider.example/list.m3u',
        });

        http.expectOne((req) => req.url.endsWith('/provider-targets')).flush({
            targetId: 'target-1',
        });
        await new Promise((resolve) => setTimeout(resolve));
        http.expectOne((req) => req.url.endsWith('/parse')).flush(
            { message: 'failed', status: 500 },
            { status: 500, statusText: 'Internal Server Error' }
        );

        await expect(pending).resolves.toBeUndefined();
        expect(TestBed.inject(LazySnackBar).open).toHaveBeenCalledWith(
            expect.any(String),
            'CLOSE',
            { duration: 5000 }
        );
    });

    it('appends the proxy network code to the playlist-refresh failure toast', async () => {
        const unhandled: unknown[] = [];
        const previousHandler = rxjsConfig.onUnhandledError;
        rxjsConfig.onUnhandledError = (error) => unhandled.push(error);

        try {
            service.sendIpcEvent(PLAYLIST_UPDATE, {
                id: 'playlist-1',
                url: 'https://provider.example/list.m3u',
            });

            await Promise.resolve();
            http.expectOne((req) =>
                req.url.endsWith('/provider-targets')
            ).flush({ targetId: 'target-1' });
            await new Promise((resolve) => setTimeout(resolve));

            http.expectOne((req) => req.url.endsWith('/parse')).flush(
                {
                    message: 'Error, something went wrong (ENETUNREACH)',
                    status: 500,
                    code: 'ENETUNREACH',
                },
                { status: 500, statusText: 'Internal Server Error' }
            );
            await new Promise((resolve) => setTimeout(resolve));

            expect(TestBed.inject(LazySnackBar).open).toHaveBeenCalledWith(
                'HOME.URL_UPLOAD.ERROR_FETCH_FAILED (ENETUNREACH)',
                'CLOSE',
                { duration: 5000 }
            );
        } finally {
            rxjsConfig.onUnhandledError = previousHandler;
        }
    });

    it('surfaces the stalker proxy error envelope as an HTTP error instead of undefined', async () => {
        // The web-backend converts an upstream 404 into HTTP 200 with a
        // `{ message, status }` body and NO `payload` key. Unwrapping
        // `payload` silently returned undefined, so endpoint discovery and
        // the lazy portal repair could never classify a dead endpoint.
        // JSDOM ships no global fetch — install one for the call under test.
        const originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ message: 'Not Found', status: 404 }),
        } as unknown as Response) as unknown as typeof fetch;

        const request = service.sendIpcEvent(STALKER_REQUEST, {
            url: 'http://portal.example/portal.php',
            macAddress: '00:1A:79:AA:BB:CC',
            params: { action: 'get_genres' },
            silent: true,
        }) as Promise<unknown>;
        const outcome = (request as Promise<unknown>).then(
            () => {
                throw new Error('expected rejection');
            },
            (error: unknown) => error
        );

        // Provider-target registration goes through HttpClient first.
        await Promise.resolve();
        const registration = http.expectOne((candidate) =>
            candidate.url.endsWith('/provider-targets')
        );
        registration.flush({ targetId: 'target-1' });

        const error = (await outcome) as Error & { status?: number };
        expect(error.message).toBe('HTTP Error 404: Not Found');
        expect(error.status).toBe(404);
        // silent flag: discovery probes expect failures — no snackbar.
        expect(TestBed.inject(LazySnackBar).open).not.toHaveBeenCalled();

        globalThis.fetch = originalFetch;
    });

    it('sends a stored server token only while server mode runs', async () => {
        writeServerAccessToken('kept-token', 'i');
        const originalFetch = globalThis.fetch;
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers(),
            json: async () => ({ js: [] }),
        } as unknown as Response);
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const call = async () => {
            const outcome = (
                service.sendIpcEvent(STALKER_REQUEST, {
                    url: 'http://portal.example/portal.php',
                    macAddress: '00:1A:79:AA:BB:CC',
                    params: { action: 'get_genres' },
                    silent: true,
                }) as Promise<unknown>
            ).catch((error: unknown) => error);
            await Promise.resolve();
            for (const request of http.match((candidate) =>
                candidate.url.endsWith('/provider-targets')
            )) {
                request.flush({ targetId: 'target-1' });
            }
            await outcome;
        };

        try {
            // A token kept from another backend: server mode is not active.
            await call();
            expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
                'Authorization'
            );

            TestBed.inject(ServerStorageStatusService).activate(
                {
                    service: 'iptvnator',
                    apiVersion: 1,
                    instanceId: 'i',
                    storage: 'server',
                    auth: 'token',
                },
                () => undefined
            );
            await call();
            expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
                Authorization: 'Bearer kept-token',
            });
        } finally {
            globalThis.fetch = originalFetch;
            clearServerAccessToken();
        }
    });

    it('asks for a new server token when the access guard refuses a Stalker call', async () => {
        const status = TestBed.inject(ServerStorageStatusService);
        status.activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i',
                storage: 'server',
                auth: 'token',
            },
            () => undefined
        );
        const originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            headers: new Headers({
                'WWW-Authenticate': 'Bearer realm="iptvnator"',
            }),
            json: async () => ({ code: 'unauthorized' }),
        } as unknown as Response) as unknown as typeof fetch;

        const outcome = (
            service.sendIpcEvent(STALKER_REQUEST, {
                url: 'http://portal.example/portal.php',
                macAddress: '00:1A:79:AA:BB:CC',
                params: { action: 'get_genres' },
                silent: true,
            }) as Promise<unknown>
        ).catch((error: unknown) => error);
        await Promise.resolve();
        http.expectOne((candidate) =>
            candidate.url.endsWith('/provider-targets')
        ).flush({ targetId: 'target-1' });
        await outcome;

        expect(status.state()).toBe('unauthorized');
        globalThis.fetch = originalFetch;
    });

    it('sends Stalker credentials as /stalker control params, including the serial', async () => {
        // JSDOM ships no fetch; install one for the proxy call.
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ payload: { js: [] } }),
        } as unknown as Response);
        const globalWithFetch = globalThis as { fetch?: typeof fetch };
        globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

        try {
            const request = service.forwardStalkerRequest({
                url: 'http://portal.example/stalker_portal/server/load.php',
                macAddress: '00:1A:79:AA:BB:CC',
                token: 'TOKEN123',
                serialNumber: 'SN1234',
                params: { type: 'itv', action: 'get_ordered_list' },
            });

            http.expectOne((req) =>
                req.url.endsWith('/provider-targets')
            ).flush({ targetId: 'target-1' });

            await expect(request).resolves.toEqual({ js: [] });

            const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
            // The proxy turns these into the portal-facing
            // Cookie/Authorization/SN headers; they must all reach it so the
            // PWA transport can match the Electron one.
            expect(requestUrl.searchParams.get('macAddress')).toBe(
                '00:1A:79:AA:BB:CC'
            );
            expect(requestUrl.searchParams.get('token')).toBe('TOKEN123');
            expect(requestUrl.searchParams.get('serialNumber')).toBe('SN1234');
            expect(requestUrl.searchParams.get('action')).toBe(
                'get_ordered_list'
            );
        } finally {
            delete globalWithFetch.fetch;
        }
    });

    it('surfaces a connectivity-guard fast-fail as a status-less connection failure', async () => {
        // The backend refuses to contact a host that stopped answering, using
        // the same HTTP 200 `{ message, status }` envelope as every other
        // provider failure. It must NOT come out of here as the test above
        // does: an `HTTP Error <code>` message or a numeric `status` both read
        // as "the endpoint answered", so endpoint discovery would keep walking
        // candidates, and a 4xx reading would fire lazy portal repair against
        // a host just declared unreachable.
        const message = buildHostConnectivityFastFailMessage(
            'portal.example:8080'
        );
        const originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ message, status: 502 }),
        } as unknown as Response) as unknown as typeof fetch;

        const request = service.sendIpcEvent(STALKER_REQUEST, {
            url: 'http://portal.example:8080/portal.php',
            macAddress: '00:1A:79:AA:BB:CC',
            params: { action: 'get_genres' },
            silent: true,
        }) as Promise<unknown>;
        const outcome = request.then(
            () => {
                throw new Error('expected rejection');
            },
            (error: unknown) => error
        );

        await Promise.resolve();
        http.expectOne((candidate) =>
            candidate.url.endsWith('/provider-targets')
        ).flush({ targetId: 'target-1' });

        const error = (await outcome) as Error & { status?: number };
        expect(error.message).toBe(message);
        expect(error.status).toBeUndefined();
        expect(getStalkerRequestErrorStatus(error)).toBeUndefined();
        expect(isStalkerProbeTimeout(error)).toBe(false);

        globalThis.fetch = originalFetch;
    });

    it('carries the discovery guard bypass through to the /stalker proxy', async () => {
        // The Electron transport honours `skipConnectionGuard` on the payload.
        // Dropping it here let two probe timeouts open the backend's breaker
        // and fast-fail the healthy candidate discovery was looking for.
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ payload: { js: [] } }),
        } as unknown as Response);
        const globalWithFetch = globalThis as { fetch?: typeof fetch };
        globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

        try {
            const request = service.forwardStalkerRequest({
                url: 'http://portal.example/portal.php',
                macAddress: '00:1A:79:AA:BB:CC',
                params: { action: 'get_genres' },
                silent: true,
                skipConnectionGuard: true,
            });

            http.expectOne((req) =>
                req.url.endsWith('/provider-targets')
            ).flush({ targetId: 'target-1' });

            await expect(request).resolves.toEqual({ js: [] });

            const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
            expect(requestUrl.searchParams.get('skipConnectionGuard')).toBe(
                'true'
            );
        } finally {
            delete globalWithFetch.fetch;
        }
    });

    it('omits the discovery guard bypass for ordinary Stalker requests', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ payload: { js: [] } }),
        } as unknown as Response);
        const globalWithFetch = globalThis as { fetch?: typeof fetch };
        globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

        try {
            const request = service.forwardStalkerRequest({
                url: 'http://portal.example/portal.php',
                macAddress: '00:1A:79:AA:BB:CC',
                params: { action: 'get_categories' },
            });

            http.expectOne((req) =>
                req.url.endsWith('/provider-targets')
            ).flush({ targetId: 'target-1' });

            await expect(request).resolves.toEqual({ js: [] });

            const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
            expect(requestUrl.searchParams.has('skipConnectionGuard')).toBe(
                false
            );
        } finally {
            delete globalWithFetch.fetch;
        }
    });

    it('gives up on a reset the backend never answers', async () => {
        // Every caller awaits the reset BEFORE the request it is clearing the
        // way for, and `fetch` has no timeout of its own — so a backend that
        // accepts the POST and goes quiet would leave Retry doing nothing at
        // all, which is the failure this whole change exists to stop.
        jest.useFakeTimers();
        const globalWithFetch = globalThis as { fetch?: typeof fetch };
        let capturedSignal: AbortSignal | undefined;
        globalWithFetch.fetch = jest.fn((_url: unknown, init: RequestInit) => {
            capturedSignal = init.signal ?? undefined;
            // Never settles on its own; only the abort can end this.
            return new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener('abort', () =>
                    reject(new DOMException('Aborted', 'AbortError'))
                );
            });
        }) as unknown as typeof fetch;

        try {
            const request = service.sendIpcEvent(CONNECTIVITY_GUARD_RESET, {
                url: 'http://portal.example:8080/portal.php',
            }) as Promise<unknown>;
            const outcome = request.then(
                () => 'resolved',
                (error: unknown) => (error as Error).name
            );

            expect(capturedSignal).toBeDefined();
            expect(capturedSignal?.aborted).toBe(false);

            jest.advanceTimersByTime(5_000);

            await expect(outcome).resolves.toBe('AbortError');
            expect(capturedSignal?.aborted).toBe(true);
        } finally {
            jest.useRealTimers();
            delete globalWithFetch.fetch;
        }
    });

    it('sends the server token to the backend only, also with BACKEND_URL=/', async () => {
        writeServerAccessToken('kept-token', 'i');
        TestBed.inject(ServerStorageStatusService).activate(
            {
                service: 'iptvnator',
                apiVersion: 1,
                instanceId: 'i',
                storage: 'server',
                auth: 'token',
            },
            () => undefined
        );
        window.__IPTVNATOR_CONFIG__ = { BACKEND_URL: '/' };
        const atRoot = TestBed.runInInjectionContext(() => new PwaService());
        delete window.__IPTVNATOR_CONFIG__;
        const originalFetch = globalThis.fetch;
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({ reset: true }),
        } as unknown as Response);
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const reset = () =>
            atRoot.sendIpcEvent(CONNECTIVITY_GUARD_RESET, {
                url: 'http://portal.example:8080/portal.php',
            });

        try {
            await reset();
            // Not `//connectivity-guard/reset`: that is another host.
            expect(fetchMock.mock.calls[0][0]).toBe(
                '/connectivity-guard/reset'
            );
            expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
                Authorization: 'Bearer kept-token',
            });

            atRoot.corsProxyUrl = 'https://elsewhere.example';
            await reset();
            expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty(
                'Authorization'
            );
        } finally {
            globalThis.fetch = originalFetch;
            clearServerAccessToken();
        }
    });

    it('reports a backend outage seen by its raw fetches', async () => {
        const status = TestBed.inject(ServerStorageStatusService);
        const activate = () =>
            status.activate(
                {
                    service: 'iptvnator',
                    apiVersion: 1,
                    instanceId: 'i',
                    storage: 'server',
                    auth: 'none',
                },
                () => undefined
            );
        const originalFetch = globalThis.fetch;
        const reset = () =>
            (
                service.sendIpcEvent(CONNECTIVITY_GUARD_RESET, {
                    url: 'http://portal.example:8080/portal.php',
                }) as Promise<unknown>
            ).catch(() => undefined);
        const answer = (code: number, contentType: string) =>
            ({
                ok: false,
                status: code,
                headers: new Headers({ 'content-type': contentType }),
                json: async () => ({}),
            }) as unknown as Response;

        try {
            activate();
            // The backend's own JSON error: it answered.
            globalThis.fetch = jest
                .fn()
                .mockResolvedValue(
                    answer(502, 'application/json')
                ) as unknown as typeof fetch;
            await reset();
            expect(status.state()).toBe('online');

            // A gateway's page in front of a backend that is down.
            globalThis.fetch = jest
                .fn()
                .mockResolvedValue(
                    answer(502, 'text/html')
                ) as unknown as typeof fetch;
            await reset();
            expect(status.state()).toBe('offline');
            expect(status.isVerified()).toBe(false);

            // No answer at all.
            activate();
            globalThis.fetch = jest
                .fn()
                .mockRejectedValue(
                    new TypeError('Failed to fetch')
                ) as unknown as typeof fetch;
            await reset();
            expect(status.state()).toBe('offline');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('asks the backend to forget a host when the connectivity guard is reset', async () => {
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ reset: true }),
        } as unknown as Response);
        const globalWithFetch = globalThis as { fetch?: typeof fetch };
        globalWithFetch.fetch = fetchMock as unknown as typeof fetch;

        try {
            // The breaker lives in the backend process, not the browser, so
            // the reset has to travel over HTTP. Before this it was a no-op,
            // and a PWA user's "retry" never cleared anything.
            await expect(
                service.sendIpcEvent(CONNECTIVITY_GUARD_RESET, {
                    url: 'http://portal.example:8080/portal.php',
                }) as Promise<{ reset: boolean }>
            ).resolves.toEqual({ reset: true });

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, init] = fetchMock.mock.calls[0];
            expect(String(url)).toContain('/connectivity-guard/reset');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({
                url: 'http://portal.example:8080/portal.php',
            });

            // Nothing to reset without a URL, and nothing sent either.
            await expect(
                service.sendIpcEvent(CONNECTIVITY_GUARD_RESET, {}) as Promise<{
                    reset: boolean;
                }>
            ).resolves.toEqual({ reset: false });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        } finally {
            delete globalWithFetch.fetch;
        }
    });
});
