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
import { firstValueFrom, map } from 'rxjs';
import {
    DatabaseService,
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

type PortalSource = 'xtream' | 'stalker';
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
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
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
    readonly playlists = toSignal(this.playlistsService.getAllPlaylists(), {
        initialValue: null as Playlist[] | null,
    });
    readonly playlistsLoaded = computed(() => this.playlists() !== null);
    readonly playlistItems = computed(() => this.playlists() ?? []);
    readonly hasNoPlaylists = computed(
        () => this.playlistsLoaded() && this.playlistItems().length === 0
    );
    readonly skeletonItems = Array.from({ length: 6 }, (_, index) => index);
    readonly skeletonActionSlots = Array.from({ length: 4 }, (_, index) => index);

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
            const playlistId = this.playlistId();
            this.collectionContext.setCategoryId('all');
            void this.downloadsService.loadDownloads(playlistId || undefined);
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
        await this.downloadsService.cancelDownload(item.id);
    }

    async retry(item: DownloadItem) {
        await this.downloadsService.retryDownload(item.id);
    }

    async remove(item: DownloadItem) {
        await this.downloadsService.removeDownload(item.id);
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
            const result = await this.downloadsService.revealFile(item.filePath);
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
        return !!item.posterUrl && !this.failedPosterKeys()[this.getPosterKey(item)];
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
        return (
            !!item.playlistId &&
            this.hasSourcePlaylist(item) &&
            this.getTargetContentId(item) !== null
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

        const source = await this.resolveSourceType(item.playlistId);
        if (!source) {
            return;
        }

        if (source === 'xtream') {
            await this.openXtreamItem(item);
            return;
        }

        await this.openStalkerItem(item);
    }

    private getTargetContentId(item: DownloadItem): number | null {
        const id =
            item.contentType === 'episode'
                ? (item.seriesXtreamId ?? item.xtreamId)
                : item.xtreamId;
        const numeric = Number(id);
        return Number.isFinite(numeric) ? numeric : null;
    }

    private buildPlaylistRoute(
        source: PortalSource,
        playlistId: string,
        segments: Array<string | number>
    ): Array<string | number> {
        const sourceSegment = source === 'stalker' ? 'stalker' : 'xtreams';
        return ['/workspace', sourceSegment, playlistId, ...segments];
    }

    private async resolveSourceType(
        playlistId: string
    ): Promise<PortalSource | null> {
        try {
            const playlist = await firstValueFrom(
                this.playlistsService.getPlaylistById(playlistId)
            );

            if (!playlist) {
                return null;
            }

            if (playlist.portalUrl && playlist.macAddress) {
                return 'stalker';
            }

            return 'xtream';
        } catch {
            return null;
        }
    }

    private async openXtreamItem(item: DownloadItem): Promise<void> {
        const targetId = this.getTargetContentId(item);
        if (targetId === null) return;

        const contentType = item.contentType === 'episode' ? 'series' : 'vod';
        const content = await this.dbService.getContentByXtreamId(
            targetId,
            item.playlistId
        );
        const categoryId = content?.category_id;

        if (categoryId === null || categoryId === undefined) {
            await this.router.navigate(
                this.buildPlaylistRoute('xtream', item.playlistId, [
                    contentType,
                ])
            );
            return;
        }

        await this.router.navigate(
            this.buildPlaylistRoute('xtream', item.playlistId, [
                contentType,
                String(categoryId),
                String(targetId),
            ])
        );
    }

    private normalizePortalItemId(value: unknown): string {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        return raw.includes(':') ? raw.split(':')[0] : raw;
    }

    private normalizeStalkerCategoryId(
        value: unknown,
        fallback: 'vod' | 'series'
    ): 'vod' | 'series' | 'itv' {
        const normalized = String(value ?? '').toLowerCase();
        if (normalized === 'movie') return 'vod';
        if (
            normalized === 'vod' ||
            normalized === 'series' ||
            normalized === 'itv'
        ) {
            return normalized;
        }
        return fallback;
    }

    private findMatchingStalkerRecentItem(
        items: Array<Record<string, unknown>>,
        targetId: number
    ): Record<string, unknown> | undefined {
        const expectedId = String(targetId);
        return items.find((recentItem) => {
            const candidates = [
                recentItem['id'],
                recentItem['movie_id'],
                recentItem['series_id'],
                recentItem['stream_id'],
            ];

            return candidates.some(
                (candidate) =>
                    this.normalizePortalItemId(candidate) === expectedId
            );
        });
    }

    private async buildStalkerOpenState(
        item: DownloadItem,
        targetId: number,
        fallbackCategory: 'vod' | 'series'
    ): Promise<Record<string, unknown>> {
        try {
            const items = (await firstValueFrom(
                this.playlistsService.getPortalRecentlyViewed(item.playlistId)
            )) as Array<Record<string, unknown>>;

            const matched = this.findMatchingStalkerRecentItem(items, targetId);

            if (matched) {
                return {
                    ...matched,
                    id:
                        matched['id'] ??
                        matched['series_id'] ??
                        matched['movie_id'] ??
                        String(targetId),
                    category_id: this.normalizeStalkerCategoryId(
                        matched['category_id'],
                        fallbackCategory
                    ),
                    title: matched['title'] ?? item.title,
                    name: matched['name'] ?? matched['o_name'] ?? item.title,
                };
            }
        } catch {
            // Ignore and use fallback state below.
        }

        return {
            id: String(targetId),
            category_id: fallbackCategory,
            title: item.title,
            name: item.title,
            o_name: item.title,
            cover: item.posterUrl,
            logo: item.posterUrl,
        };
    }

    private async openStalkerItem(item: DownloadItem): Promise<void> {
        const targetId = this.getTargetContentId(item);
        if (targetId === null) return;

        const fallbackCategory =
            item.contentType === 'episode' ? 'series' : 'vod';
        const openRecentItem = await this.buildStalkerOpenState(
            item,
            targetId,
            fallbackCategory
        );

        await this.router.navigate(
            this.buildPlaylistRoute('stalker', item.playlistId, ['recent']),
            {
                state: { openRecentItem },
            }
        );
    }

    private getPosterKey(item: DownloadItem): string {
        return `${item.id}:${item.posterUrl ?? ''}`;
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
