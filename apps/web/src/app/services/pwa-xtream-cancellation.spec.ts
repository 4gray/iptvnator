import {
    HttpClientTestingModule,
    HttpTestingController,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Store } from '@ngrx/store';
import { signalStore, withState } from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import {
    PwaXtreamDataSource,
    withContent,
    XTREAM_DATA_SOURCE,
    XtreamApiService,
} from '@iptvnator/portal/xtream/data-access';
import {
    DataService,
    DatabaseService,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SourceActivityService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { ERROR } from '@iptvnator/shared/interfaces';
import { PwaService } from './pwa.service';

const credentials = {
    serverUrl: 'http://synthetic.test',
    username: 'synthetic',
    password: 'synthetic',
};
const ImportStore = signalStore(
    withState({
        playlistId: 'p',
        currentPlaylist: {
            ...credentials,
            id: 'p',
            name: 'Synthetic',
            type: 'xtream',
        },
        portalStatus: 'active' as const,
    }),
    withContent()
);

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PWA Xtream request cancellation', () => {
    let http: HttpTestingController;
    let source: PwaXtreamDataSource;
    let snackBar: { open: jest.Mock };
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        localStorage.clear();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'debug').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(console, 'groupCollapsed').mockImplementation(
            () => undefined
        );
        jest.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
        jest.spyOn(window, 'postMessage').mockImplementation(() => undefined);
        snackBar = { open: jest.fn().mockResolvedValue(null) };
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ reset: true }),
        });
        let operation = 0;
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [
                PwaService,
                PwaXtreamDataSource,
                XtreamApiService,
                ImportStore,
                { provide: DataService, useExisting: PwaService },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useExisting: PwaXtreamDataSource,
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: false },
                },
                {
                    provide: DatabaseService,
                    useValue: {
                        createOperationId: () => `synthetic-${++operation}`,
                        cancelOperation: async () => false,
                    },
                },
                {
                    provide: XtreamPendingRestoreService,
                    useValue: {
                        getSnapshotOrThrow: () => null,
                        getOrThrow: () => null,
                    },
                },
                {
                    provide: ParentalLockService,
                    useValue: { active: () => false },
                },
                { provide: LazySnackBar, useValue: snackBar },
                { provide: Store, useValue: { dispatch: jest.fn() } },
                {
                    provide: SwUpdate,
                    useValue: { versionUpdates: new Subject() },
                },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        http = TestBed.inject(HttpTestingController);
        source = TestBed.inject(PwaXtreamDataSource);
    });

    afterEach(() => {
        http.verify();
        globalThis.fetch = originalFetch;
        localStorage.clear();
        jest.restoreAllMocks();
    });

    it('unsubscribes stalled siblings on category failure, releases busy state and permits retry', async () => {
        const store = TestBed.inject(ImportStore);
        const running = store.initializeContent();
        await settle();
        http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        ).flush({ targetId: 'synthetic' });
        await settle();
        const requests = http.match((request) =>
            request.url.endsWith('/xtream')
        );
        expect(requests).toHaveLength(3);
        requests[0].flush({}, { status: 503, statusText: 'Synthetic failure' });
        await settle();
        const cancelled = requests
            .slice(1)
            .every((request) => request.cancelled);
        const busy = TestBed.inject(SourceActivityService).isBusy('p');
        // Settle the broken implementation too, so a failing assertion leaves no live requests.
        for (const request of requests.slice(1))
            if (!request.cancelled) request.flush({ payload: [] });
        await running;
        expect(cancelled).toBe(true);
        expect(busy).toBe(false);
        expect(store.contentInitBlockReason()).toBe('error');
        expect(store.isImporting()).toBe(false);

        const retry = store.retryContentInitialization();
        for (let step = 0; step < 5; step++) {
            await settle();
            for (const request of http.match((candidate) =>
                candidate.url.endsWith('/xtream')
            ))
                request.flush({ payload: [] });
        }
        await retry;
        expect(store.isContentInitialized()).toBe(true);
        expect(TestBed.inject(SourceActivityService).isBusy('p')).toBe(false);
    });

    it('settles an aborted target-registration wait without starting a late catalog request', async () => {
        const controller = new AbortController();
        let settled = false;
        const outcome = source
            .getCategories('p', credentials, 'live', {
                signal: controller.signal,
            })
            .catch((error: unknown) => {
                settled = true;
                return error;
            });
        await settle();
        const registration = http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        );
        controller.abort();
        await settle();
        const settledBeforeRegistration = settled;
        registration.flush({ targetId: 'synthetic' });
        await settle();
        const late = http.match((request) => request.url.endsWith('/xtream'));
        for (const request of late) request.flush({ payload: [] });
        await expect(outcome).resolves.toMatchObject({ name: 'AbortError' });
        expect(settledBeforeRegistration).toBe(true);
        expect(late).toHaveLength(0);
        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it.each([
        ['get_live_categories', false, false],
        ['get_vod_streams', true, false],
        ['get_vod_streams', false, true],
    ])(
        'preserves malformed-response handling for %s (suppressed=%s)',
        async (action, suppressErrorLog, publish) => {
            const result = TestBed.inject(PwaService).forwardXtreamRequest({
                url: credentials.serverUrl,
                params: { action },
                suppressErrorLog,
                macAddress: 'synthetic-mac',
                userAgent: ' Synthetic agent ',
            });
            await settle();
            http.expectOne((request) =>
                request.url.endsWith('/provider-targets')
            ).flush({ targetId: 'synthetic' });
            await settle();
            const request = http.expectOne((candidate) =>
                candidate.url.endsWith('/xtream')
            );
            expect(request.request.headers.get('Cookie')).toBe(
                'mac=synthetic-mac'
            );
            expect(request.request.params.get('userAgent')).toBe(
                'Synthetic agent'
            );
            request.flush({
                status: 502,
                message: 'Synthetic invalid response',
            });
            await expect(result).resolves.toMatchObject({
                type: ERROR,
                status: 502,
            });
            expect(window.postMessage).toHaveBeenCalledTimes(publish ? 1 : 0);
            expect(snackBar.open).not.toHaveBeenCalled();
        }
    );

    it.each([
        [{ status: 502 }, 'PORTALS.REQUEST_ERRORS.XTREAM_CONNECTION'],
        [
            { message: 'Synthetic provider failure' },
            'Synthetic provider failure',
        ],
        [
            { message: '[object Object]', error: 'Synthetic nested failure' },
            'Synthetic nested failure',
        ],
        [
            {
                message: '[object Object]',
                error: { message: 'Synthetic nested failure' },
            },
            'Synthetic nested failure',
        ],
        [
            { message: '[object Object]', error: { message: 42 } },
            'PORTALS.REQUEST_ERRORS.XTREAM_CONNECTION',
        ],
        [{ statusText: 'Synthetic unavailable' }, 'Synthetic unavailable'],
    ])(
        'retains readable provider error text for %j',
        async (response, message) => {
            const result = TestBed.inject(PwaService).forwardXtreamRequest({
                url: credentials.serverUrl,
                params: { action: 'get_vod_streams' },
            });
            await settle();
            http.expectOne((request) =>
                request.url.endsWith('/provider-targets')
            ).flush({ targetId: 'synthetic' });
            await settle();
            http.expectOne((request) => request.url.endsWith('/xtream')).flush(
                response
            );
            await expect(result).resolves.toMatchObject({
                type: ERROR,
                message,
            });
            expect(window.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: ERROR, message })
            );
        }
    );

    it('shows foreground transport errors and allows a failed registration to be retried', async () => {
        const service = TestBed.inject(PwaService);
        const payload = {
            url: credentials.serverUrl,
            params: { action: 'get_vod_streams' },
        };
        const failed = service.forwardXtreamRequest(payload);
        await settle();
        http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        ).flush({}, { status: 503, statusText: 'Synthetic failure' });
        await expect(failed).resolves.toMatchObject({
            type: ERROR,
            status: 503,
        });
        expect(snackBar.open).toHaveBeenCalledTimes(1);
        const retry = service.forwardXtreamRequest(payload);
        await settle();
        http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        ).flush({ targetId: 'synthetic' });
        await settle();
        http.expectOne((request) => request.url.endsWith('/xtream')).flush({
            payload: [],
        });
        await expect(retry).resolves.toMatchObject({ payload: [] });
    });

    it('recovers a missing backend registration before importing categories', async () => {
        const result = source
            .getCategories('p', credentials, 'live')
            .catch((error: unknown) => error);
        await settle();
        http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        ).flush({ targetId: 'old' });
        await settle();
        http.expectOne((request) => request.url.endsWith('/xtream')).flush(
            { code: 'PROVIDER_TARGET_NOT_FOUND' },
            { status: 404, statusText: 'Not Found' }
        );
        await settle();
        http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        ).flush({ targetId: 'new' });
        await settle();
        const retry = http.expectOne((request) =>
            request.url.endsWith('/xtream')
        );
        expect(retry.request.params.get('targetId')).toBe('new');
        retry.flush({
            payload: [{ category_id: '1', category_name: 'Synthetic' }],
        });
        await expect(result).resolves.toHaveLength(1);
        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('cancels a registration recovery wait without cancelling its independent reader', async () => {
        const controller = new AbortController();
        let settled = false;
        const importing = source
            .getCategories('p', credentials, 'live', {
                signal: controller.signal,
            })
            .catch((error: unknown) => {
                settled = true;
                return error;
            });
        await settle();
        http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        ).flush({ targetId: 'old' });
        await settle();
        http.expectOne((request) => request.url.endsWith('/xtream')).flush(
            { code: 'PROVIDER_TARGET_NOT_FOUND' },
            { status: 404, statusText: 'Not Found' }
        );
        await settle();
        const registration = http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        );
        const independent = source.getCategories('p', credentials, 'vod');
        await settle();
        controller.abort();
        await settle();
        expect(settled).toBe(true);
        registration.flush({ targetId: 'new' });
        await settle();
        const remaining = http.match((request) =>
            request.url.endsWith('/xtream')
        );
        expect(remaining).toHaveLength(1);
        expect(remaining[0].request.params.get('action')).toBe(
            'get_vod_categories'
        );
        remaining[0].flush({ payload: [] });
        await expect(importing).resolves.toMatchObject({ name: 'AbortError' });
        await expect(independent).resolves.toEqual([]);
        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('does not abort an independent request sharing the provider-target registration', async () => {
        const controller = new AbortController();
        const importing = source
            .getCategories('p', credentials, 'live', {
                signal: controller.signal,
            })
            .catch((error: unknown) => error);
        const independent = source.getCategories('p', credentials, 'vod');
        await settle();
        http.expectOne((request) =>
            request.url.endsWith('/provider-targets')
        ).flush({ targetId: 'synthetic' });
        await settle();
        const owned = http.expectOne(
            (request) => request.params.get('action') === 'get_live_categories'
        );
        const reader = http.expectOne(
            (request) => request.params.get('action') === 'get_vod_categories'
        );
        controller.abort();
        await settle();
        const ownedCancelled = owned.cancelled;
        if (!owned.cancelled) owned.flush({ payload: [] });
        reader.flush({
            payload: [{ category_id: '1', category_name: 'Synthetic' }],
        });
        await expect(importing).resolves.toMatchObject({ name: 'AbortError' });
        await expect(independent).resolves.toHaveLength(1);
        expect(ownedCancelled).toBe(true);
    });
});
