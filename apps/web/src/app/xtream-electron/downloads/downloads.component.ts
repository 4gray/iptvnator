import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    OnDestroy,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from 'components';
import { firstValueFrom, map } from 'rxjs';
import { DatabaseService, PlaylistsService } from 'services';
import { XtreamCategory } from 'shared-interfaces';
import {
    DownloadItem,
    DownloadsService,
} from '../../services/downloads.service';
import { FavoritesContextService } from '../../workspace/favorites-context.service';
import { CategoryViewComponent } from '../category-view/category-view.component';

type PortalSource = 'xtream' | 'stalker';

@Component({
    selector: 'app-downloads',
    templateUrl: './downloads.component.html',
    styleUrls: ['./downloads.component.scss', '../sidebar.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CategoryViewComponent,
        MatButtonModule,
        MatIcon,
        MatProgressBarModule,
        MatTooltip,
        ResizableDirective,
        TranslatePipe,
    ],
})
export class DownloadsComponent implements OnDestroy {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly dbService = inject(DatabaseService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly favoritesCtx = inject(FavoritesContextService);
    readonly downloadsService = inject(DownloadsService);
    readonly isWorkspaceLayout =
        this.route.snapshot.data['layout'] === 'workspace';

    readonly downloads = this.downloadsService.downloads;
    readonly downloadFolder = this.downloadsService.downloadFolder;
    readonly isAvailable = this.downloadsService.isAvailable;
    readonly hasDownloads = this.downloadsService.hasDownloads;
    readonly activeCount = this.downloadsService.activeCount;
    readonly selectedCategoryId = this.favoritesCtx.selectedCategoryId;
    readonly playlistId = toSignal(
        this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
        { initialValue: this.route.snapshot.params['id'] ?? '' }
    );
    readonly searchTerm = toSignal(
        this.route.queryParamMap.pipe(
            map((params) => (params.get('q') ?? '').trim().toLowerCase())
        ),
        { initialValue: '' }
    );

    readonly scopedDownloads = computed(() => {
        const playlistId = this.playlistId();
        const downloads = this.downloads();
        return playlistId
            ? downloads.filter((item) => item.playlistId === playlistId)
            : downloads;
    });

    readonly categories = computed<XtreamCategory[]>(() => {
        const downloads = this.scopedDownloads();
        const moviesCount = downloads.filter(
            (item) => item.contentType === 'vod'
        ).length;
        const seriesCount = downloads.filter(
            (item) => item.contentType === 'episode'
        ).length;

        return [
            {
                id: 1,
                category_id: 'all',
                category_name: 'All',
                count: downloads.length,
                parent_id: 0,
            },
            {
                id: 2,
                category_id: 'movie',
                category_name: 'Movies',
                count: moviesCount,
                parent_id: 0,
            },
            {
                id: 3,
                category_id: 'series',
                category_name: 'Series',
                count: seriesCount,
                parent_id: 0,
            },
        ];
    });

    /** Filter downloads for current playlist and sort by newest first */
    readonly filteredDownloads = computed(() => {
        const selectedCategoryId = this.selectedCategoryId();
        const term = this.searchTerm();
        const downloads = this.scopedDownloads();

        const filteredByCategory = downloads.filter((item) => {
            if (selectedCategoryId === 'movie') {
                return item.contentType === 'vod';
            }
            if (selectedCategoryId === 'series') {
                return item.contentType === 'episode';
            }
            return true;
        });

        const filteredByTerm = term
            ? filteredByCategory.filter((item) =>
                  `${item.title ?? ''} ${item.errorMessage ?? ''}`
                      .toLowerCase()
                      .includes(term)
              )
            : filteredByCategory;

        // Sort by createdAt descending (newest first)
        return [...filteredByTerm].sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });
    });

    constructor() {
        effect(() => {
            const playlistId = this.playlistId();
            this.favoritesCtx.setCategoryId('all');
            void this.downloadsService.loadDownloads(playlistId || undefined);
        });

        effect(() => {
            this.favoritesCtx.setCategories(this.categories());
        });
    }

    setCategoryId(categoryId: string) {
        this.favoritesCtx.setCategoryId(categoryId);
    }

    ngOnDestroy(): void {
        this.favoritesCtx.reset();
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
            await this.downloadsService.playDownload(item.filePath);
        }
    }

    async reveal(item: DownloadItem) {
        if (item.filePath) {
            await this.downloadsService.revealFile(item.filePath);
        }
    }

    async changeFolder() {
        await this.downloadsService.selectFolder();
    }

    async clearCompleted() {
        await this.downloadsService.clearCompleted(this.playlistId());
    }

    formatEpisodeLabel(item: DownloadItem): string {
        if (item.contentType !== 'episode') return '';
        const s = item.seasonNumber?.toString().padStart(2, '0') || '00';
        const e = item.episodeNumber?.toString().padStart(2, '0') || '00';
        return `S${s}E${e}`;
    }

    isItemNavigable(item: DownloadItem): boolean {
        return !!item.playlistId && this.getTargetContentId(item) !== null;
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
        if (this.isWorkspaceLayout) {
            return ['/workspace', sourceSegment, playlistId, ...segments];
        }
        return [`/${sourceSegment}`, playlistId, ...segments];
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
}
