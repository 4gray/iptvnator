import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    parseWorkspaceShellRoute,
    WorkspacePortalContext,
} from '@iptvnator/workspace/shell/util';
import { SettingsSearchService } from '@iptvnator/workspace/shell/util/settings-search';
import { SEARCH_PLAYLIST_PLACEHOLDER } from './helpers/workspace-shell-constants';
import { SEARCH_GLOBAL_PLACEHOLDER } from './helpers/workspace-shell-dashboard-search';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';
import { WorkspaceShellSearchSyncService } from './workspace-shell-search-sync.service';
import { WorkspaceShellSearchService } from './workspace-shell-search.service';

const M3U_SOURCE = {
    _id: 'm3u-1',
    title: 'Sample list',
    url: 'http://example.test/list.m3u',
    count: 3,
} as PlaylistMeta;

describe('WorkspaceShellSearchService on the dashboard', () => {
    let navigate: jest.Mock;
    let xtreamContext: ReturnType<
        typeof signal<WorkspacePortalContext | null>
    >;
    let applySearchQuery: jest.Mock;

    function setup(options: {
        isElectron: boolean;
        playlists?: PlaylistMeta[];
    }): WorkspaceShellSearchService {
        navigate = jest.fn().mockResolvedValue(true);
        applySearchQuery = jest.fn();
        xtreamContext = signal<WorkspacePortalContext | null>(null);

        TestBed.configureTestingModule({
            providers: [
                WorkspaceShellSearchService,
                { provide: Router, useValue: { navigate } },
                {
                    provide: XtreamStore,
                    useValue: {
                        getSelectedCategory: () => null,
                        selectedCategoryId: () => null,
                        setSearchTerm: jest.fn(),
                    },
                },
                {
                    provide: StalkerStore,
                    useValue: {
                        getSelectedCategoryLabel: () => ({
                            name: '',
                            labelKey: null,
                        }),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        onLangChange: of(null),
                        onDefaultLangChange: EMPTY,
                        onTranslationChange: EMPTY,
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: options.isElectron },
                },
                {
                    provide: WorkspaceShellRouteStateService,
                    useValue: {
                        currentRoute: signal(
                            parseWorkspaceShellRoute('/workspace/dashboard')
                        ),
                        playlists: signal(options.playlists ?? [M3U_SOURCE]),
                        dashboardXtreamContext: xtreamContext,
                        currentContext: signal(null),
                    },
                },
                {
                    provide: WorkspaceShellSearchSyncService,
                    useValue: {
                        searchQuery: signal(''),
                        appliedSearchQuery: signal(''),
                        applySearchQuery,
                    },
                },
                {
                    provide: SettingsSearchService,
                    useValue: { search: jest.fn(), reveal: jest.fn() },
                },
            ],
        });
        return TestBed.inject(WorkspaceShellSearchService);
    }

    afterEach(() => TestBed.resetTestingModule());

    it('launches global search in the desktop app', () => {
        const service = setup({ isElectron: true });

        expect(service.searchCapability()).toEqual(
            expect.objectContaining({
                enabled: true,
                behavior: 'global-launcher',
                placeholderKey: SEARCH_GLOBAL_PLACEHOLDER,
            })
        );

        service.onSearchEnter('  news ');

        expect(navigate).toHaveBeenCalledWith(['/workspace', 'search'], {
            queryParams: { q: 'news' },
        });
    });

    it('does not launch an empty global search', () => {
        const service = setup({ isElectron: true });

        service.onSearchEnter('   ');

        expect(navigate).not.toHaveBeenCalled();
    });

    it('turns search off in the PWA, which has no global search', () => {
        const service = setup({ isElectron: false });

        expect(service.canUseSearch()).toBe(false);
        expect(service.searchCapability().behavior).toBe('disabled');
    });

    it('turns search off without a source global search can query', () => {
        const service = setup({ isElectron: true, playlists: [] });

        expect(service.canUseSearch()).toBe(false);
    });

    it.each([true, false])(
        'keeps the Xtream advanced search when isElectron is %s',
        (isElectron) => {
            const service = setup({ isElectron });
            xtreamContext.set({ provider: 'xtreams', playlistId: 'xt-1' });

            expect(service.searchCapability()).toEqual(
                expect.objectContaining({
                    enabled: true,
                    behavior: 'advanced-only',
                    placeholderKey: SEARCH_PLAYLIST_PLACEHOLDER,
                    scopeLabel: 'WORKSPACE.SHELL.RAIL_SEARCH',
                })
            );

            service.onSearchEnter('drama');

            expect(navigate).toHaveBeenCalledWith(
                ['/workspace', 'xtreams', 'xt-1', 'search'],
                { queryParams: { q: 'drama' } }
            );
        }
    );
});
