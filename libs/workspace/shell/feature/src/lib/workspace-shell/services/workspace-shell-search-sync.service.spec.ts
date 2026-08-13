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
import { WorkspaceShellSearchSyncService } from './workspace-shell-search-sync.service';

const DOWNLOADS_URL = '/workspace/downloads';

describe('WorkspaceShellSearchSyncService', () => {
    let service: WorkspaceShellSearchSyncService;
    let routeState: WorkspaceShellRouteStateService;
    let events: Subject<NavigationEnd>;
    let router: {
        url: string;
        events: Subject<NavigationEnd>;
        navigate: jest.Mock;
        navigateByUrl: jest.Mock;
        parseUrl: jest.Mock;
    };

    /** Emits the NavigationEnd both shell services listen for. */
    function navigateTo(url: string): void {
        router.url = url;
        events.next(new NavigationEnd(1, url, url));
    }

    beforeEach(() => {
        jest.useFakeTimers();
        events = new Subject<NavigationEnd>();
        router = {
            url: DOWNLOADS_URL,
            events,
            navigate: jest.fn().mockResolvedValue(true),
            navigateByUrl: jest.fn().mockResolvedValue(true),
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
                    },
                },
                {
                    provide: StalkerStore,
                    useValue: { setSearchPhrase: jest.fn() },
                },
            ],
        });

        routeState = TestBed.inject(WorkspaceShellRouteStateService);
        service = TestBed.inject(WorkspaceShellSearchSyncService);
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
