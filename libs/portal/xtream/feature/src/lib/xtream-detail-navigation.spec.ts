import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { WorkspaceBackNavigationService } from '@iptvnator/portal/shared/data-access';
import {
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    CrossPortalSimilarService,
    RuntimeCapabilitiesService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import {
    injectXtreamDetailNavigation,
    type XtreamDetailNavigation,
} from './xtream-detail-navigation';

describe('injectXtreamDetailNavigation', () => {
    const route = {
        snapshot: { params: {} as Record<string, string>, queryParams: {} },
    };
    const navigate = jest.fn();
    const back = jest.fn();
    const getContentByXtreamId = jest.fn();
    const runtime = { supportsXtreamSqliteDataSource: false };
    const buildLink = jest.fn();
    const currentPlaylist = signal<{ id: string } | null>(null);
    const enrichmentEnabled = signal(true);

    function create(mediaType: 'movie' | 'tv'): XtreamDetailNavigation {
        return TestBed.runInInjectionContext(() =>
            injectXtreamDetailNavigation(mediaType)
        );
    }

    beforeEach(() => {
        navigate.mockReset();
        back.mockReset();
        getContentByXtreamId.mockReset().mockResolvedValue(null);
        runtime.supportsXtreamSqliteDataSource = false;
        buildLink.mockReset();
        route.snapshot.params = {};
        route.snapshot.queryParams = {};
        currentPlaylist.set({ id: 'xtream-1' });
        enrichmentEnabled.set(true);
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                { provide: WorkspaceBackNavigationService, useValue: { back } },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: { getContentByXtreamId },
                },
                { provide: RuntimeCapabilitiesService, useValue: runtime },
                { provide: ActivatedRoute, useValue: route },
                { provide: XtreamStore, useValue: { currentPlaylist } },
                { provide: CrossPortalSimilarService, useValue: { buildLink } },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled: () => enrichmentEnabled() },
                },
            ],
        });
        jest.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(
            navigate
        );
    });

    it.each([
        ['movie', 'vod'],
        ['tv', 'series'],
    ] as const)(
        'resolves the %s Back parent from the route, including its query',
        async (type, section) => {
            route.snapshot.params = { id: 'route-source', categoryId: '201' };
            route.snapshot.queryParams = { q: 'Synthetic title' };

            create(type).back();

            expect(back).toHaveBeenCalledTimes(1);
            expect(await back.mock.calls[0][0]()).toBe(
                `/workspace/xtreams/route-source/${section}/201?q=Synthetic%20title`
            );
        }
    );

    it('uses the catalog root when no category is present', async () => {
        route.snapshot.params = { id: 'route-source' };

        create('movie').back();

        expect(await back.mock.calls[0][0]()).toBe(
            '/workspace/xtreams/route-source/vod'
        );
    });

    it('leaves collection details without a portal route to history Back', async () => {
        route.snapshot.params = { categoryId: '201', vodId: '20001' };

        create('movie').back();

        expect(await back.mock.calls[0][0]()).toBeNull();
    });

    it.each([
        ['movie', 'vod', 'vodId', 'movie'],
        ['tv', 'series', 'serialId', 'series'],
    ] as const)(
        'resolves the owning %s row rather than trusting a colliding category ID',
        async (type, section, key, contentType) => {
            runtime.supportsXtreamSqliteDataSource = true;
            route.snapshot.params = {
                id: 'route-source',
                categoryId: '201',
                [key]: '20001',
            };
            getContentByXtreamId.mockImplementation((...args) =>
                Promise.resolve(
                    args[4] === undefined ? { category_id: 7 } : null
                )
            );

            create(type).back();

            expect(await back.mock.calls[0][0]()).toBe(
                `/workspace/xtreams/route-source/${section}/7`
            );
            expect(getContentByXtreamId).toHaveBeenCalledWith(
                20001,
                'route-source',
                contentType
            );
        }
    );

    it.each(['movie', 'tv'] as const)(
        'preserves the verified %s route category for duplicate provider IDs',
        async (type) => {
            runtime.supportsXtreamSqliteDataSource = true;
            const key = type === 'movie' ? 'vodId' : 'serialId';
            route.snapshot.params = {
                id: 'route-source',
                categoryId: '8',
                [key]: '42',
            };
            getContentByXtreamId.mockResolvedValue({ category_id: 8 });

            create(type).back();

            expect(await back.mock.calls[0][0]()).toBe(
                `/workspace/xtreams/route-source/${type === 'movie' ? 'vod' : 'series'}/8`
            );
            expect(getContentByXtreamId).toHaveBeenCalledTimes(1);
            expect(getContentByXtreamId).toHaveBeenCalledWith(
                42,
                'route-source',
                type === 'movie' ? 'movie' : 'series',
                undefined,
                8
            );
        }
    );

    it.each(['missing', 'failed'])(
        'falls back to the SQLite catalog root when the row is %s',
        async (outcome) => {
            runtime.supportsXtreamSqliteDataSource = true;
            route.snapshot.params = {
                id: 'route-source',
                categoryId: '201',
                vodId: '20001',
            };
            if (outcome === 'failed')
                getContentByXtreamId.mockRejectedValue(
                    new Error('Synthetic lookup failure')
                );

            create('movie').back();

            expect(await back.mock.calls[0][0]()).toBe(
                '/workspace/xtreams/route-source/vod'
            );
        }
    );

    it('opens the actor page of a TMDB-matched cast member', () => {
        create('movie').openActor({ name: 'Mara', tmdbPersonId: 77 } as never);

        expect(navigate).toHaveBeenCalledWith([
            '/workspace/xtreams',
            'xtream-1',
            'actor',
            77,
        ]);
    });

    it('opens no actor page without a playlist or a TMDB person', () => {
        const navigation = create('movie');

        navigation.openActor({ name: 'Mara' } as never);
        currentPlaylist.set(null);
        navigation.openActor({ name: 'Mara', tmdbPersonId: 77 } as never);

        expect(navigate).not.toHaveBeenCalled();
    });

    it('opens a similar title of this playlist relative to the details route', () => {
        create('tv').openSimilar({ categoryId: 12, id: 345 } as never);

        expect(navigate).toHaveBeenCalledWith(['../..', 12, 345], {
            relativeTo: route,
        });
    });

    it('opens a similar title of another portal through its link', () => {
        const item = { match: { playlistId: 'xtream-2' } } as never;
        const link = ['/workspace/xtreams', 'xtream-2', 'series', '3', '9'];
        buildLink.mockReturnValue(link);

        create('tv').openSimilarInPortals(item);

        expect(buildLink).toHaveBeenCalledWith(item);
        expect(navigate).toHaveBeenCalledWith(link);
    });

    it.each(['movie', 'tv'] as const)(
        'sends the facet chips to the %s Discover page of the playlist',
        (mediaType) => {
            const { discover } = create(mediaType);

            expect(discover.canOpenYear('1999-03-31')).toBe(true);
            discover.openYear('1999-03-31');

            expect(navigate).toHaveBeenCalledWith(
                ['/workspace', 'xtreams', 'xtream-1', 'discover'],
                { queryParams: { type: mediaType, year: '1999' } }
            );
        }
    );

    it('offers no facet chip while enrichment cannot fill Discover', () => {
        const { discover } = create('movie');

        enrichmentEnabled.set(false);
        expect(discover.canOpenYear('1999-03-31')).toBe(false);

        enrichmentEnabled.set(true);
        currentPlaylist.set(null);
        expect(discover.canOpenYear('1999-03-31')).toBe(false);
        discover.openYear('1999-03-31');

        expect(navigate).not.toHaveBeenCalled();
    });
});
