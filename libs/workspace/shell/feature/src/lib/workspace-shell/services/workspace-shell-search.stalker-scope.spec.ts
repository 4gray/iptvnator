import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    type StalkerCategoryLabel,
    StalkerStore,
} from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { parseWorkspaceShellRoute } from '@iptvnator/workspace/shell/util';
import { SettingsSearchService } from '@iptvnator/workspace/shell/util/settings-search';
import { WorkspaceShellRouteStateService } from './workspace-shell-route-state.service';
import { WorkspaceShellSearchSyncService } from './workspace-shell-search-sync.service';
import { WorkspaceShellSearchService } from './workspace-shell-search.service';

describe('WorkspaceShellSearchService Stalker search scope', () => {
    let service: WorkspaceShellSearchService;
    let translate: TranslateService;
    const categoryLabel = signal<StalkerCategoryLabel>({
        name: '',
        labelKey: null,
    });

    beforeEach(() => {
        const route = parseWorkspaceShellRoute('/workspace/stalker/pl-1/vod');
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                WorkspaceShellSearchService,
                { provide: Router, useValue: { navigate: jest.fn() } },
                {
                    provide: XtreamStore,
                    useValue: { getSelectedCategory: () => null },
                },
                {
                    provide: StalkerStore,
                    useValue: {
                        getSelectedCategoryLabel: categoryLabel,
                        itvFullListActive: signal(false),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: true },
                },
                {
                    provide: WorkspaceShellRouteStateService,
                    useValue: {
                        currentRoute: signal(route),
                        playlists: signal([]),
                        dashboardXtreamContext: signal(null),
                        currentContext: signal(route.context),
                    },
                },
                {
                    provide: WorkspaceShellSearchSyncService,
                    useValue: {
                        searchQuery: signal(''),
                        appliedSearchQuery: signal(''),
                    },
                },
                { provide: SettingsSearchService, useValue: {} },
            ],
        });
        translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: { ALL_CATEGORIES: 'All categories' },
            WORKSPACE: { SHELL: { RAIL_MOVIES: 'Movies' } },
        });
        translate.setTranslation('ru', {
            PORTALS: { ALL_CATEGORIES: 'Все категории' },
            WORKSPACE: { SHELL: { RAIL_MOVIES: 'Фильмы' } },
        });
        translate.use('en');
        service = TestBed.inject(WorkspaceShellSearchService);
    });

    it('re-words the every-item genre in the scope after a language switch', () => {
        categoryLabel.set({ name: '', labelKey: 'PORTALS.ALL_CATEGORIES' });

        expect(service.searchScopeLabel()).toBe('Movies / All categories');

        translate.use('ru');

        expect(service.searchScopeLabel()).toBe('Фильмы / Все категории');
    });

    it('keeps a portal genre name as the portal sent it', () => {
        categoryLabel.set({ name: 'Drama', labelKey: null });

        translate.use('ru');

        expect(service.searchScopeLabel()).toBe('Фильмы / Drama');
    });
});
