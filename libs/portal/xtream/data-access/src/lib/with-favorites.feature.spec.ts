import {
    RuntimeCapabilitiesService,
    TmdbMatchService,
    type TmdbEnrichmentService,
} from '@iptvnator/services';
import {
    enrichSerialSelectionWithTmdb,
    enrichVodSelectionWithTmdb,
} from './stores/xtream-tmdb-enrichment';
import {
    xtreamDetailContentMetadata,
    preserveXtreamProviderIdentity,
    type XtreamDetailMetadataSource,
} from './xtream-content-metadata.util';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { TestBed } from '@angular/core/testing';
import { patchState, signalStore } from '@ngrx/signals';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';
import { withFavorites } from './with-favorites.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const TestFavoritesStore = signalStore(
    { protectedState: false },
    withFavorites()
);

describe('withFavorites', () => {
    const originalElectron = window.electron;
    const snackBar = { open: jest.fn().mockResolvedValue(null) };
    const translate = { instant: jest.fn((key: string) => key) };
    const runtime = { supportsXtreamSqliteDataSource: false };
    let store: InstanceType<typeof TestFavoritesStore>;
    let dataSource: {
        addFavorite: jest.Mock;
        getContentByXtreamId: jest.Mock;
        isFavorite: jest.Mock;
        removeFavorite: jest.Mock;
    };

    beforeEach(() => {
        snackBar.open.mockClear();
        runtime.supportsXtreamSqliteDataSource = false;
        dataSource = {
            addFavorite: jest.fn().mockResolvedValue(undefined),
            getContentByXtreamId: jest.fn(),
            isFavorite: jest.fn().mockResolvedValue(false),
            removeFavorite: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                TestFavoritesStore,
                { provide: LazySnackBar, useValue: snackBar },
                { provide: TranslateService, useValue: translate },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
            ],
        });

        store = TestBed.inject(TestFavoritesStore);
    });

    afterEach(() => {
        localStorage.clear();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
    });

    it.each(['movie', 'series'] as const)(
        'keeps an existing SQLite %s favorite usable after an explicit TMDB correction',
        async (type) => {
            runtime.supportsXtreamSqliteDataSource = true;
            const matches = new TmdbMatchService();
            const identity = {
                provider: 'xtream' as const,
                playlistId: 'synthetic-source',
                mediaType:
                    type === 'movie' ? ('movie' as const) : ('tv' as const),
                itemId: '42',
            };
            let selected: Record<string, unknown> = {
                stream_id: '42',
                series_id: '42',
                info: {
                    name: 'Synthetic Provider Alpha',
                    releasedate: '2024-02-03',
                    releaseDate: '2024-02-03',
                },
            };
            const selectionStore = {
                selectedItem: () => selected,
                setSelectedItem: (value: Record<string, unknown> | null) => {
                    selected = value ?? {};
                },
                currentPlaylist: () => ({ id: 'synthetic-source' }),
            };
            const enrich = jest.fn(async () => ({
                id: matches.read(identity)?.mode === 'manual' ? 900202 : 900101,
                overview: 'Synthetic description',
            }));
            const enrichment = {
                isEnabled: () => true,
                matches,
                enrichMovie: enrich,
                enrichTv: enrich,
            } as unknown as TmdbEnrichmentService;
            const run = () =>
                type === 'movie'
                    ? enrichVodSelectionWithTmdb(
                          selectionStore,
                          enrichment,
                          '42'
                      )
                    : enrichSerialSelectionWithTmdb(
                          selectionStore,
                          enrichment,
                          '42'
                      );
            // The original automatic ID was already backfilled into the content row.
            dataSource.getContentByXtreamId.mockImplementation(
                async (_id, _playlist, _type, expected) =>
                    expected?.tmdbId !== undefined && expected.tmdbId !== 900101
                        ? null
                        : { id: 7, tmdb_id: 900101 }
            );
            dataSource.isFavorite.mockResolvedValue(true);
            await run();
            await matches.save(identity, {
                mode: 'manual',
                tmdbId: 900202,
                title: 'Synthetic Selected Alpha',
            });
            expect((selected['info'] as { tmdb_id: number }).tmdb_id).toBe(
                900202
            );
            const metadata =
                xtreamDetailContentMetadata(
                    selected['info'] as XtreamDetailMetadataSource
                ) ?? undefined;
            await store.checkFavoriteStatus(
                42,
                'synthetic-source',
                type,
                metadata
            );
            expect(store.isFavorite()).toBe(true);
            expect(
                await store.toggleFavorite(
                    42,
                    'synthetic-source',
                    type,
                    undefined,
                    metadata
                )
            ).toBe(false);
            expect(dataSource.removeFavorite).toHaveBeenCalledWith(
                { id: 7, type },
                'synthetic-source'
            );
            expect(dataSource.addFavorite).not.toHaveBeenCalled();
        }
    );

    it('still rejects a reused provider ID when manual display metadata hides the contrary provider claim', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        const corrected = preserveXtreamProviderIdentity(
            { tmdb_id: 900303 },
            { tmdb_id: 900202 },
            true
        );
        const identity = xtreamDetailContentMetadata(corrected) ?? undefined;
        dataSource.getContentByXtreamId.mockImplementation(
            async (_id, _playlist, _type, expected) =>
                expected?.tmdbId !== undefined && expected.tmdbId !== 900101
                    ? null
                    : { id: 7 }
        );
        dataSource.isFavorite.mockResolvedValue(true);
        await store.checkFavoriteStatus(
            42,
            'synthetic-source',
            'movie',
            identity
        );
        expect(store.isFavorite()).toBe(false);
        expect(
            await store.toggleFavorite(
                42,
                'synthetic-source',
                'movie',
                undefined,
                identity
            )
        ).toBe(false);
        expect(dataSource.removeFavorite).not.toHaveBeenCalled();
        expect(dataSource.addFavorite).not.toHaveBeenCalled();
    });

    it('reports a conflict without mutating when every SQLite duplicate contradicts the detail identity', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        dataSource.getContentByXtreamId.mockImplementation(
            async (_id, _playlist, _type, identity) =>
                identity ? null : { id: 1 }
        );
        await store.toggleFavorite(42, 'p1', 'movie', undefined, {
            tmdbId: 100,
        });
        expect(snackBar.open).toHaveBeenCalledWith(
            'PORTALS.FAVORITE_IDENTITY_CONFLICT',
            undefined,
            { duration: 6000 }
        );
        expect(dataSource.addFavorite).not.toHaveBeenCalled();
        expect(dataSource.removeFavorite).not.toHaveBeenCalled();
    });

    it('does not publish a late toggle into a different displayed duplicate identity', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        let resolveOld!: (value: { id: number }) => void;
        const old = new Promise<{ id: number }>((resolve) => {
            resolveOld = resolve;
        });
        dataSource.getContentByXtreamId.mockImplementation(
            (_id, _playlist, _type, identity) =>
                identity?.tmdbId === 100 ? old : Promise.resolve({ id: 2 })
        );
        const toggling = store.toggleFavorite(42, 'p1', 'movie', undefined, {
            tmdbId: 100,
        });
        await store.checkFavoriteStatus(42, 'p1', 'movie', { tmdbId: 200 });
        resolveOld({ id: 1 });
        await toggling;
        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            { id: 1, type: 'movie' },
            'p1',
            undefined
        );
        expect(store.isFavorite()).toBe(false);
    });

    it('resolves the displayed SQLite identity for status and toggle across conflicting duplicates', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        dataSource.getContentByXtreamId.mockImplementation(
            async (_id, _playlist, _type, identity) => ({
                id: identity?.tmdbId === 100 ? 2 : 1,
            })
        );
        dataSource.isFavorite.mockImplementation(async (ref) => ref.id === 2);
        await store.checkFavoriteStatus(42, 'p1', 'movie', {
            tmdbId: 100,
            releaseYear: 1995,
        });
        expect(store.isFavorite()).toBe(true);
        await store.toggleFavorite(42, 'p1', 'movie', undefined, {
            tmdbId: 100,
            releaseYear: 1995,
        });
        expect(dataSource.removeFavorite).toHaveBeenCalledWith(
            { id: 2, type: 'movie' },
            'p1'
        );
    });

    it('uses displayed detail identity for cold PWA status and toggle', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        dataSource.isFavorite.mockImplementation(
            async (ref) => ref.identity?.tmdbId !== 200
        );
        const identity = { tmdbId: 200, releaseYear: 2026 };
        await store.checkFavoriteStatus(42, 'playlist-1', 'movie', identity);
        expect(store.isFavorite()).toBe(false);
        await store.toggleFavorite(
            42,
            'playlist-1',
            'movie',
            undefined,
            identity
        );
        expect(dataSource.removeFavorite).not.toHaveBeenCalled();
        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            { id: 42, type: 'movie', identity },
            'playlist-1',
            undefined
        );
    });

    it('does not let an earlier catalog-only check overwrite a newer detail check', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        let resolveOld!: (value: boolean) => void;
        dataSource.isFavorite
            .mockReturnValueOnce(
                new Promise<boolean>((resolve) => {
                    resolveOld = resolve;
                })
            )
            .mockResolvedValueOnce(false);
        const old = store.checkFavoriteStatus(42, 'playlist-1', 'movie');
        await Promise.resolve();
        await store.checkFavoriteStatus(42, 'playlist-1', 'movie', {
            tmdbId: 200,
        });
        resolveOld(true);
        await old;
        expect(store.isFavorite()).toBe(false);
    });

    it.each([
        [
            'XTREAM_FAVORITE_IDENTITY_CONFLICT',
            'PORTALS.FAVORITE_IDENTITY_CONFLICT',
        ],
        ['write failed', 'PORTALS.FAVORITE_SAVE_FAILED'],
    ])(
        'keeps the heart inactive and explains rejected saves: %s',
        async (message, key) => {
            dataSource.getContentByXtreamId.mockResolvedValue({ id: 42 });
            dataSource.addFavorite.mockRejectedValue(new Error(message));
            await expect(
                store.toggleFavorite(7, 'playlist-1', 'movie')
            ).resolves.toBe(false);
            expect(store.isFavorite()).toBe(false);
            expect(snackBar.open).toHaveBeenCalledWith(key, undefined, {
                duration: 6000,
            });
        }
    );

    it.each([false, true])(
        'toggles the typed target using its persisted status %s rather than the previous detail state',
        async (persistedStatus) => {
            patchState(store, { isFavorite: !persistedStatus });
            dataSource.getContentByXtreamId.mockResolvedValue({
                id: 42,
                xtream_id: 42,
                type: 'live',
            });
            dataSource.isFavorite.mockResolvedValue(persistedStatus);
            expect(await store.toggleFavorite(42, 'playlist-1', 'live')).toBe(
                !persistedStatus
            );
            expect(dataSource.isFavorite).toHaveBeenCalledWith(
                { id: 42, type: 'live' },
                'playlist-1'
            );
            expect(
                persistedStatus
                    ? dataSource.removeFavorite
                    : dataSource.addFavorite
            ).toHaveBeenCalled();
        }
    );

    it('looks favorites up with the requested content type before adding one', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        const result = await store.toggleFavorite(290, 'playlist-1', 'series');

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            { id: 3941697, type: 'series' },
            'playlist-1',
            undefined
        );
        expect(result).toBe(true);
        expect(store.isFavorite()).toBe(true);
    });

    it('uses the Xtream ID as the PWA favorite key when cached content is cold', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        const result = await store.toggleFavorite(
            1767451,
            'playlist-1',
            'movie'
        );

        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            { id: 1767451, type: 'movie' },
            'playlist-1',
            undefined
        );
        expect(result).toBe(true);
        expect(store.isFavorite()).toBe(true);
    });

    it('normalizes route-param Xtream IDs before using the PWA favorite fallback', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        const result = await store.toggleFavorite(
            '1767451',
            'playlist-1',
            'movie'
        );

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            'movie'
        );
        expect(dataSource.addFavorite).toHaveBeenCalledWith(
            { id: 1767451, type: 'movie' },
            'playlist-1',
            undefined
        );
        expect(result).toBe(true);
    });

    it('looks favorites up with the requested content type before removing one', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3867578,
            title: 'SE: V Film Premiere FHD',
            type: 'live',
            xtream_id: 290,
        });
        patchState(store, { isFavorite: true });
        dataSource.isFavorite.mockResolvedValue(true);

        const result = await store.toggleFavorite(290, 'playlist-1', 'live');

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'live'
        );
        expect(dataSource.removeFavorite).toHaveBeenCalledWith(
            { id: 3867578, type: 'live' },
            'playlist-1'
        );
        expect(result).toBe(false);
        expect(store.isFavorite()).toBe(false);
    });

    it('checks favorite state against the matching content type', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3829429,
            title: 'Dragon Ball Heroes',
            type: 'series',
            xtream_id: 31,
        });
        dataSource.isFavorite.mockResolvedValue(true);

        await store.checkFavoriteStatus(31, 'playlist-1', 'series');

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            31,
            'playlist-1',
            'series'
        );
        expect(dataSource.isFavorite).toHaveBeenCalledWith(
            { id: 3829429, type: 'series' },
            'playlist-1'
        );
        expect(store.isFavorite()).toBe(true);
    });

    it('checks PWA favorite state against the Xtream ID when cached content is cold', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        dataSource.isFavorite.mockResolvedValue(true);

        await store.checkFavoriteStatus(1767451, 'playlist-1', 'movie');

        expect(dataSource.isFavorite).toHaveBeenCalledWith(
            { id: 1767451, type: 'movie' },
            'playlist-1'
        );
        expect(store.isFavorite()).toBe(true);
    });

    it('rejects toggles with invalid Xtream IDs or missing playlist IDs', async () => {
        await expect(
            store.toggleFavorite('not-a-number', 'playlist-1', 'movie')
        ).resolves.toBe(false);
        await expect(
            store.toggleFavorite(0, 'playlist-1', 'movie')
        ).resolves.toBe(false);
        await expect(store.toggleFavorite(290, '', 'movie')).resolves.toBe(
            false
        );

        expect(dataSource.getContentByXtreamId).not.toHaveBeenCalled();
        expect(dataSource.addFavorite).not.toHaveBeenCalled();
    });

    it('does not toggle Electron favorites when the cached content is missing', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: {} as Window['electron'],
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        const result = await store.toggleFavorite(290, 'playlist-1', 'series');

        expect(result).toBe(false);
        expect(dataSource.addFavorite).not.toHaveBeenCalled();
        expect(dataSource.removeFavorite).not.toHaveBeenCalled();
        expect(store.isFavorite()).toBe(false);
    });

    it('resets favorite state when checking with invalid inputs', async () => {
        patchState(store, { isFavorite: true });

        await store.checkFavoriteStatus('not-a-number', 'playlist-1', 'movie');

        expect(dataSource.getContentByXtreamId).not.toHaveBeenCalled();
        expect(dataSource.isFavorite).not.toHaveBeenCalled();
        expect(store.isFavorite()).toBe(false);
    });

    it('resets Electron favorite state when the cached content is missing', async () => {
        runtime.supportsXtreamSqliteDataSource = true;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: {} as Window['electron'],
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);
        patchState(store, { isFavorite: true });

        await store.checkFavoriteStatus(290, 'playlist-1', 'series');

        expect(dataSource.isFavorite).not.toHaveBeenCalled();
        expect(store.isFavorite()).toBe(false);
    });
});
