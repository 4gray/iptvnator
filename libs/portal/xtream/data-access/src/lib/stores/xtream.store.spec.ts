import { TestBed } from '@angular/core/testing';
import {
    DatabaseService,
    PlaybackPositionRuntimeBridgeService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
    TmdbEnrichmentService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import {
    XTREAM_DATA_SOURCE,
    XtreamPlaylistData,
} from '../data-sources/xtream-data-source.interface';
import { XtreamApiService } from '../services/xtream-api.service';
import { resolveXtreamVodPlaybackSource } from '../services/xtream-vod-playback-source';
import { XtreamUrlService } from '../services/xtream-url.service';
import { XtreamXmltvFallbackService } from '../services/xtream-xmltv-fallback.service';
import { XtreamStore } from './xtream.store';

const PLAYLIST: XtreamPlaylistData = {
    id: 'playlist-b',
    name: 'Portal B',
    serverUrl: 'http://portal-b.example',
    username: 'demo',
    password: 'secret',
    type: 'xtream',
};

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, reject, resolve };
}

async function waitForCondition(
    predicate: () => boolean,
    attempts = 20
): Promise<void> {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) {
            return;
        }
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throw new Error('Timed out waiting for test condition');
}

function configureStore(
    xtreamApiService: {
        getSeriesInfo?: jest.Mock;
        getVodInfo: jest.Mock;
        getVodStream: jest.Mock;
    },
    dataSource = {
        getAllCategories: jest
            .fn()
            .mockResolvedValue([{ id: 7, xtream_id: 701 }]),
        getCategories: jest.fn().mockResolvedValue([]),
    }
) {
    TestBed.configureTestingModule({
        providers: [
            XtreamStore,
            { provide: XTREAM_DATA_SOURCE, useValue: dataSource },
            { provide: XtreamApiService, useValue: xtreamApiService },
            { provide: DatabaseService, useValue: {} },
            { provide: PlaylistsService, useValue: {} },
            {
                provide: PlaybackPositionRuntimeBridgeService,
                useValue: {
                    onPlaybackPositionUpdate: jest.fn(() => jest.fn()),
                },
            },
            {
                provide: RuntimeCapabilitiesService,
                useValue: { supportsEpg: false },
            },
            {
                provide: SettingsStore,
                useValue: {
                    preferUploadedEpgOverXtream: jest.fn(() => false),
                },
            },
            {
                provide: TmdbEnrichmentService,
                useValue: { isEnabled: jest.fn(() => false) },
            },
            { provide: XtreamPendingRestoreService, useValue: {} },
            { provide: XtreamUrlService, useValue: {} },
            { provide: XtreamXmltvFallbackService, useValue: {} },
            { provide: PORTAL_PLAYER, useValue: {} },
        ],
    });

    const store = TestBed.inject(XtreamStore);
    store.setCurrentPlaylist(PLAYLIST);
    return store;
}

