import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
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
    const tmdbEnabled = signal(true);

    let resolveDiscover: (titles: DiscoverTitle[] | null) => void;
    let discoverTitles: jest.Mock;
    const back = jest.fn();
    let facetParams: BehaviorSubject<Record<string, string>>;

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
        tmdbEnabled.set(true);

        back.mockReset();
        facetParams = new BehaviorSubject({ type: 'movie', year: '1990' });
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
                        queryParams: facetParams,
                        snapshot: {
                            queryParams: facetParams.value,
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
                    useValue: { discoverTitles, isEnabled: tmdbEnabled },
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
                title: 'Synthetic Film Alpha',
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
                title: 'Synthetic Film Alpha',
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
        const match = {
            queryTitle: 'Synthetic Film Alpha',
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
                matchTitles: jest.fn().mockResolvedValue([match]),
                visibleMatches: (matches: unknown[]) =>
                    withheld() ? [] : matches,
            },
        });
        const component = createComponent();
        resolveDiscover([
            {
                tmdbId: 1,
                mediaType: 'movie',
                title: 'Synthetic Film Alpha',
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

    it('retries a failed request for the same selection and accepts an empty result', async () => {
        const component = createComponent();
        resolveDiscover(null);
        await settle();
        expect(component.loadFailed()).toBe(true);

        discoverTitles.mockResolvedValueOnce([]);
        await component.loadDiscover();

        expect(discoverTitles).toHaveBeenCalledTimes(2);
        expect(discoverTitles).toHaveBeenLastCalledWith(
            ...discoverTitles.mock.calls[0]
        );
        expect(component.loadFailed()).toBe(false);
        expect(component.items()).toEqual([]);
    });

    it('skips the request while TMDB is disabled', () => {
        tmdbEnabled.set(false);
        const component = createComponent();

        expect(component.tmdbEnabled()).toBe(false);
        expect(component.loadFailed()).toBe(false);
        expect(discoverTitles).not.toHaveBeenCalled();
    });

    it('shows an empty selection without waiting for the previous catalog lookup', async () => {
        const matchTitles = jest.fn(() => new Promise<never>(() => undefined));
        TestBed.overrideProvider(CatalogTitleMatchService, {
            useValue: { isAvailable: true, matchTitles },
        });
        const component = createComponent();
        resolveDiscover([
            {
                tmdbId: 1,
                mediaType: 'movie',
                title: 'Synthetic Film Alpha',
                originalTitle: null,
                year: 1990,
                posterUrl: null,
            },
        ]);
        await settle();
        component.onScopeChanged('global');
        expect(component.isMatchingGlobal()).toBe(true);

        facetParams.next({ type: 'movie', year: '1991' });
        TestBed.tick();
        resolveDiscover([]);
        await settle();

        expect(component.items()).toEqual([]);
        expect(component.isMatchingGlobal()).toBe(false);
        expect(matchTitles).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['movie', 'vod'],
        ['tv', 'series'],
    ])(
        'leads a %s Discover page that opened the session to the %s list',
        async (type, section) => {
            facetParams.next({ type, year: '1990' });
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
