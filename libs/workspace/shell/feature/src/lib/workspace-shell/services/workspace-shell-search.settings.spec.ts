import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { parseWorkspaceShellRoute } from '@iptvnator/workspace/shell/util';
import {
    SettingsSearchEntry,
    SettingsSearchService,
} from '@iptvnator/workspace/shell/util/settings-search';
import { SEARCH_SETTINGS_PLACEHOLDER } from './helpers/workspace-shell-constants';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';
import { WorkspaceShellSearchSyncService } from './workspace-shell-search-sync.service';
import { WorkspaceShellSearchService } from './workspace-shell-search.service';

const THEME: SettingsSearchEntry = {
    id: 'theme',
    section: 'general',
    labelKey: 'SETTINGS.THEME',
};

describe('WorkspaceShellSearchService on settings routes', () => {
    let service: WorkspaceShellSearchService;
    let currentRoute: ReturnType<
        typeof signal<ReturnType<typeof parseWorkspaceShellRoute>>
    >;
    let searchSync: {
        searchQuery: ReturnType<typeof signal<string>>;
        appliedSearchQuery: ReturnType<typeof signal<string>>;
        applySearchQuery: jest.Mock;
    };
    let settingsSearch: { search: jest.Mock; reveal: jest.Mock };

    beforeEach(() => {
        currentRoute = signal(
            parseWorkspaceShellRoute('/workspace/settings/general')
        );
        searchSync = {
            searchQuery: signal(''),
            appliedSearchQuery: signal(''),
            applySearchQuery: jest.fn(),
        };
        settingsSearch = {
            search: jest.fn((query: string) =>
                query === 'theme' ? [{ entry: THEME, score: 1 }] : []
            ),
            reveal: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                WorkspaceShellSearchService,
                { provide: Router, useValue: { navigate: jest.fn() } },
                {
                    provide: XtreamStore,
                    useValue: { getSelectedCategory: () => null },
                },
                {
                    provide: StalkerStore,
                    useValue: { getSelectedCategoryName: () => '' },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        onLangChange: of(null),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: true },
                },
                {
                    provide: WorkspaceShellRouteStateService,
                    useValue: {
                        currentRoute,
                        playlists: signal([]),
                        dashboardXtreamContext: signal(null),
                        currentContext: signal(null),
                    },
                },
                {
                    provide: WorkspaceShellSearchSyncService,
                    useValue: searchSync,
                },
                { provide: SettingsSearchService, useValue: settingsSearch },
            ],
        });
        service = TestBed.inject(WorkspaceShellSearchService);
    });

    it('enables a local settings filter with the settings placeholder', () => {
        expect(service.searchCapability()).toEqual(
            expect.objectContaining({
                enabled: true,
                behavior: 'local-filter',
                searchMode: 'local-filter',
                placeholderKey: SEARCH_SETTINGS_PLACEHOLDER,
                scopeLabel: '',
            })
        );
        expect(service.canUseSearch()).toBe(true);
    });

    it('opens the best match on Enter without applying the term', () => {
        service.onSearchEnter('  theme ');

        expect(settingsSearch.search).toHaveBeenCalledWith('theme', 1);
        expect(settingsSearch.reveal).toHaveBeenCalledWith(THEME);
        // Applying would start the `q` sync navigation and supersede the
        // reveal navigation.
        expect(searchSync.applySearchQuery).not.toHaveBeenCalled();
    });

    it('applies the term on Enter when nothing matches', () => {
        service.onSearchEnter('zzz ');

        expect(settingsSearch.reveal).not.toHaveBeenCalled();
        expect(searchSync.applySearchQuery).toHaveBeenCalledWith('zzz');
    });

    it('leaves Enter on other routes to their own search', () => {
        currentRoute.set(parseWorkspaceShellRoute('/workspace/sources'));

        service.onSearchEnter('theme');

        expect(settingsSearch.search).not.toHaveBeenCalled();
        expect(searchSync.applySearchQuery).toHaveBeenCalledWith('theme');
    });
});
