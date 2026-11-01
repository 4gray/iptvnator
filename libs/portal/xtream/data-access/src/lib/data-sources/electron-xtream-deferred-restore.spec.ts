import { TestBed } from '@angular/core/testing';
import { XtreamDeferredCatalogRestoreService } from '@iptvnator/services/xtream-catalog-restore';
import { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';
import { setupElectronXtreamDataSource } from './electron-xtream-data-source.test-helpers';

const archive: XtreamPendingRestoreState = {
    favorites: [],
    favoritesRestoreId: 'archive',
    hiddenCategories: [{ categoryType: 'movies', xtreamId: 2 }],
    recentlyViewed: [
        { contentType: 'live', xtreamId: 10, viewedAt: '2026-01-01' },
        { contentType: 'movie', xtreamId: 20, viewedAt: '2026-01-02' },
    ],
    playbackPositions: [
        { contentType: 'vod', contentXtreamId: 20, positionSeconds: 9 },
    ],
};

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it('keeps current playback positions when retrying cache-only recovery', async () => {
    const { dataSource, playbackService, dbService } =
        setupElectronXtreamDataSource();
    dbService.getAllXtreamCategories.mockImplementation(async (_id, type) =>
        type === 'live'
            ? [{ id: 1, type: 'live', xtream_id: 1, hidden: true }]
            : []
    );
    await dataSource.restoreUserData('p', {
        ...archive,
        preservePlaybackPositions: true,
    });
    expect(playbackService.replaceAllPlaybackPositions).not.toHaveBeenCalled();
    expect(dbService.updateCategoryVisibility).not.toHaveBeenCalled();
});

it('uses the live native journal instead of stale pending or already-owned deferred history', async () => {
    const { dataSource, dbService } = setupElectronXtreamDataSource();
    const deferred = TestBed.inject(XtreamDeferredCatalogRestoreService);
    deferred.prepare('p', archive, []);
    const snapshot = deferred.getSnapshot('p');
    const current = [{ contentType: 'live', xtreamId: 11, viewedAt: 'new' }];
    dbService.readAppState.mockResolvedValue({
        value: JSON.stringify({
            version: 1,
            contentTypes: ['live', 'movie', 'series'],
            recentlyViewed: current,
            removed: [
                { contentType: 'live', xtreamId: 10 },
                { contentType: 'movie', xtreamId: 20 },
            ],
        }),
    });
    await dataSource.restoreUserData('p', {
        ...archive,
        preservePlaybackPositions: true,
        catalogSnapshot: { key: snapshot.key, generation: snapshot.generation },
    });
    expect(dbService.restoreXtreamUserData).toHaveBeenCalledWith(
        'p',
        [],
        current,
        undefined
    );
    expect(
        deferred.forExport('p', { hiddenCategories: [], recentlyViewed: [] })
            .recentlyViewed
    ).toEqual([]);
    expect(dbService.setAppState).toHaveBeenLastCalledWith(
        'xtream-history-recovery:p',
        ''
    );
});

it('leaves a newer dormant record untouched when it arrives during native recovery', async () => {
    const { dataSource, dbService } = setupElectronXtreamDataSource();
    const deferred = TestBed.inject(XtreamDeferredCatalogRestoreService);
    deferred.prepare('p', archive, []);
    const original = deferred.getSnapshot('p');
    dbService.readAppState.mockResolvedValue({
        value: JSON.stringify({
            version: 1,
            contentTypes: ['movie'],
            recentlyViewed: [],
        }),
    });
    dbService.setAppState.mockImplementation(async (_key, value) => {
        if (value)
            localStorage.setItem(
                original.key,
                JSON.stringify({
                    version: 1,
                    favorites: [],
                    playbackPositions: [],
                    hiddenCategories: [],
                    recentlyViewed: [
                        {
                            contentType: 'movie',
                            xtreamId: 99002,
                            viewedAt: 'new',
                        },
                    ],
                })
            );
        return true;
    });
    await dataSource.restoreUserData('p', {
        ...archive,
        preservePlaybackPositions: true,
        catalogSnapshot: { key: original.key, generation: original.generation },
    });
    expect(
        deferred.forExport('p', { hiddenCategories: [], recentlyViewed: [] })
            .recentlyViewed
    ).toEqual([{ contentType: 'movie', xtreamId: 99002, viewedAt: 'new' }]);
});

it('keeps an all-disabled restore dormant without dropping history or positions', async () => {
    const { dataSource, dbService, playbackService } =
        setupElectronXtreamDataSource();
    dbService.getPlaylistById.mockResolvedValue({
        id: 'p',
        xtreamContentTypes: [],
    });
    await dataSource.restoreUserData('p', archive);
    expect(dbService.restoreXtreamUserData).toHaveBeenCalledWith(
        'p',
        [],
        [],
        undefined
    );
    expect(
        TestBed.inject(XtreamDeferredCatalogRestoreService).forExport('p', {
            hiddenCategories: [],
            recentlyViewed: [],
        }).recentlyViewed
    ).toEqual(archive.recentlyViewed);
    expect(playbackService.replaceAllPlaybackPositions).toHaveBeenCalledWith(
        'p',
        archive.playbackPositions
    );
});

it.each([false, true])(
    'defers only unavailable disabled catalogs; retained cache=%s',
    async (cached) => {
        const { dataSource, dbService, playbackService } =
            setupElectronXtreamDataSource();
        dbService.getPlaylistById.mockResolvedValue({
            id: 'p',
            xtreamContentTypes: ['live'],
        });
        dbService.getXtreamImportStatus.mockResolvedValue(
            cached ? 'completed' : 'idle'
        );
        dbService.hasXtreamContent.mockImplementation(
            async (_id, type) => type === 'movie' && cached
        );
        await dataSource.restoreUserData('p', archive);
        expect(dbService.restoreXtreamUserData).toHaveBeenLastCalledWith(
            'p',
            [],
            cached
                ? archive.recentlyViewed
                : archive.recentlyViewed.slice(0, 1),
            undefined
        );
        const deferred = TestBed.inject(XtreamDeferredCatalogRestoreService);
        expect(
            deferred.forExport('p', {
                hiddenCategories: [],
                recentlyViewed: [],
            }).recentlyViewed
        ).toEqual(cached ? [] : archive.recentlyViewed.slice(1));
        expect(
            playbackService.replaceAllPlaybackPositions
        ).toHaveBeenLastCalledWith('p', archive.playbackPositions);

        if (!cached) {
            dbService.getPlaylistById.mockResolvedValue({
                id: 'p',
                xtreamContentTypes: ['live', 'movie'],
            });
            dbService.getAllXtreamCategories.mockImplementation(
                async (_id, type) =>
                    type === 'movies'
                        ? [{ id: 2, type: 'movies', xtream_id: 2 }]
                        : []
            );
            const current = {
                ...archive,
                favoritesRestoreId: undefined,
                recentlyViewed: archive.recentlyViewed.slice(0, 1),
                hiddenCategories: [],
                playbackPositions: [
                    {
                        contentType: 'vod' as const,
                        contentXtreamId: 20,
                        positionSeconds: 22,
                    },
                ],
            };
            await dataSource.restoreUserData('p', current);
            expect(dbService.restoreXtreamUserData).toHaveBeenLastCalledWith(
                'p',
                [],
                expect.arrayContaining(archive.recentlyViewed),
                undefined
            );
            expect(dbService.updateCategoryVisibility).toHaveBeenLastCalledWith(
                [2],
                true
            );
            expect(
                playbackService.replaceAllPlaybackPositions
            ).toHaveBeenLastCalledWith('p', current.playbackPositions);
            expect(
                deferred.forExport('p', {
                    hiddenCategories: [],
                    recentlyViewed: [],
                }).recentlyViewed
            ).toEqual([]);
        }
    }
);
