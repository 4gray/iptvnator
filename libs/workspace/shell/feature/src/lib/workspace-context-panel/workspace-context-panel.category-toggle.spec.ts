import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorkspaceContextPanelComponent } from './workspace-context-panel.component';
import { WorkspaceShellSearchSyncService } from '../workspace-shell/services/workspace-shell-search-sync.service';

describe('WorkspaceContextPanelComponent category toggle deselection', () => {
    let fixture: ComponentFixture<WorkspaceContextPanelComponent>;
    const xtreamSelectedCategoryId = signal<number | null>(null);
    const stalkerSelectedCategoryId = signal<string | null>(null);

    const xtreamStore = {
        getCategoriesBySelectedType: signal([
            { id: 1, name: 'News' },
            { id: 2, name: 'Sports' },
        ]),
        getCategoryItemCounts: signal(new Map<number, number>()),
        selectedCategoryId: xtreamSelectedCategoryId,
        selectedTypeContentState: signal('ready'),
        selectedTypeContentReady: signal(true),
        selectedTypeCountsReady: signal(true),
        isImporting: signal(false),
        currentImportPhase: signal(null),
        isLoadingCategories: signal(false),
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn((id: number | null) =>
            xtreamSelectedCategoryId.set(id)
        ),
        reloadCategories: jest.fn(),
    };

    const stalkerStore = {
        getCategoryResource: signal([
            { category_id: '*', category_name: 'All' },
            { category_id: '10', category_name: 'News' },
        ]),
        selectedCategoryId: stalkerSelectedCategoryId,
        isCategoryResourceLoading: signal(false),
        isCategoryResourceFailed: signal(false),
        itvFullListActive: signal(false),
        itvFullListLoading: signal(false),
        itvCategoryItemCounts: signal(new Map<number, number>()),
        setSelectedCategory: jest.fn((id: string) =>
            stalkerSelectedCategoryId.set(id)
        ),
        setPage: jest.fn(),
        clearSelectedItem: jest.fn(),
    };

    const router = {
        routerState: {
            snapshot: {
                root: {
                    routeConfig: null,
                    paramMap: { has: () => false },
                    children: [
                        {
                            routeConfig: { path: 'live/:categoryId' },
                            paramMap: {
                                has: (param: string) => param === 'categoryId',
                            },
                            children: [],
                        },
                    ],
                },
            },
        },
        navigate: jest.fn(),
    };

    beforeEach(async () => {
        xtreamSelectedCategoryId.set(null);
        stalkerSelectedCategoryId.set(null);
        xtreamStore.setSelectedItem.mockClear();
        xtreamStore.setSelectedCategory.mockClear();
        stalkerStore.setSelectedCategory.mockClear();
        stalkerStore.setPage.mockClear();
        stalkerStore.clearSelectedItem.mockClear();
        router.navigate.mockClear();

        await TestBed.configureTestingModule({
            imports: [WorkspaceContextPanelComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: WorkspaceShellSearchSyncService,
                    useValue: { searchQuery: signal('pending query') },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => key,
                        get: (key: string) => of(key),
                        stream: (key: string) => of(key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                { provide: XtreamStore, useValue: xtreamStore },
                { provide: StalkerStore, useValue: stalkerStore },
                { provide: Router, useValue: router },
                {
                    provide: WorkspaceShellContextDrawerService,
                    useValue: { close: jest.fn(), isOpen: () => false },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(WorkspaceContextPanelComponent);
        fixture.componentRef.setInput('context', {
            provider: 'xtreams',
            playlistId: 'playlist-1',
        });
        fixture.componentRef.setInput('section', 'live');
        fixture.detectChanges();
    });

    it('selects category when clicked if not currently selected', () => {
        xtreamSelectedCategoryId.set(null);
        fixture.detectChanges();

        fixture.componentInstance.onXtreamCategoryClicked({ id: 1 });

        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(1);
        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'playlist-1', 'live', 1],
            expect.objectContaining({ queryParamsHandling: 'preserve' })
        );
    });

    it('deselects Xtream category when clicking already selected category in live', () => {
        xtreamSelectedCategoryId.set(1);
        fixture.detectChanges();

        fixture.componentInstance.onXtreamCategoryClicked({ id: 1 });

        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(null);
        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'playlist-1', 'live'],
            expect.objectContaining({
                queryParamsHandling: 'merge',
                queryParams: { q: 'pending query' },
            })
        );
    });

    it('deselects Xtream category and clears selected item when clicking already selected category in VOD', () => {
        fixture.componentRef.setInput('section', 'vod');
        xtreamSelectedCategoryId.set(2);
        fixture.detectChanges();

        fixture.componentInstance.onXtreamCategoryClicked({ id: 2 });

        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(null);
        expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'playlist-1', 'vod'],
            expect.objectContaining({
                queryParamsHandling: 'merge',
                queryParams: { q: 'pending query' },
            })
        );
    });

    it('deselects Stalker category back to * when clicking already selected category', () => {
        fixture.componentRef.setInput('context', {
            provider: 'stalker',
            playlistId: 'stalker-1',
        });
        fixture.componentRef.setInput('section', 'vod');
        stalkerSelectedCategoryId.set('10');
        fixture.detectChanges();

        fixture.componentInstance.onStalkerCategoryClicked({
            category_id: '10',
        });

        expect(stalkerStore.setSelectedCategory).toHaveBeenCalledWith('*');
        expect(stalkerStore.setPage).toHaveBeenCalledWith(0);
        expect(stalkerStore.clearSelectedItem).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith(
            ['/workspace', 'stalker', 'stalker-1', 'vod'],
            expect.objectContaining({
                queryParamsHandling: 'merge',
                queryParams: { q: 'pending query' },
            })
        );
    });
});
