import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
    WorkspaceBackNavigationService,
    WorkspaceBackParent,
} from '@iptvnator/portal/shared/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    CatalogTitleMatchService,
    DiscoverTitle,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { XtreamDiscoverRouteComponent } from './xtream-discover-route.component';

/**
 * The cold-load contract: a Discover page must not state that a title is
 * missing from a catalog that has not finished loading. TMDB routinely
 * answers before a cold import does, and the content gate renders this
 * route while that runs.
 */
describe('XtreamDiscoverRouteComponent — catalog readiness', () => {
    const isLoadingContent = signal(false);
    const isLoadingCategories = signal(false);
    const isImporting = signal(false);
    const vodStreams = signal<unknown[]>([]);
    const serialStreams = signal<unknown[]>([]);

    let resolveDiscover: (titles: DiscoverTitle[] | null) => void;
    let discoverTitles: jest.Mock;
    const back = jest.fn();
    let facetParams: Record<string, string>;

    /** Creates the component and flushes the effect that starts the load */
    function createComponent(): XtreamDiscoverRouteComponent {
        const component = TestBed.runInInjectionContext(
            () => new XtreamDiscoverRouteComponent()
        );
        TestBed.tick();
        return component;
    }

    /** Lets the pending TMDB request settle and effects flush */
    async function settle(): Promise<void> {
        await Promise.resolve();
        await Promise.resolve();
        TestBed.tick();
    }

    beforeEach(() => {
        isLoadingContent.set(true);
        isLoadingCategories.set(true);
        isImporting.set(false);
        vodStreams.set([]);
        serialStreams.set([]);

        back.mockReset();
        facetParams = { type: 'movie', year: '1990' };
        discoverTitles = jest.fn().mockImplementation(
            () =>
                new Promise<DiscoverTitle[] | null>((resolve) => {
                    resolveDiscover = resolve;
                })
        );

        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useFactory: () => ({
                        queryParams: of(facetParams),
                        snapshot: {
                            queryParams: facetParams,
                            params: { id: 'pl-1' },
                            pathFromRoot: [],
                        },
                    }),
                },
                {
                    provide: WorkspaceBackNavigationService,
                    useValue: { back },
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        isLoadingContent,
                        isLoadingCategories,
                        isImporting,
                        vodStreams,
                        serialStreams,
                        currentPlaylist: () => ({ id: 'pl-1' }),
                    },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { discoverTitles },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: { isAvailable: false, matchTitles: jest.fn() },
                },
            ],
        });
    });

    it('keeps loading while the catalog is still importing', async () => {
        const component = createComponent();

        // TMDB wins the race a cold import always loses
        resolveDiscover([
            {
                tmdbId: 1,
                mediaType: 'movie',
                title: 'Goodfellas',
                originalTitle: null,
                year: 1990,
                posterUrl: null,
            },
        ]);
        await settle();

        // Before the fix the spinner dropped here and every card claimed
        // the title was missing from the (still empty) catalog
        expect(component.isLoading()).toBe(true);
    });

    it('publishes results once the catalog finishes loading', async () => {
        const component = createComponent();
        resolveDiscover([
            {
                tmdbId: 1,
                mediaType: 'movie',
                title: 'Goodfellas',
                originalTitle: null,
                year: 1990,
                posterUrl: null,
            },
        ]);
        await settle();

        isLoadingContent.set(false);
        isLoadingCategories.set(false);
        await settle();

        expect(component.isLoading()).toBe(false);
        expect(component.items()).toHaveLength(1);
    });

    it('stops marking a title available in another portal once the lock withholds it', async () => {
        const withheld = signal(false);
        const goodfellas = {
            queryTitle: 'Goodfellas',
            playlistId: 'pl-2',
            playlistName: 'Other Portal',
            categoryId: 9,
            xtreamId: 7,
            type: 'movie' as const,
            trailingYear: null,
        };
        TestBed.overrideProvider(CatalogTitleMatchService, {
            useValue: {
                isAvailable: true,
                matchTitles: jest.fn().mockResolvedValue([goodfellas]),
                visibleMatches: (matches: unknown[]) =>
                    withheld() ? [] : matches,
            },
        });
        const component = createComponent();
        resolveDiscover([
            {
                tmdbId: 1,
                mediaType: 'movie',
                title: 'Goodfellas',
                originalTitle: null,
                year: 1990,
                posterUrl: null,
            },
        ]);
        isLoadingContent.set(false);
        isLoadingCategories.set(false);
        await settle();
        component.onScopeChanged('global');
        await settle();
        expect(component.items()[0].available).toBe(true);

        // Lock now: the cached match must not keep the title available.
        withheld.set(true);
        expect(component.items()[0].available).toBe(false);
        expect(component.items()[0].availableIn).toBeUndefined();
    });

    it('settles when the catalog load fails instead of spinning forever', async () => {
        const component = createComponent();
        resolveDiscover(null);
        await settle();

        // A failed import clears the in-flight flags without ever marking
        // the catalog initialized — the page must still settle
        isLoadingContent.set(false);
        isLoadingCategories.set(false);
        isImporting.set(false);
        await settle();

        expect(component.isLoading()).toBe(false);
    });

    it('keeps loading while an import is still running', async () => {
        const component = createComponent();
        resolveDiscover([]);
        await settle();

        isLoadingContent.set(false);
        isLoadingCategories.set(false);
        isImporting.set(true);
        await settle();

        expect(component.isLoading()).toBe(true);
    });

    it.each([
        ['movie', 'vod'],
        ['tv', 'series'],
    ])(
        'leads a %s Discover page that opened the session to the %s list',
        async (type, section) => {
            facetParams = { type, year: '1990' };
            const component = createComponent();

            component.goBack();
            const resolveParent = back.mock.calls[0][0] as () =>
                WorkspaceBackParent | Promise<WorkspaceBackParent>;

            expect(await resolveParent()).toEqual([
                '/workspace',
                'xtreams',
                'pl-1',
                section,
            ]);
        }
    );
});