describe('XtreamStore VOD details recovery', () => {
    afterEach(() => TestBed.resetTestingModule());

    it('publishes sparse details before upgrading them from the catalog', async () => {
        const catalogItem = createDeferred<XtreamVodStream | null>();
        const xtreamApiService = {
            getVodInfo: jest.fn().mockResolvedValue({ info: [] }),
            getVodStream: jest.fn(() => catalogItem.promise),
        };
        const store = configureStore(xtreamApiService);
        store.fetchVodDetailsWithMetadata({
            categoryId: 7,
            vodId: '42',
        });

        await waitForCondition(
            () => xtreamApiService.getVodStream.mock.calls.length === 1
        );

        expect(store.selectedItem()).toEqual(
            expect.objectContaining({
                info: [],
                stream_id: 42,
                container_extension: null,
            })
        );
        expect(resolveXtreamVodPlaybackSource(store.selectedItem())).toBeNull();
        expect(store.isLoadingDetails()).toBe(false);

        const publishedSelection = store.selectedItem();
        if (!publishedSelection) {
            throw new Error('Expected the sparse selection to be published');
        }
        store.setSelectedItem({
            ...publishedSelection,
            info: { name: 'Enriched while recovery was pending' },
        });
        catalogItem.resolve({
            stream_id: 42,
            container_extension: 'mkv',
        } as XtreamVodStream);
        await waitForCondition(
            () =>
                resolveXtreamVodPlaybackSource(store.selectedItem())
                    ?.containerExtension === 'mkv'
        );

        expect(resolveXtreamVodPlaybackSource(store.selectedItem())).toEqual({
            streamId: 42,
            containerExtension: 'mkv',
        });
        expect(store.selectedItem()?.info).toEqual({
            name: 'Enriched while recovery was pending',
        });
    });

    it('drops a catalog upgrade after a newer detail request starts', async () => {
        const firstCatalogItem = createDeferred<XtreamVodStream | null>();
        const xtreamApiService = {
            getVodInfo: jest.fn((_credentials: unknown, vodId: string) =>
                Promise.resolve(
                    vodId === '42'
                        ? { info: [] }
                        : {
                              info: [],
                              stream_id: 99,
                              container_extension: 'mp4',
                          }
                )
            ),
            getVodStream: jest.fn(() => firstCatalogItem.promise),
        };
        const store = configureStore(xtreamApiService);

        store.fetchVodDetailsWithMetadata({
            categoryId: 7,
            vodId: '42',
        });
        await waitForCondition(
            () => xtreamApiService.getVodStream.mock.calls.length === 1
        );

        store.fetchVodDetailsWithMetadata({
            categoryId: 7,
            vodId: '99',
        });
        await waitForCondition(
            () =>
                resolveXtreamVodPlaybackSource(store.selectedItem())
                    ?.streamId === 99
        );

        firstCatalogItem.resolve({
            stream_id: 42,
            container_extension: 'mkv',
        } as XtreamVodStream);
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(resolveXtreamVodPlaybackSource(store.selectedItem())).toEqual({
            streamId: 99,
            containerExtension: 'mp4',
        });
    });

    it('keeps the fallback usable as a page when catalog recovery fails', async () => {
        const catalogItem = createDeferred<XtreamVodStream | null>();
        const xtreamApiService = {
            getVodInfo: jest.fn().mockResolvedValue({ info: [] }),
            getVodStream: jest.fn(() => catalogItem.promise),
        };
        const store = configureStore(xtreamApiService);

        store.fetchVodDetailsWithMetadata({
            categoryId: 7,
            vodId: '42',
        });
        await waitForCondition(
            () => xtreamApiService.getVodStream.mock.calls.length === 1
        );
        catalogItem.reject(new Error('Catalog unavailable'));
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(store.selectedItem()).toEqual(
            expect.objectContaining({
                info: [],
                stream_id: 42,
                container_extension: null,
            })
        );
        expect(store.detailsError()).toBeNull();
        expect(store.isLoadingDetails()).toBe(false);
    });

    it('clears the previous movie while a reused-route request is pending or fails', async () => {
        const nextDetails = createDeferred<never>();
        const xtreamApiService = {
            getVodInfo: jest.fn(() => nextDetails.promise),
            getVodStream: jest.fn(),
        };
        const store = configureStore(xtreamApiService);
        store.setSelectedItem({
            info: { name: 'Movie A' },
            stream_id: 42,
            xtream_id: 42,
        });

        store.fetchVodDetailsWithMetadata({
            categoryId: 7,
            vodId: '99',
        });

        expect(store.selectedItem()).toBeNull();

        nextDetails.reject(new Error('Movie B unavailable'));
        await waitForCondition(
            () => store.detailsError() === 'Movie B unavailable'
        );

        expect(store.selectedItem()).toBeNull();
        expect(store.isLoadingDetails()).toBe(false);
    });

    it('keeps the newer movie authoritative when an older base request resolves late', async () => {
        const firstDetails = createDeferred<{
            container_extension: string;
            info: { name: string };
            stream_id: number;
        }>();
        const xtreamApiService = {
            getVodInfo: jest.fn((_credentials: unknown, vodId: string) =>
                vodId === '42'
                    ? firstDetails.promise
                    : Promise.resolve({
                          info: { name: 'Movie B' },
                          stream_id: 99,
                          container_extension: 'mp4',
                      })
            ),
            getVodStream: jest.fn(),
        };
        const store = configureStore(xtreamApiService);

        store.fetchVodDetailsWithMetadata({
            categoryId: 7,
            vodId: '42',
        });
        store.fetchVodDetailsWithMetadata({
            categoryId: 7,
            vodId: '99',
        });
        await waitForCondition(
            () =>
                resolveXtreamVodPlaybackSource(store.selectedItem())
                    ?.streamId === 99
        );

        firstDetails.resolve({
            info: { name: 'Movie A' },
            stream_id: 42,
            container_extension: 'mkv',
        });
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(resolveXtreamVodPlaybackSource(store.selectedItem())).toEqual({
            streamId: 99,
            containerExtension: 'mp4',
        });
        expect(store.detailsError()).toBeNull();
        expect(store.isLoadingDetails()).toBe(false);
    });

    it('clears the previous series while a reused-route request is pending or fails', async () => {
        const nextDetails = createDeferred<never>();
        const xtreamApiService = {
            getSeriesInfo: jest.fn(() => nextDetails.promise),
            getVodInfo: jest.fn(),
            getVodStream: jest.fn(),
        };
        const store = configureStore(xtreamApiService);
        store.setSelectedItem({
            info: { name: 'Series A' },
            series_id: 42,
        });

        store.fetchSerialDetailsWithMetadata({
            categoryId: 7,
            serialId: '99',
        });

        expect(store.selectedItem()).toBeNull();

        nextDetails.reject(new Error('Series B unavailable'));
        await waitForCondition(
            () => store.detailsError() === 'Series B unavailable'
        );

        expect(store.selectedItem()).toBeNull();
        expect(store.isLoadingDetails()).toBe(false);
    });
});
