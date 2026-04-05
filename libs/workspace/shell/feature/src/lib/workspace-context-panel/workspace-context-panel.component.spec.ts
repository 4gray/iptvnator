import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    XtreamContentLoadState,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { WorkspaceContextPanelComponent } from './workspace-context-panel.component';

const translations: Record<string, string> = {
    'WORKSPACE.CONTEXT.MANAGE_CATEGORIES': 'Manage categories',
    'WORKSPACE.CONTEXT.XTREAM_SYNCING_LIVE': 'Syncing live categories...',
    'WORKSPACE.CONTEXT.XTREAM_SYNCING_MOVIES': 'Syncing movie categories...',
    'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING':
        'Fetching playlist data from source...',
};

describe('WorkspaceContextPanelComponent', () => {
    let fixture: ComponentFixture<WorkspaceContextPanelComponent>;
    const xtreamCategories = signal([
        { id: 1, name: 'News' },
        { id: 2, name: 'Sports' },
    ]);
    const xtreamCategoryItemCounts = signal(new Map<number, number>());
    const xtreamSelectedCategoryId = signal<number | null>(null);
    const xtreamSelectedTypeContentState =
        signal<XtreamContentLoadState>('loading');
    const xtreamImportPhase = signal<string | null>('loading-live');
    const xtreamIsLoadingCategories = signal(false);

    const xtreamStore = {
        getCategoriesBySelectedType: xtreamCategories,
        getCategoryItemCounts: xtreamCategoryItemCounts,
        selectedCategoryId: xtreamSelectedCategoryId,
        selectedTypeContentState: xtreamSelectedTypeContentState,
        selectedTypeContentReady: computed(
            () => xtreamSelectedTypeContentState() === 'ready'
        ),
        selectedTypeCountsReady: computed(
            () => xtreamSelectedTypeContentState() === 'ready'
        ),
        currentImportPhase: xtreamImportPhase,
        isLoadingCategories: xtreamIsLoadingCategories,
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
        reloadCategories: jest.fn(),
    };
    const stalkerStore = {
        getCategoryResource: signal([]),
        selectedCategoryId: signal<string | null>(null),
        isCategoryResourceLoading: signal(false),
        isCategoryResourceFailed: signal(false),
        setSelectedCategory: jest.fn(),
        setPage: jest.fn(),
        clearSelectedItem: jest.fn(),
    };
    const router = {
        navigate: jest.fn(),
    };
    const dialog = {
        open: jest.fn(),
    };

    beforeEach(async () => {
        xtreamCategories.set([
            { id: 1, name: 'News' },
            { id: 2, name: 'Sports' },
        ]);
        xtreamCategoryItemCounts.set(new Map());
        xtreamSelectedCategoryId.set(null);
        xtreamSelectedTypeContentState.set('loading');
        xtreamImportPhase.set('loading-live');
        xtreamIsLoadingCategories.set(false);
        xtreamStore.setSelectedItem.mockClear();
        xtreamStore.setSelectedCategory.mockClear();
        xtreamStore.reloadCategories.mockClear();
        router.navigate.mockClear();
        dialog.open.mockClear();

        await TestBed.configureTestingModule({
            imports: [WorkspaceContextPanelComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) => translations[key] ?? key,
                        get: (key: string) => of(translations[key] ?? key),
                        stream: (key: string) => of(translations[key] ?? key),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: xtreamStore,
                },
                {
                    provide: StalkerStore,
                    useValue: stalkerStore,
                },
                {
                    provide: Router,
                    useValue: router,
                },
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(WorkspaceContextPanelComponent);
        fixture.componentRef.setInput('context', {
            provider: 'xtreams',
            playlistId: 'playlist-1',
        });
    });

    it('renders loading meta and blocks xtream category clicks until counts are ready', () => {
        fixture.componentRef.setInput('section', 'live');
        fixture.detectChanges();

        const countPlaceholders = fixture.nativeElement.querySelectorAll(
            '.item-count--loading'
        );
        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];
        const status = fixture.nativeElement.querySelector(
            '.context-inline-status'
        ) as HTMLElement | null;
        const manageButton = fixture.nativeElement.querySelector(
            '.context-header__action'
        ) as HTMLButtonElement | null;

        expect(countPlaceholders).toHaveLength(2);
        expect(categoryButtons.every((button) => button.disabled)).toBe(true);
        expect(status?.textContent).toContain('Syncing live categories...');
        expect(status?.textContent).toContain(
            'Fetching playlist data from source...'
        );
        expect(manageButton?.disabled).toBe(true);

        categoryButtons[0]?.click();

        expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
        expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
    });

    it('shows real counts and enables navigation once the selected xtream type is ready', () => {
        fixture.componentRef.setInput('section', 'vod');
        xtreamSelectedTypeContentState.set('ready');
        xtreamImportPhase.set(null);
        xtreamCategoryItemCounts.set(
            new Map([
                [1, 3],
                [2, 0],
            ])
        );
        fixture.detectChanges();

        const countTexts = Array.from(
            fixture.nativeElement.querySelectorAll('.item-count')
        ).map((element: Element) => element.textContent?.trim());
        const categoryButtons = Array.from(
            fixture.nativeElement.querySelectorAll('.category-item')
        ) as HTMLButtonElement[];
        const manageButton = fixture.nativeElement.querySelector(
            '.context-header__action'
        ) as HTMLButtonElement | null;

        expect(countTexts).toEqual(['3', '0']);
        expect(categoryButtons.every((button) => !button.disabled)).toBe(true);
        expect(manageButton?.disabled).toBe(false);

        categoryButtons[1]?.click();

        expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(2);
        expect(router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
            2,
        ]);
    });
});
