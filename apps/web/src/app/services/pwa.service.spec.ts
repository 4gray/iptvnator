import {
    HttpClientTestingModule,
    HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY } from 'rxjs';
import {
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_UPDATE,
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
            expect(requestUrl.searchParams.get('serialNumber')).toBe(
                'SN1234'
            );
            expect(requestUrl.searchParams.get('action')).toBe(
                'get_ordered_list'
            );
        } finally {
            delete globalWithFetch.fetch;
        }
    });
});
