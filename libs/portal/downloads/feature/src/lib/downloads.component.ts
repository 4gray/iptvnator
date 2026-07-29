import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DialogService } from '@iptvnator/ui/components';
import { map, startWith } from 'rxjs';
import {
    type DownloadItem,
    DownloadsService,
    PlaylistsService,
} from '@iptvnator/services';
import { EmptyStateComponent } from '@iptvnator/playlist/shared/ui';
import { queryParamSignal } from '@iptvnator/portal/shared/util';
import { createPortalCollectionContext } from '@iptvnator/portal/shared/util';
import {
    buildStandardCollectionCategories,
    filterCollectionBucket,
    PORTAL_SHELL_ACTIONS,
} from '@iptvnator/portal/shared/util';
import { PortalCollectionContextService } from '@iptvnator/portal/shared/util';
import { Playlist } from '@iptvnator/shared/interfaces';
import { DownloadLibraryNavigationService } from './download-library-navigation.service';

const DOWNLOAD_COLLECTION_LABELS = {
    all: 'All',
    movie: 'Movies',
    live: 'Live TV',
    series: 'Series',
};

@Component({
    selector: 'app-downloads',
    templateUrl: './downloads.component.html',
    styleUrls: [
        './downloads.component.scss',
        '../../../../shared/ui/src/lib/styles/portal-sidebar.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [DownloadLibraryNavigationService],
    imports: [
        EmptyStateComponent,
        MatButtonModule,
        MatIcon,
        MatProgressBarModule,
        MatTooltip,
        TranslatePipe,
    ],
})
export class DownloadsComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly libraryNavigation = inject(
        DownloadLibraryNavigationService
    );
    private readonly collectionCtx = inject(PortalCollectionContextService);
    private readonly dialogService = inject(DialogService);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly shellActions = inject(PORTAL_SHELL_ACTIONS);
    readonly downloadsService = inject(DownloadsService);

    readonly downloads = this.downloadsService.downloads;
    readonly downloadFolder = this.downloadsService.downloadFolder;
    readonly isAvailable = this.downloadsService.isAvailable;
    readonly isLoadingDownloads = this.downloadsService.isLoadingDownloads;
    readonly hasLoadedDownloads = this.downloadsService.hasLoadedDownloads;
    readonly activeCount = this.downloadsService.activeCount;
    readonly playlistId = toSignal(
        this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
        { initialValue: this.route.snapshot.params['id'] ?? '' }
    );
    readonly searchTerm = queryParamSignal(this.route, 'q', (value) =>
        (value ?? '').trim().toLowerCase()
    );
    readonly playlists = toSignal(
        this.playlistsService.getAllPlaylists().pipe(startWith(null)),
        {
            initialValue: null as Playlist[] | null,
        }
    );
    readonly playlistsLoaded = computed(() => this.playlists() !== null);
    readonly playlistItems = computed(() => this.playlists() ?? []);
    readonly hasNoPlaylists = computed(
        () => this.playlistsLoaded() && this.playlistItems().length === 0
    );
    readonly skeletonItems = Array.from({ length: 6 }, (_, index) => index);
    readonly skeletonActionSlots = Array.from(
        { length: 4 },
        (_, index) => index
    );

    addPlaylist(): void {
        this.shellActions.openAddPlaylistDialog();
    }

    goToSources(): void {
        void this.router.navigate(['/workspace', 'sources']);
    }

    goToDashboard(): void {
        void this.router.navigate(['/workspace', 'dashboard']);
    }

    readonly scopedDownloads = computed(() => {
        const playlistId = this.playlistId();
        const downloads = this.downloads();
        return playlistId
            ? downloads.filter((item) => item.playlistId === playlistId)
            : downloads;
    });
    readonly hasScopedDownloads = computed(
        () => this.scopedDownloads().length > 0
    );
    readonly showDownloadSkeleton = computed(
        () =>
            !this.hasScopedDownloads() &&
            (!this.hasLoadedDownloads() || this.isLoadingDownloads())
    );

    readonly categories = computed(() => {
        const downloads = this.scopedDownloads();
        const moviesCount = downloads.filter(
            (item) => item.contentType === 'vod'
        ).length;
        const seriesCount = downloads.filter(
            (item) => item.contentType === 'episode'
        ).length;

        return buildStandardCollectionCategories({
            labels: DOWNLOAD_COLLECTION_LABELS,
            counts: {
                all: downloads.length,
                movie: moviesCount,
                series: seriesCount,
            },
        });
    });
    readonly collectionContext = createPortalCollectionContext({
        ctx: this.collectionCtx,
        categories: this.categories,
    });
    readonly selectedCategoryId = this.collectionContext.selectedCategoryId;
    readonly failedPosterKeys = signal<Record<string, true>>({});

    /** Filter downloads for current playlist and sort by newest first */
    readonly filteredDownloads = computed(() => {
        const term = this.searchTerm();
        const downloads = this.scopedDownloads();
        const filteredByTerm = filterCollectionBucket({
            selectedCategoryId: this.selectedCategoryId(),
            allItems: downloads,
            buckets: {
                movie: downloads.filter((item) => item.contentType === 'vod'),
                series: downloads.filter(
                    (item) => item.contentType === 'episode'
                ),
            },
            searchTerm: term,
            textOf: (item) => `${item.title ?? ''} ${item.errorMessage ?? ''}`,
        });

        // Sort by createdAt descending (newest first)
        return [...filteredByTerm].sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });
    });
    readonly hasClearableDownloads = computed(() =>
        this.scopedDownloads().some(
            (item) =>
                item.status === 'completed' ||
                item.status === 'failed' ||
                item.status === 'canceled'
        )
    );
    readonly availablePlaylistIds = computed(
        () => new Set(this.playlistItems().map((playlist) => playlist._id))
    );

    constructor() {
        effect(() => {
            this.playlistId();
            this.collectionContext.setCategoryId('all');
            void this.downloadsService.loadDownloads();
        });
    }

    getProgress(item: DownloadItem): number {
        return this.downloadsService.getProgressPercent(item);
    }

    formatBytes(bytes: number | undefined): string {
        if (!bytes) return '0 B';
        return this.downloadsService.formatBytes(bytes);
    }

    getStatusIcon(status: string): string {
        switch (status) {
            case 'queued':
                return 'schedule';
            case 'downloading':
                return 'downloading';
            case 'paused':
                return 'pause_circle';
            case 'completed':
                return 'check_circle';
            case 'failed':
                return 'error';
            case 'canceled':
                return 'cancel';
            default:
                return 'help';
        }
    }

    getStatusColor(status: string): string {
        switch (status) {
            case 'queued':
                return 'status-queued';
            case 'downloading':
                return 'status-downloading';
            case 'paused':
                return 'status-paused';
            case 'completed':
                return 'status-completed';
            case 'failed':
            case 'canceled':
                return 'status-failed';
            default:
                return '';
        }
    }

    async copyUrl(item: DownloadItem): Promise<void> {
        try {
            await navigator.clipboard.writeText(item.url);
            this.snackBar.open(
                this.translate.instant('DOWNLOADS.URL_COPIED'),
                undefined,
                { duration: 2000, horizontalPosition: 'start' }
            );
        } catch {
            this.snackBar.open(
                this.translate.instant('DOWNLOADS.URL_COPY_FAILED'),
                undefined,
                { duration: 3000, horizontalPosition: 'start' }
            );
        }
    }

    async cancel(item: DownloadItem) {
        const result = await this.downloadsService.cancelDownload(item.id);
        if (!result.success) {
            this.showActionError(result.error);
        }
    }

    async pause(item: DownloadItem) {
        const result = await this.downloadsService.pauseDownload(item.id);
        if (!result.success) {
            this.showActionError(result.error);
        }
    }

    async resume(item: DownloadItem) {
        const result = await this.downloadsService.resumeDownload(item.id);
        if (!result.success) {
            this.showActionError(result.error);
        }
    }

    async retry(item: DownloadItem) {
        const result = await this.downloadsService.retryDownload(item.id);
        if (!result.success) {
            this.showActionError(result.error);
        }
    }

    async remove(item: DownloadItem) {
        const result = await this.downloadsService.removeDownload(item.id);
        if (!result.success) {
            this.showActionError(result.error);
        }
    }

    async play(item: DownloadItem) {
        if (item.filePath) {
            const result = await this.downloadsService.playDownload(
                item.filePath
            );
            if (!result.success) {
                this.handleFileActionError(result.error);
            }
        }
    }

    async reveal(item: DownloadItem) {
        if (item.filePath) {
            const result = await this.downloadsService.revealFile(
                item.filePath
            );
            if (!result.success) {
                this.handleFileActionError(result.error);
            }
        }
    }

    async changeFolder() {
        await this.downloadsService.selectFolder();
    }

    async clearCompleted() {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant(
                'DOWNLOADS.CLEAR_COMPLETED_DIALOG.TITLE'
            ),
            message: this.translate.instant(
                'DOWNLOADS.CLEAR_COMPLETED_DIALOG.MESSAGE'
            ),
            confirmLabel: this.translate.instant('DOWNLOADS.CLEAR_COMPLETED'),
            onConfirm: async (): Promise<void> => {
                await this.downloadsService.clearCompleted(this.playlistId());
            },
        });
    }

    formatEpisodeLabel(item: DownloadItem): string {
        if (item.contentType !== 'episode') return '';
        const s = item.seasonNumber?.toString().padStart(2, '0') || '00';
        const e = item.episodeNumber?.toString().padStart(2, '0') || '00';
        return `S${s}E${e}`;
    }

    hasPoster(item: DownloadItem): boolean {
        return (
            !!item.posterUrl &&
            !this.failedPosterKeys()[this.getPosterKey(item)]
        );
    }

    markPosterFailed(item: DownloadItem): void {
        const key = this.getPosterKey(item);
        this.failedPosterKeys.update((state) => {
            if (state[key]) {
                return state;
            }

            return {
                ...state,
                [key]: true,
            };
        });
    }

    getPosterPlaceholderIcon(item: DownloadItem): string {
        return item.contentType === 'episode' ? 'video_library' : 'movie';
    }

    hasSourcePlaylist(item: DownloadItem): boolean {
        return this.availablePlaylistIds().has(item.playlistId);
    }

    isItemNavigable(item: DownloadItem): boolean {
        return this.libraryNavigation.canOpen(
            item,
            this.availablePlaylistIds()
        );
    }

    onItemCardKeydown(event: KeyboardEvent, item: DownloadItem): void {
        if (event.target !== event.currentTarget) {
            return;
        }

        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();
        void this.openInLibrary(item);
    }

    async openInLibrary(item: DownloadItem): Promise<void> {
        if (!this.hasSourcePlaylist(item)) {
            this.snackBar.open(
                this.translate.instant('DOWNLOADS.SOURCE_PLAYLIST_MISSING'),
                undefined,
                { duration: 3000, horizontalPosition: 'start' }
            );
            return;
        }

        if (!this.isItemNavigable(item)) {
            return;
        }

        await this.libraryNavigation.open(item);
    }

    private getPosterKey(item: DownloadItem): string {
        return `${item.id}:${item.posterUrl ?? ''}`;
    }

    private showActionError(error?: string): void {
        const message = error
            ? `${this.translate.instant('DOWNLOADS.ACTION_FAILED')}: ${error}`
            : this.translate.instant('DOWNLOADS.ACTION_FAILED');

        this.snackBar.open(message, undefined, {
            duration: 4000,
            horizontalPosition: 'start',
        });
    }

    private handleFileActionError(error?: string): void {
        const message =
            error === 'File not found'
                ? this.translate.instant('DOWNLOADS.FILE_NOT_FOUND')
                : this.translate.instant('DOWNLOADS.FILE_ACTION_ERROR');

        this.snackBar.open(message, undefined, {
            duration: 3000,
            horizontalPosition: 'start',
        });
    }
}
