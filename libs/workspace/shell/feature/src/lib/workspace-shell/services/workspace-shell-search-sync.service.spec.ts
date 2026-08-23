import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { WorkspaceStartupPreferencesService } from '@iptvnator/workspace/shell/util';
import { SEARCH_INPUT_DEBOUNCE_MS } from './helpers/workspace-shell-constants';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';
import { WorkspaceShellSearchService } from './workspace-shell-search.service';
import { WorkspaceShellSearchSyncService } from './workspace-shell-search-sync.service';

const DOWNLOADS_URL = '/workspace/downloads';

describe('WorkspaceShellSearchSyncService', () => {
    let service: WorkspaceShellSearchSyncService;
    let routeState: WorkspaceShellRouteStateService;
    let events: Subject<NavigationEnd>;
    let searchService: WorkspaceShellSearchService;
    let trigger: 'imperative' | 'popstate';
    let router: {
        url: string;
        events: Subject<NavigationEnd>;
        navigate: jest.Mock;
        navigateByUrl: jest.Mock;
        parseUrl: jest.Mock;
        lastSuccessfulNavigation: () => { trigger: string };
    };

    /**
     * Emits the NavigationEnd both shell services listen for. `origin` mirrors
     * `Navigation.trigger`: 'imperative' is the app navigating, 'popstate' is
     * the user moving through browser history.
     */
    function navigateTo(
        url: string,
        origin: 'imperative' | 'popstate' = 'imperative'
    ): void {
        router.url = url;
        trigger = origin;
        events.next(new NavigationEnd(1, url, url));
    }

    beforeEach(() => {
        jest.useFakeTimers();
        events = new Subject<NavigationEnd>();
        trigger = 'imperative';
        router = {
            url: DOWNLOADS_URL,
            events,
            navigate: jest.fn().mockResolvedValue(true),
            navigateByUrl: jest.fn().mockResolvedValue(true),
            lastSuccessfulNavigation: () => ({ trigger }),
            parseUrl: jest.fn((url: string) => {
                const parsed = new URL(url, 'http://localhost');
                const queryParams: Record<string, string> = {};
                parsed.searchParams.forEach((value, key) => {
                    queryParams[key] = value;
                });
                return { queryParams };
            }),
        };

        TestBed.configureTestingModule({
            providers: [
                WorkspaceShellRouteStateService,
                WorkspaceShellSearchSyncService,
                WorkspaceShellSearchService,
                { provide: Router, useValue: router },
                {
                    provide: Store,
                    useValue: {
                        selectSignal: jest.fn().mockReturnValue(signal([])),
                        dispatch: jest.fn(),
                    },
                },
                {
                    provide: PlaylistContextFacade,
                    useValue: { activePlaylist: signal(null) },
                },
                {
                    provide: WorkspaceStartupPreferencesService,
                    useValue: {
                        getFirstAvailableWorkspacePath: jest.fn(() => '/'),
                        persistLastRestorablePath: jest.fn(),
                        showDashboard: jest.fn(() => true),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                        onLangChange: of(null),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        isElectron: true,
                        isMacOS: true,
                        supportsDownloads: true,
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        setSearchTerm: jest.fn(),
                        setCategorySearchTerm: jest.fn(),
                        getSelectedCategory: signal(null),
                    },
                },
                {
                    provide: StalkerStore,
                    useValue: {
                        setSearchPhrase: jest.fn(),
                        getSelectedCategoryName: signal(''),
                        itvFullListActive: signal(false),
                    },
                },
            ],
        });

        routeState = TestBed.inject(WorkspaceShellRouteStateService);
        service = TestBed.inject(WorkspaceShellSearchSyncService);
        searchService = TestBed.inject(WorkspaceShellSearchService);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('keeps in-flight typing when the page writes an unrelated query param', () => {
        // The downloads filter chips write `?filter=…` with replaceUrl. Under
        // load that navigation can land after the first keystroke — it must
        // not eat the search term the user is still typing.
        service.onSearchInput('Beta Movie');
        navigateTo(DOWNLOADS_URL);

        expect(service.searchQuery()).toBe('Beta Movie');

        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        expect(service.appliedSearchQuery()).toBe('Beta Movie');
        expect(service.searchQuery()).toBe('Beta Movie');

        // The term has to reach the URL — that is what the page reads back.
        TestBed.flushEffects();
        expect(router.navigateByUrl).toHaveBeenCalledWith(
            `${DOWNLOADS_URL}?q=Beta+Movie`,
            { replaceUrl: true }
        );
    });

    it('does not roll typing back to the term its own q navigation echoes', () => {
        service.onSearchInput('Beta');
        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);
        expect(service.appliedSearchQuery()).toBe('Beta');

        // The user keeps typing while the applied term reaches the URL.
        service.onSearchInput('Beta Movie');
        navigateTo(`${DOWNLOADS_URL}?q=Beta`);

        expect(service.searchQuery()).toBe('Beta Movie');

        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        expect(service.appliedSearchQuery()).toBe('Beta Movie');
    });

    it('clears in-flight typing when the navigation leaves the page', () => {
        service.onSearchInput('Beta Movie');
        navigateTo('/workspace/sources');

        expect(service.searchQuery()).toBe('');

        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        expect(service.appliedSearchQuery()).toBe('');
        expect(service.searchQuery()).toBe('');
    });

    it('adopts a same-page q that differs from the applied term', () => {
        // Back/forward and the command palette change `q` in place; that is
        // real search intent and wins over whatever is being typed.
        service.onSearchInput('Beta Movie');
        navigateTo(`${DOWNLOADS_URL}?q=Alpha`);

        expect(service.searchQuery()).toBe('Alpha');

        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        expect(service.appliedSearchQuery()).toBe('Alpha');
    });

    it('lets browser history win over in-flight typing', () => {
        // Back/forward is authoritative even when the entry restores the term
        // already applied — only app-initiated navigations are treated as
        // echoes worth ignoring.
        service.onSearchInput('Beta');
        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);
        service.onSearchInput('Beta Movie');

        navigateTo(`${DOWNLOADS_URL}?q=Beta`, 'popstate');

        expect(service.searchQuery()).toBe('Beta');

        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        expect(service.appliedSearchQuery()).toBe('Beta');
    });

    it('does not let a pending keystroke reapply behind an Enter commit', () => {
        // Enter commits the trimmed term immediately; the debounce still
        // holding the untrimmed keystroke must not overwrite it afterwards.
        service.onSearchInput('Beta Movie ');
        searchService.onSearchEnter('Beta Movie ');

        expect(service.appliedSearchQuery()).toBe('Beta Movie');

        navigateTo(`${DOWNLOADS_URL}?q=Beta+Movie`);
        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        expect(service.appliedSearchQuery()).toBe('Beta Movie');
        expect(service.searchQuery()).toBe('Beta Movie');
    });

    it('keeps a trailing space when its own trimmed q echo lands after the debounce', () => {
        // #1338 residual: type "Bein ", pause past the debounce. The applied
        // term is trimmed, written to the URL as q=Bein, and the router echoes
        // that navigation back with no debounce pending anymore. The echo must
        // not snap the box back to "Bein" — typing on would yield "BeinSports".
        service.onSearchInput('Bein ');
        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        expect(service.appliedSearchQuery()).toBe('Bein');
        expect(service.searchQuery()).toBe('Bein ');

        TestBed.flushEffects();
        expect(router.navigateByUrl).toHaveBeenCalledWith(
            `${DOWNLOADS_URL}?q=Bein`,
            { replaceUrl: true }
        );

        navigateTo(`${DOWNLOADS_URL}?q=Bein`);

        expect(service.searchQuery()).toBe('Bein ');

        service.onSearchInput('Bein Sports');
        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        expect(service.appliedSearchQuery()).toBe('Bein Sports');
        expect(service.searchQuery()).toBe('Bein Sports');
    });

    it('still adopts a history entry matching the applied term after typing settles', () => {
        // The echo guard must stay scoped to app-initiated navigations even
        // when no debounce is pending: back/forward re-applies exactly what
        // the entry carries, dropping the uncommitted trailing space.
        service.onSearchInput('Bein ');
        jest.advanceTimersByTime(SEARCH_INPUT_DEBOUNCE_MS);

        navigateTo(`${DOWNLOADS_URL}?q=Bein`, 'popstate');

        expect(service.searchQuery()).toBe('Bein');
        expect(service.appliedSearchQuery()).toBe('Bein');
    });

    it('adopts an externally crafted q with edge whitespace in trimmed form', () => {
        // A deep link ?q=Bein%20 must not put an untrimmed term into the
        // applied signal: the URL-sync effect rewrites the URL trimmed, and
        // an untrimmed applied term would fail the echo guard's equality
        // check — snapping the box and dispatching the portal search twice.
        navigateTo(`${DOWNLOADS_URL}?q=Bein%20`);

        expect(service.searchQuery()).toBe('Bein');
        expect(service.appliedSearchQuery()).toBe('Bein');

        // The trimmed rewrite's echo is our own navigation — skipped.
        TestBed.flushEffects();
        navigateTo(`${DOWNLOADS_URL}?q=Bein`);

        expect(service.searchQuery()).toBe('Bein');
        expect(service.appliedSearchQuery()).toBe('Bein');
    });

    it('syncs the search box from the url when nothing is being typed', () => {
        navigateTo(`${DOWNLOADS_URL}?q=Gamma`);

        expect(service.searchQuery()).toBe('Gamma');
        expect(service.appliedSearchQuery()).toBe('Gamma');
        expect(routeState.currentUrl()).toBe(`${DOWNLOADS_URL}?q=Gamma`);

        navigateTo('/workspace/settings/general');

        expect(service.searchQuery()).toBe('');
        expect(service.appliedSearchQuery()).toBe('');
    });
});
