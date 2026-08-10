import {
    HttpClientTestingModule,
    HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { config as rxjsConfig, EMPTY } from 'rxjs';
import {
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_UPDATE,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import { PwaService } from './pwa.service';

describe('PwaService', () => {
    let http: HttpTestingController;
    let service: PwaService;

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);

        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [
                PwaService,
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
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
                        versionUpdates: EMPTY,
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

            expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
                'HOME.URL_UPLOAD.ERROR_FETCH_FAILED (ETIMEDOUT)',
                'Close',
                { duration: 5000 }
            );
        } finally {
            rxjsConfig.onUnhandledError = previousHandler;
        }
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

            expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
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
        expect(TestBed.inject(MatSnackBar).open).not.toHaveBeenCalled();

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
});
