import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
    WorkspaceBackNavigationService,
    WorkspaceBackParent,
} from '@iptvnator/portal/shared/data-access';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { StalkerActorRouteComponent } from './stalker-actor-route.component';
import { StalkerDiscoverRouteComponent } from './stalker-discover-route.component';
import { StalkerSearchComponent } from './stalker-search/stalker-search.component';

/**
 * Stalker's Discover, actor and search pages lead Back to a parent route
 * when they opened the session. Their routes are Stalker's own, so the
 * Xtream tests do not cover this wiring: each page must hand the service
 * the parent under the portal `:id` of its ancestor route.
 */
describe('Stalker workspace Back parents', () => {
    const back = jest.fn();
    let queryParams: Record<string, string>;

    function activatedRoute(): ActivatedRoute {
        const params = { id: 'stalker-1' };
        return {
            params: of(params),
            queryParams: of(queryParams),
            snapshot: { queryParams, params, pathFromRoot: [] },
            pathFromRoot: [],
        } as unknown as ActivatedRoute;
    }

    function configure(): void {
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                { provide: ActivatedRoute, useFactory: activatedRoute },
                { provide: WorkspaceBackNavigationService, useValue: { back } },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { discoverTitles: jest.fn() },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: { isAvailable: false, matchTitles: jest.fn() },
                },
            ],
        });
    }

    /** The parent the page handed to `back()` on its last call. */
    async function lastParent(): Promise<WorkspaceBackParent> {
        const resolveParent = back.mock.calls.at(-1)?.[0] as
            | (() => WorkspaceBackParent | Promise<WorkspaceBackParent>)
            | undefined;
        if (!resolveParent) throw new Error('Expected a back() call');
        return resolveParent();
    }

    beforeEach(() => {
        back.mockReset();
        queryParams = {};
        configure();
    });

    it.each([
        ['movie', 'vod'],
        ['tv', 'series'],
    ])('leads a %s Discover page to the %s list', async (type, section) => {
        queryParams = { type, year: '1990' };
        const page = TestBed.runInInjectionContext(
            () => new StalkerDiscoverRouteComponent()
        );

        page.goBack();

        expect(await lastParent()).toEqual([
            '/workspace',
            'stalker',
            'stalker-1',
            section,
        ]);
    });

    it('leads an actor page to the portal root, which redirects to its default section', async () => {
        const page = TestBed.runInInjectionContext(
            () => new StalkerActorRouteComponent()
        );

        page.goBack();

        expect(await lastParent()).toEqual([
            '/workspace',
            'stalker',
            'stalker-1',
        ]);
    });

    it('leads the search page to the portal root', async () => {
        // The search page needs the whole portal store to construct; Back
        // only uses its route and the back service.
        const page = Object.assign(
            Object.create(StalkerSearchComponent.prototype),
            {
                activatedRoute: activatedRoute(),
                backNavigation: { back },
            }
        ) as StalkerSearchComponent;

        page.goBack();

        expect(await lastParent()).toEqual([
            '/workspace',
            'stalker',
            'stalker-1',
        ]);
    });
});
