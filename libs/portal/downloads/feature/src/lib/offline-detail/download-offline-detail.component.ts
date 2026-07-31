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
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    type DownloadItem,
    DownloadsService,
    PlaylistsService,
} from '@iptvnator/services';
import type { Playlist } from '@iptvnator/shared/interfaces';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    PortalDetailShellComponent,
} from '@iptvnator/ui/components';
import { catchError, map, of, startWith } from 'rxjs';
import { DownloadLibraryNavigationService } from '../download-library-navigation.service';
import { DownloadManagerActionsService } from '../download-manager-actions.service';
import {
    buildDownloadOfflineDetail,
    type DownloadOfflineSeason,
} from './download-offline-detail.viewmodel';
import {
    boundedOfflinePeople,
    offlineDetailIdentity,
    offlineDetailRepresentative,
    offlineDurationLabel,
    offlineEpisodeCoordinate,
    offlineEpisodeCount,
    offlineEpisodeTitle,
    offlineFileByteCount,
    offlineHasLocalFile,
    offlinePositiveFinite,
    offlineSeasonKey,
    offlineSeasonTestId,
    parseOfflineDownloadId,
    type OfflineDetailItem,
    type OfflineSelectedSeason,
} from './download-offline-detail.presentation';
import { DownloadOfflineMetadataResolutionService } from './download-offline-metadata-resolution.service';
import { DownloadOfflineRouteNavigationService } from './download-offline-route-navigation.service';

