import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    computed,
    effect,
    inject,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    type DownloadItem,
    DownloadsService,
    PlaylistsService,
} from '@iptvnator/services';
import { EmptyStateComponent } from '@iptvnator/playlist/shared/ui';
import {
    PORTAL_SHELL_ACTIONS,
    PortalCollectionContextService,
    buildStandardCollectionCategories,
    createPortalCollectionContext,
    queryParamSignal,
} from '@iptvnator/portal/shared/util';
import type { Playlist, XtreamCategory } from '@iptvnator/shared/interfaces';
import { map, startWith, take } from 'rxjs';
import type {
    DownloadActionResult,
    DownloadItemAction,
} from './download-actions';
import { DownloadLibraryNavigationService } from './download-library-navigation.service';
import { DownloadLibraryComponent } from './download-library.component';
import { DownloadManagerActionsService } from './download-manager-actions.service';
import {
    type DownloadSeriesCardViewModel,
    buildDownloadManagerViewModel,
    normalizeDownloadFilter,
} from './download-manager.viewmodel';
import { DownloadQueueComponent } from './download-queue.component';
import { DownloadedSeriesDialogComponent } from './downloaded-series-dialog.component';

const FILTER_KEYS = {
    all: 'DOWNLOADS.FILTER.ALL',
    movie: 'DOWNLOADS.FILTER.MOVIES',
    series: 'DOWNLOADS.FILTER.SERIES',
    inProgress: 'DOWNLOADS.FILTER.IN_PROGRESS',
} as const;

