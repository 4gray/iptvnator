import {
    Component,
    computed,
    DestroyRef,
    effect,
    inject,
    input,
    signal,
    viewChild,
    ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { WorkspaceContextCategoryViewComponent } from './components/workspace-context-category-view.component';
import { WorkspaceContextErrorViewComponent } from './components/workspace-context-error-view.component';
import { hasActiveLiveCategoryRoute } from './workspace-context-panel-route.utils';

type WorkspaceProvider = 'xtreams' | 'stalker' | 'playlists';

interface WorkspaceContextRoute {
    provider: WorkspaceProvider;
    playlistId: string;
}

interface XtreamCategoryLike {
    id?: number | string;
    category_id?: number | string;
}

@Component({
    selector: 'app-workspace-context-panel',
    imports: [
        MatIconButton,
        MatIcon,
        MatTooltip,
        TranslatePipe,
        WorkspaceContextCategoryViewComponent,
        WorkspaceContextErrorViewComponent,
    ],
    templateUrl: './workspace-context-panel.component.html',
    styleUrl: './workspace-context-panel.component.scss',
})
export class WorkspaceContextPanelComponent {
    private readonly router = inject(Router);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly dialog = inject(MatDialog);
    private readonly destroyRef = inject(DestroyRef);
    private readonly translate = inject(TranslateService);

    readonly context = input.required<WorkspaceContextRoute>();
    readonly section = input.required<string>();

    readonly isXtreamCategories = computed(
        () =>
            this.context().provider === 'xtreams' &&
            (this.section() === 'vod' ||
                this.section() === 'series' ||
                this.section() === 'live')
    );
    readonly isStalkerCategories = computed(
        () =>
            this.context().provider === 'stalker' &&
            (this.section() === 'vod' ||
                this.section() === 'series' ||
                this.section() === 'itv' ||
                this.section() === 'radio')
    );

    readonly xtreamCategories = this.xtreamStore.getCategoriesBySelectedType;
    readonly xtreamCategoryItemCounts = this.xtreamStore.getCategoryItemCounts;
    readonly xtreamSelectedCategoryId = this.xtreamStore.selectedCategoryId;
    readonly xtreamSelectedTypeContentState =
        this.xtreamStore.selectedTypeContentState;
    readonly xtreamSelectedTypeContentReady =
        this.xtreamStore.selectedTypeContentReady;
    readonly xtreamSelectedTypeCountsReady =
        this.xtreamStore.selectedTypeCountsReady;
    readonly isXtreamImporting = this.xtreamStore.isImporting;
    readonly xtreamImportPhase = this.xtreamStore.currentImportPhase;
    readonly isXtreamCategoryLoading = computed(
        () =>
            this.isXtreamCategories() &&
            this.xtreamStore.isLoadingCategories() &&
            this.xtreamCategories().length === 0
    );
    readonly isXtreamCategoryInteractionEnabled = computed(
        () =>
            !this.isXtreamCategoryLoading() &&
            this.xtreamSelectedTypeContentReady()
    );
    readonly xtreamCountDisplayMode = computed<'loading' | 'ready'>(() =>
        this.isXtreamCategoryInteractionEnabled() ? 'ready' : 'loading'
    );
    readonly canManageXtreamCategories = computed(
        () =>
            this.isXtreamCategories() &&
            this.xtreamSelectedTypeCountsReady()
    );
    readonly xtreamStatusText = computed(() => {
        if (
            !this.isXtreamCategories() ||
            this.isXtreamCategoryLoading() ||
            !this.isXtreamImporting() ||
            this.xtreamSelectedTypeContentState() !== 'loading'
        ) {
            return '';
        }

        const syncLabel = this.translate.instant(
            this.getXtreamSyncLabelKey(this.section())
        );
        const phaseKey = this.getXtreamImportPhaseLabelKey(
            this.xtreamImportPhase()
        );
        const phaseLabel = phaseKey ? this.translate.instant(phaseKey) : '';

        return phaseLabel ? `${syncLabel} ${phaseLabel}` : syncLabel;
    });

    readonly stalkerCategories = this.stalkerStore.getCategoryResource;
    readonly stalkerSelectedCategoryId = this.stalkerStore.selectedCategoryId;
    readonly isStalkerCategoryLoading =
        this.stalkerStore.isCategoryResourceLoading;
    readonly isStalkerCategoryFailed =
        this.stalkerStore.isCategoryResourceFailed;
    readonly skeletonRows = Array.from({ length: 14 }, (_, index) => index);
    readonly skeletonLabelWidths = [
        78, 66, 74, 59, 83, 69, 76, 62, 81, 64, 72, 67, 79, 61,
    ];

    readonly searchInput =
        viewChild<ElementRef<HTMLInputElement>>('searchInput');
    readonly isSearchOpen = signal(false);
    readonly categorySearchTerm = signal('');

    readonly canSearchCategories = computed(
        () =>
            (this.isXtreamCategories() &&
                this.xtreamCategories().length > 0) ||
            (this.isStalkerCategories() &&
                this.stalkerCategories().length > 0)
    );

    readonly filteredXtreamCategories = computed(() => {
        const cats = this.xtreamCategories();
        const term = this.categorySearchTerm().trim().toLowerCase();
        if (!term) return cats;
        return cats.filter((c) => {
            const label =
                (c as { category_name?: string }).category_name ??
                (c as { name?: string }).name ??
                '';
            return label.toLowerCase().includes(term);
        });
    });

    readonly filteredStalkerCategories = computed(() => {
        const cats = this.stalkerCategories();
        const term = this.categorySearchTerm().trim().toLowerCase();
        if (!term) return cats;
        return cats.filter((c) => {
            const label =
                (c as { name?: string }).name ??
                (c as { category_name?: string }).category_name ??
                '';
            return label.toLowerCase().includes(term);
        });
    });

    readonly title = computed(() => {
        if (this.isXtreamCategories()) {
            if (this.section() === 'vod') {
                return 'WORKSPACE.CONTEXT.MOVIE_CATEGORIES';
            }
            if (this.section() === 'series') {
                return 'WORKSPACE.CONTEXT.SERIES_CATEGORIES';
            }
            return 'WORKSPACE.CONTEXT.LIVE_CATEGORIES';
        }

        if (this.isStalkerCategories()) {
            if (this.section() === 'vod') {
                return 'WORKSPACE.CONTEXT.MOVIE_CATEGORIES';
            }
            if (this.section() === 'series') {
                return 'WORKSPACE.CONTEXT.SERIES_CATEGORIES';
            }
            if (this.section() === 'radio') {
                return 'WORKSPACE.CONTEXT.RADIO_CATEGORIES';
            }
            return 'WORKSPACE.CONTEXT.LIVE_CATEGORIES';
        }

        return 'WORKSPACE.CONTEXT.CATEGORIES';
    });

    readonly subtitle = computed(() => {
        if (this.isXtreamCategories()) {
            return 'WORKSPACE.CONTEXT.XTREAM_SOURCE';
        }
        if (this.isStalkerCategories()) {
            return 'WORKSPACE.CONTEXT.STALKER_PORTAL';
        }
        return '';
    });

    constructor() {
        effect(() => {
            if (this.isSearchOpen()) {
                queueMicrotask(() => {
                    this.searchInput()?.nativeElement.focus();
                });
            }
        });
    }

    toggleCategorySearch(): void {
        const opening = !this.isSearchOpen();
        this.isSearchOpen.set(opening);
        if (!opening) {
            this.categorySearchTerm.set('');
        }
    }

    onSearchInput(event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.categorySearchTerm.set(value);
    }

    clearCategorySearch(): void {
        this.categorySearchTerm.set('');
        this.searchInput()?.nativeElement.focus();
    }

    openManageCategories(): void {
        if (!this.canManageXtreamCategories()) {
            return;
        }

        const context = this.context();
        const section = this.section();
        const contentType =
            section === 'series'
                ? 'series'
                : section === 'live'
                  ? 'live'
                  : 'vod';

        void import('@iptvnator/portal/xtream/feature').then(
            ({ CategoryManagementDialogComponent }) => {
                const dialogRef = this.dialog.open(
                    CategoryManagementDialogComponent,
                    {
                        data: {
                            playlistId: context.playlistId,
                            contentType,
                            itemCounts: this.xtreamStore.getCategoryItemCounts(),
                        },
                        width: '500px',
                        maxHeight: '90vh',
                    }
                );

                dialogRef
                    .afterClosed()
                    .pipe(takeUntilDestroyed(this.destroyRef))
                    .subscribe((result) => {
                        if (result) {
                            this.xtreamStore.reloadCategories();
                        }
                    });
            }
        );
    }

    onXtreamCategoryClicked(category: XtreamCategoryLike): void {
        if (!this.isXtreamCategoryInteractionEnabled()) {
            return;
        }

        const context = this.context();
        const section = this.section();
        const rawCategoryId = category.category_id ?? category.id;
        if (rawCategoryId === undefined || rawCategoryId === null) {
            return;
        }
        const numericCategoryId = Number(rawCategoryId);
        if (Number.isNaN(numericCategoryId)) {
            return;
        }
        const categoryId = numericCategoryId;

        if (section === 'live') {
            this.xtreamStore.setSelectedCategory(categoryId);
            const liveRouteHasCategory = hasActiveLiveCategoryRoute(
                this.router.routerState.snapshot.root
            );
            if (liveRouteHasCategory) {
                void this.router.navigate(
                    [
                        '/workspace',
                        'xtreams',
                        context.playlistId,
                        'live',
                        categoryId,
                    ],
                    {
                        queryParamsHandling: 'preserve',
                        replaceUrl: true,
                    }
                );
            }
            return;
        }

        this.xtreamStore.setSelectedItem(null);
        this.xtreamStore.setSelectedCategory(categoryId);
        this.router.navigate([
            '/workspace',
            'xtreams',
            context.playlistId,
            section,
            categoryId,
        ]);
    }

    onStalkerCategoryClicked(item: { category_id?: string | number }): void {
        const context = this.context();
        const section = this.section();
        const categoryId = String(item.category_id ?? '*');

        this.stalkerStore.setSelectedCategory(categoryId);
        this.stalkerStore.setPage(0);
        this.stalkerStore.clearSelectedItem();

        if (section === 'itv' || section === 'radio') {
            return;
        }

        if (categoryId === '*') {
            this.router.navigate([
                '/workspace',
                'stalker',
                context.playlistId,
                section,
            ]);
            return;
        }

        this.router.navigate([
            '/workspace',
            'stalker',
            context.playlistId,
            section,
            categoryId,
        ]);
    }

    private getXtreamSyncLabelKey(section: string): string {
        switch (section) {
            case 'live':
                return 'WORKSPACE.CONTEXT.XTREAM_SYNCING_LIVE';
            case 'series':
                return 'WORKSPACE.CONTEXT.XTREAM_SYNCING_SERIES';
            case 'vod':
            default:
                return 'WORKSPACE.CONTEXT.XTREAM_SYNCING_MOVIES';
        }
    }

    private getXtreamImportPhaseLabelKey(phase: string | null): string {
        switch (phase) {
            case 'preparing-content':
                return 'WORKSPACE.SHELL.XTREAM_IMPORT_PREPARING';
            case 'loading-categories':
            case 'loading-live':
            case 'loading-movies':
            case 'loading-series':
                return 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING';
            case 'saving-categories':
            case 'saving-content':
                return 'WORKSPACE.SHELL.XTREAM_IMPORT_SAVING';
            case 'restoring-favorites':
                return 'WORKSPACE.SHELL.XTREAM_IMPORT_RESTORING_FAVORITES';
            case 'restoring-recently-viewed':
                return 'WORKSPACE.SHELL.XTREAM_IMPORT_RESTORING_RECENT';
            default:
                return '';
        }
    }
}