@Component({
    selector: 'app-download-offline-detail',
    imports: [
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatButtonModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        PortalDetailShellComponent,
        TranslatePipe,
    ],
    templateUrl: './download-offline-detail.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './download-offline-detail.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        DownloadLibraryNavigationService,
        DownloadManagerActionsService,
        DownloadOfflineMetadataResolutionService,
        DownloadOfflineRouteNavigationService,
    ],
})
export class DownloadOfflineDetailComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly downloadsService = inject(DownloadsService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly actions = inject(DownloadManagerActionsService);
    private readonly navigation = inject(DownloadLibraryNavigationService);
    private readonly metadataResolution = inject(
        DownloadOfflineMetadataResolutionService
    );
    private readonly routeNavigation = inject(
        DownloadOfflineRouteNavigationService
    );
    private readonly selectedSeasonState = signal<
        OfflineSelectedSeason | undefined
    >(undefined);
    private redirectedUnavailableId?: number;

    readonly pendingIds = this.actions.pendingIds;
    readonly downloadId = toSignal(
        this.route.paramMap.pipe(
            map((params) => parseOfflineDownloadId(params.get('downloadId')))
        ),
        {
            initialValue: parseOfflineDownloadId(
                this.route.snapshot.paramMap.get('downloadId')
            ),
        }
    );
    readonly detail = computed(() => {
        const downloadId = this.downloadId();
        return downloadId === undefined
            ? undefined
            : buildDownloadOfflineDetail({
                  downloadId,
                  downloads: this.downloadsService.downloads(),
              });
    });
    readonly currentIdentity = computed(() =>
        offlineDetailIdentity(this.detail())
    );
    readonly currentItem = computed(() =>
        offlineDetailRepresentative(this.detail())
    );
    readonly selectedRow = computed(() =>
        this.downloadsService
            .downloads()
            .find(({ id }) => id === this.downloadId())
    );
    readonly metadata = computed(() => {
        const detail = this.detail();
        if (!detail) return undefined;
        const resolved = this.metadataResolution.resolution();
        return resolved.identity === this.currentIdentity()
            ? (resolved.snapshot ?? detail.snapshot)
            : detail.snapshot;
    });
    readonly title = computed(
        () => this.metadata()?.title?.trim() || this.currentItem()?.title || ''
    );
    readonly description = computed(() => this.metadata()?.plot?.trim());
    readonly posterUrl = computed(
        () =>
            this.metadata()?.posterUrl?.trim() ||
            this.currentItem()?.posterUrl?.trim()
    );
    readonly backdropUrl = computed(() => this.metadata()?.backdropUrl?.trim());
    readonly genres = computed(() =>
        (this.metadata()?.genres ?? [])
            .map((genre) => genre.trim())
            .filter(Boolean)
            .slice(0, 5)
    );
    readonly cast = computed(() => boundedOfflinePeople(this.metadata()?.cast));
    readonly creators = computed(() =>
        boundedOfflinePeople(this.metadata()?.creators)
    );
    readonly playlists = toSignal(
        this.playlistsService.getAllPlaylists().pipe(
            startWith(null),
            catchError(() => of([]))
        ),
        { initialValue: null as Playlist[] | null }
    );
    readonly availablePlaylistIds = computed(
        () => new Set((this.playlists() ?? []).map(({ _id }) => _id))
    );
    readonly canOpenInPortal = computed(() => {
        const item = this.currentItem();
        return (
            item !== undefined &&
            this.playlists() !== null &&
            this.navigation.canOpen(
                item as DownloadItem,
                this.availablePlaylistIds()
            )
        );
    });
    readonly showLoading = computed(
        () =>
            !this.detail() &&
            (!this.downloadsService.hasLoadedDownloads() ||
                this.downloadsService.isLoadingDownloads())
    );
    readonly showNotFound = computed(
        () =>
            !this.detail() &&
            !this.showLoading() &&
            (!this.selectedRow() || this.selectedRow()?.status !== 'completed')
    );
    readonly seasons = computed(() => {
        const detail = this.detail();
        return detail?.kind === 'series' ? detail.seasons : [];
    });
    readonly selectedSeason = computed(() => {
        const seasons = this.seasons();
        const selection = this.selectedSeasonState();
        const identity = this.currentIdentity();
        if (!selection || selection.identity !== identity) return seasons[0];
        return (
            seasons.find(
                (season) => offlineSeasonKey(season) === selection.key
            ) ?? seasons[0]
        );
    });
    readonly count = computed(() => offlineEpisodeCount(this.selectedSeason()));
    readonly movieFileSize = computed(() => {
        const detail = this.detail();
        return detail?.kind === 'movie'
            ? this.formatItemBytes(detail.item)
            : undefined;
    });
    readonly durationLabel = computed(() =>
        offlineDurationLabel(this.metadata()?.durationMinutes)
    );
    readonly seasonTestId = offlineSeasonTestId;
    readonly episodeCoordinate = offlineEpisodeCoordinate;
    readonly episodeTitle = offlineEpisodeTitle;
    readonly positiveFinite = offlinePositiveFinite;

    constructor() {
        void this.downloadsService.loadDownloads();
        this.metadataResolution.connect(this.detail, this.currentIdentity);
        this.redirectUnavailableRowsReactively();
    }

    selectSeason(season: DownloadOfflineSeason): void {
        const identity = this.currentIdentity();
        if (identity) {
            this.selectedSeasonState.set({
                identity,
                key: offlineSeasonKey(season),
            });
        }
    }

    isSelectedSeason(season: DownloadOfflineSeason): boolean {
        return this.selectedSeason() === season;
    }

    isPending(item: OfflineDetailItem): boolean {
        return this.pendingIds().has(item.id);
    }

    formatItemBytes(item: OfflineDetailItem): string | undefined {
        const bytes = offlineFileByteCount(item);
        return bytes === undefined
            ? undefined
            : this.downloadsService.formatBytes(bytes);
    }

    async runFileAction(
        type: 'play' | 'reveal',
        item: OfflineDetailItem
    ): Promise<void> {
        const identity = this.currentIdentity();
        await this.actions.run({ type, item: item as DownloadItem });
        if (identity !== this.currentIdentity()) return;
        const live = this.downloadsService
            .downloads()
            .find(({ id }) => id === item.id);
        if (!offlineHasLocalFile(live)) {
            await this.routeNavigation.toManager(true);
        }
    }

    async viewInPortal(): Promise<void> {
        const item = this.currentItem();
        if (!item || !this.canOpenInPortal()) return;
        if (!(await this.navigation.open(item as DownloadItem))) {
            this.actions.showActionError();
        }
    }

    goBack(): void {
        this.routeNavigation.back();
    }

    private redirectUnavailableRowsReactively(): void {
        effect(() => {
            const id = this.downloadId();
            const row = this.selectedRow();
            const loaded = this.downloadsService.hasLoadedDownloads();
            const loading = this.downloadsService.isLoadingDownloads();
            if (
                id === undefined ||
                !loaded ||
                loading ||
                !row ||
                row.status !== 'completed' ||
                this.detail() ||
                this.redirectedUnavailableId === id
            ) {
                return;
            }
            this.redirectedUnavailableId = id;
            void this.routeNavigation.toManager(true);
        });
    }
}