@Component({
    selector: 'app-downloads',
    templateUrl: './downloads.component.html',
    styleUrl: './downloads.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        DownloadLibraryNavigationService,
        DownloadManagerActionsService,
    ],
    imports: [
        DownloadLibraryComponent,
        DownloadQueueComponent,
        EmptyStateComponent,
        MatButtonModule,
        MatDialogModule,
        MatIcon,
        MatTooltip,
        TranslatePipe,
    ],
})
export class DownloadsComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly collectionCtx = inject(PortalCollectionContextService);
    private readonly dialog = inject(MatDialog);
    private readonly navigation = inject(DownloadLibraryNavigationService);
    private readonly actions = inject(DownloadManagerActionsService);
    private readonly translate = inject(TranslateService);
    private readonly shellActions = inject(PORTAL_SHELL_ACTIONS);
    private readonly destroyRef = inject(DestroyRef);
    readonly downloadsService = inject(DownloadsService);

    readonly pendingIds = this.actions.pendingIds;
    readonly isClearing = this.actions.isClearing;
    readonly downloadFolder = this.downloadsService.downloadFolder;
    readonly downloadFolderParts = computed(() => {
        const path = this.downloadFolder();
        const separatorIndex = Math.max(
            path.lastIndexOf('/'),
            path.lastIndexOf('\\')
        );
        return separatorIndex < 0
            ? { prefix: '', tail: path }
            : {
                  prefix: path.slice(0, separatorIndex),
                  tail: path.slice(separatorIndex),
              };
    });
    readonly isAvailable = this.downloadsService.isAvailable;
    readonly isLoadingDownloads = this.downloadsService.isLoadingDownloads;
    readonly hasLoadedDownloads = this.downloadsService.hasLoadedDownloads;
    readonly playlistId = toSignal(
        this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
        { initialValue: this.route.snapshot.params['id'] ?? '' }
    );
    readonly searchTerm = queryParamSignal(this.route, 'q', (value) =>
        (value ?? '').trim()
    );
    readonly playlists = toSignal(
        this.playlistsService.getAllPlaylists().pipe(startWith(null)),
        { initialValue: null as Playlist[] | null }
    );
    readonly languageChange = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    readonly playlistItems = computed(() => this.playlists() ?? []);
    readonly playlistsLoaded = computed(() => this.playlists() !== null);
    readonly hasNoPlaylists = computed(
        () => this.playlistsLoaded() && this.playlistItems().length === 0
    );
    readonly availablePlaylistIds = computed(
        () => new Set(this.playlistItems().map(({ _id }) => _id))
    );
    readonly selectedCategoryId = this.collectionCtx.selectedCategoryId;
    readonly model = computed(() =>
        buildDownloadManagerViewModel({
            downloads: this.downloadsService.downloads(),
            playlists: this.playlistItems(),
            scopePlaylistId: this.playlistId() || undefined,
            filter: this.selectedCategoryId(),
            searchTerm: this.searchTerm(),
        })
    );
    readonly categories = computed(() => this.buildCategories());
    readonly collectionContext = createPortalCollectionContext({
        ctx: this.collectionCtx,
        categories: this.categories,
    });
    readonly hasScopedDownloads = computed(
        () => this.model().scopedItems.length > 0
    );
    readonly hasVisibleDownloads = computed(() => {
        const model = this.model();
        return (
            model.active.length +
                model.attention.length +
                model.library.length >
            0
        );
    });
    readonly showDownloadSkeleton = computed(
        () =>
            !this.hasScopedDownloads() &&
            (!this.hasLoadedDownloads() || this.isLoadingDownloads())
    );
    readonly skeletonItems = Array.from({ length: 6 }, (_, index) => index);
    readonly skeletonCards = Array.from({ length: 5 }, (_, index) => index);

    constructor() {
        void this.downloadsService.loadDownloads();
        effect(() => {
            this.playlistId();
            this.collectionContext.setCategoryId('all');
        });
    }

    setFilter(filter: string): void {
        this.collectionContext.setCategoryId(normalizeDownloadFilter(filter));
    }

    addPlaylist(): void {
        this.shellActions.openAddPlaylistDialog();
    }

    goToSources(): void {
        void this.router.navigate(['/workspace', 'sources']);
    }

    goToDashboard(): void {
        void this.router.navigate(['/workspace', 'dashboard']);
    }

    async changeFolder(): Promise<void> {
        await this.downloadsService.selectFolder();
    }

    formatBytes(bytes: number): string {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return '0 B';
        }
        return this.downloadsService.formatBytes(bytes);
    }

    async runAction(action: DownloadItemAction): Promise<DownloadActionResult> {
        return this.actions.run(action);
    }

    clearFinished(): void {
        this.actions.clearFinished(this.playlistId() || undefined);
    }

    openDownloadedSeries(group: DownloadSeriesCardViewModel): void {
        const liveMembers = computed(
            () =>
                this.model().library.find(
                    (entity): entity is DownloadSeriesCardViewModel =>
                        entity.kind === 'series' && entity.key === group.key
                )?.members ?? []
        );
        const ref = this.dialog.open(DownloadedSeriesDialogComponent, {
            data: group,
            width: 'min(720px, calc(100vw - 32px))',
            maxWidth: 'min(720px, calc(100vw - 32px))',
            maxHeight: 'min(760px, calc(100vh - 32px))',
        });
        ref.componentRef?.setInput('members', liveMembers);
        ref.componentRef?.setInput('pendingIds', this.pendingIds);
        const actionSubscription = ref.componentInstance.itemAction.subscribe(
            (action) => void this.runAction(action)
        );
        const cleanup = () => actionSubscription.unsubscribe();
        ref.afterClosed()
            .pipe(take(1), takeUntilDestroyed(this.destroyRef))
            .subscribe(cleanup);
        this.destroyRef.onDestroy(cleanup);
    }

    openOfflineDetail(item: DownloadItem): void {
        if (this.pendingIds().has(item.id)) {
            return;
        }
        void this.router.navigate([String(item.id)], {
            relativeTo: this.route,
            state: { returnUrl: this.router.url },
        });
    }

    async openInLibrary(item: DownloadItem): Promise<void> {
        if (this.pendingIds().has(item.id)) {
            return;
        }
        if (!this.availablePlaylistIds().has(item.playlistId)) {
            this.actions.showMessage('DOWNLOADS.SOURCE_PLAYLIST_MISSING', 3000);
            return;
        }
        if (!this.navigation.canOpen(item, this.availablePlaylistIds())) {
            return;
        }
        if (!(await this.navigation.open(item))) {
            this.actions.showActionError();
        }
    }

    private buildCategories(): XtreamCategory[] {
        this.languageChange();
        const counts = this.model().counts;
        const categories = buildStandardCollectionCategories({
            labels: {
                all: this.translate.instant(FILTER_KEYS.all),
                movie: this.translate.instant(FILTER_KEYS.movie),
                live: '',
                series: this.translate.instant(FILTER_KEYS.series),
            },
            counts,
        });
        categories.push({
            id: 4,
            category_id: 'in-progress',
            category_name: this.translate.instant(FILTER_KEYS.inProgress),
            count: counts.inProgress,
            parent_id: 0,
        });
        return categories;
    }
}
