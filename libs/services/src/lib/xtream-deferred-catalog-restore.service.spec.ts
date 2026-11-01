import { XtreamPendingRestoreState } from '@iptvnator/shared/interfaces';
import { XtreamDeferredCatalogRestoreService } from './xtream-deferred-catalog-restore.service';

const empty = (): XtreamPendingRestoreState => ({
    favorites: [],
    hiddenCategories: [],
    recentlyViewed: [],
    playbackPositions: [],
});
const archive = (): XtreamPendingRestoreState => ({
    favoritesRestoreId: 'archive-1',
    favorites: [{ contentType: 'movie', xtreamId: 20 }],
    hiddenCategories: [
        { categoryType: 'movies', xtreamId: 2 },
        { categoryType: 'series', xtreamId: 3 },
    ],
    recentlyViewed: [
        { contentType: 'live', xtreamId: 10, viewedAt: '2026-01-01' },
        { contentType: 'movie', xtreamId: 20, viewedAt: '2026-01-02' },
        { contentType: 'series', xtreamId: 30, viewedAt: '2026-01-03' },
    ],
    playbackPositions: [
        { contentType: 'vod', contentXtreamId: 20, positionSeconds: 9 },
    ],
    sourcePins: [{ matchKey: 'title:movie', contentId: 20 }],
});

