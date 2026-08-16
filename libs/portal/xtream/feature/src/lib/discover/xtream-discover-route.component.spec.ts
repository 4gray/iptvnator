import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
                    useValue: {
                        queryParams: of({ type: 'movie', year: '1990' }),
                        snapshot: {
                            queryParams: { type: 'movie', year: '1990' },
                            pathFromRoot: [],
                        },
                    },
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
});