describe('dormant catalog restore', () => {
    let service: XtreamDeferredCatalogRestoreService;
    beforeEach(() => {
        localStorage.clear();
        service = new XtreamDeferredCatalogRestoreService();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('does not export native-owned or explicitly removed history and retains hidden choices until applied', () => {
        service.prepare('p', archive(), []);
        const snapshot = service.getSnapshot('p');
        const current = {
            ...empty(),
            recentlyViewed: [
                { contentType: 'live' as const, xtreamId: 11, viewedAt: 'new' },
            ],
        };
        const exported = service.forExport('p', current, undefined, {
            snapshot,
            contentTypes: ['movie'],
            removed: [{ contentType: 'live', xtreamId: 10 }],
        });
        expect(exported.recentlyViewed.map((row) => row.xtreamId)).toEqual([
            30, 11,
        ]);
        expect(exported.hiddenCategories).toEqual(archive().hiddenCategories);
        expect(
            service.forExport('p', empty(), undefined, {
                snapshot,
                contentTypes: [],
                currentCategories: [{ categoryType: 'movies', xtreamId: 2 }],
            }).hiddenCategories
        ).toEqual([{ categoryType: 'series', xtreamId: 3 }]);
        expect(
            service.forExport('p', current, undefined, {
                snapshot,
                contentTypes: [],
                cleared: true,
            }).recentlyViewed
        ).toEqual(current.recentlyViewed);
        expect(
            service
                .forExport('p', empty())
                .recentlyViewed.map((row) => row.xtreamId)
        ).toEqual([10, 20, 30]);
        expect(service.forExport('p', empty()).hiddenCategories).toEqual(
            archive().hiddenCategories
        );
        localStorage.setItem(
            snapshot.key,
            JSON.stringify({
                version: 1,
                ...empty(),
                recentlyViewed: [
                    { contentType: 'movie', xtreamId: 99, viewedAt: 'new' },
                ],
            })
        );
        expect(
            service.forExport('p', empty(), undefined, {
                snapshot,
                contentTypes: ['movie'],
                cleared: true,
            }).recentlyViewed
        ).toEqual([{ contentType: 'movie', xtreamId: 99, viewedAt: 'new' }]);
    });

    it('parks unavailable history/hidden choices durably without replaying global user state later', () => {
        const original = archive();
        const first = service.prepare('p', original, ['live']);
        expect(first.state.recentlyViewed).toEqual([
            original.recentlyViewed[0],
        ]);
        expect(first.state.hiddenCategories).toEqual([]);
        expect(first.state.playbackPositions).toEqual(
            original.playbackPositions
        );
        service.complete('p', first.snapshot, ['live']);
        service = new XtreamDeferredCatalogRestoreService();
        expect(service.forExport('p', empty()).recentlyViewed).toEqual(
            original.recentlyViewed.slice(1)
        );
        expect(service.forExport('p', empty()).hiddenCategories).toEqual(
            original.hiddenCategories
        );
        const current = {
            ...empty(),
            playbackPositions: [
                {
                    contentType: 'vod' as const,
                    contentXtreamId: 20,
                    positionSeconds: 22,
                },
            ],
            sourcePins: [],
        };
        const movie = service.prepare('p', current, ['live', 'movie']);
        expect(movie.state.recentlyViewed).toEqual([
            original.recentlyViewed[1],
        ]);
        expect(movie.state.hiddenCategories).toEqual([
            original.hiddenCategories[0],
        ]);
        expect(movie.state.playbackPositions).toEqual(
            current.playbackPositions
        );
        expect(movie.state.favorites).toEqual([]);
        expect(movie.state.sourcePins).toEqual([]);
        service.complete('p', movie.snapshot, ['live', 'movie']);
        expect(service.forExport('p', empty()).recentlyViewed).toEqual([
            original.recentlyViewed[2],
        ]);
        const series = service.prepare('p', current, [
            'live',
            'movie',
            'series',
        ]);
        expect(series.state.hiddenCategories).toEqual([
            original.hiddenCategories[1],
        ]);
        service.complete('p', series.snapshot, ['live', 'movie', 'series']);
        expect(service.forExport('p', empty())).toEqual({
            hiddenCategories: [],
            recentlyViewed: [],
        });
    });

    it('retains all data for an all-disabled restore and lets current history win on duplicate identities', () => {
        service.prepare('p', archive(), []);
        const edited = {
            ...archive().recentlyViewed[1],
            viewedAt: '2026-02-01',
        };
        expect(
            service.forExport('p', {
                hiddenCategories: [],
                recentlyViewed: [edited],
            }).recentlyViewed
        ).toEqual(expect.arrayContaining([edited]));
        expect(service.forExport('p', empty()).recentlyViewed).toHaveLength(3);
    });

    it('a new explicit archive replaces old deferred ownership and an older completion cannot erase it', () => {
        const old = service.prepare('p', archive(), []);
        expect(
            service.forExport('p', empty(), 'archive-2').recentlyViewed
        ).toEqual([]);
        const fresh = {
            ...empty(),
            favoritesRestoreId: 'archive-2',
            recentlyViewed: [archive().recentlyViewed[2]],
        };
        service.prepare('p', fresh, []);
        service.complete('p', old.snapshot, ['live', 'movie', 'series']);
        expect(service.forExport('p', empty()).recentlyViewed).toEqual(
            fresh.recentlyViewed
        );
        expect(service.forExport('p', empty()).hiddenCategories).toEqual([]);
    });

    it('keeps retained SQLite rows without replaying or parking unrelated dormant identities', () => {
        service.prepare('p', archive(), []);
        const current = {
            ...empty(),
            recentlyViewed: [
                {
                    contentType: 'movie' as const,
                    xtreamId: 21,
                    viewedAt: '2026-02-01',
                },
            ],
        };
        const result = service.prepare('p', current, ['series'], true);
        expect(result.state.recentlyViewed.map((row) => row.xtreamId)).toEqual([
            30, 21,
        ]);
        service.complete('p', result.snapshot, ['series']);
        const later = service.prepare('p', empty(), ['movie'], true);
        expect(later.state.recentlyViewed.map((row) => row.xtreamId)).toEqual([
            20,
        ]);
    });

    it('fails before consumption if durable parking throws or silently fails', () => {
        const write = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('storage full');
            });
        expect(() => service.prepare('p', archive(), ['live'])).toThrow(
            'storage full'
        );
        write.mockImplementation(() => undefined);
        expect(() => service.prepare('p', archive(), ['live'])).toThrow(
            'Could not retain'
        );
    });

    it('does not hide storage-read errors or corrupt records as an empty export', () => {
        localStorage.setItem('xtream-catalog-restore-p', '{bad');
        expect(() => service.forExport('p', empty())).toThrow();
        localStorage.setItem('xtream-catalog-restore-p', '{"version":2}');
        expect(() => service.prepare('p', archive(), [])).toThrow('unreadable');
    });

    it('explicit history clearing and source deletion prevent resurrection while preserving unrelated settings', () => {
        service.prepare('p', archive(), []);
        service.prepare('q', archive(), []);
        localStorage.setItem('other-setting', 'kept');
        service.clearHistory('p');
        expect(service.forExport('p', empty()).recentlyViewed).toEqual([]);
        expect(service.forExport('p', empty()).hiddenCategories).toEqual(
            archive().hiddenCategories
        );
        expect(service.forExport('q', empty()).recentlyViewed).toHaveLength(3);
        service.clearHistory();
        expect(service.forExport('q', empty()).recentlyViewed).toEqual([]);
        service.clear('p');
        service.clearAll();
        expect(service.forExport('q', empty()).hiddenCategories).toEqual([]);
        expect(localStorage.getItem('other-setting')).toBe('kept');
    });
});

it('replaces owned dormant history with the journal, retaining unavailable current entries', () => {
    localStorage.clear();
    const service = new XtreamDeferredCatalogRestoreService();
    service.prepare('p', archive(), []);
    const current = {
        ...empty(),
        recentlyViewed: [
            {
                contentType: 'live' as const,
                xtreamId: 900,
                viewedAt: 'new-live',
            },
            {
                contentType: 'series' as const,
                xtreamId: 901,
                viewedAt: 'new-series',
            },
        ],
    };
    const prepared = service.prepare('p', current, ['live'], false, true);
    expect(prepared.state.recentlyViewed).toEqual(
        current.recentlyViewed.slice(0, 1)
    );
    service.complete('p', prepared.snapshot, ['live']);
    expect(service.forExport('p', empty()).recentlyViewed).toEqual(
        current.recentlyViewed.slice(1)
    );
    localStorage.clear();
});
