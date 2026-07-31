import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DownloadsService, SettingsStore } from '@iptvnator/services';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    PortalDetailShellComponent,
} from '@iptvnator/ui/components';
import { DownloadLibraryNavigationService } from '../download-library-navigation.service';
import { DownloadManagerActionsService } from '../download-manager-actions.service';
import {
    buildDownloadOfflineDetail,
    type DownloadOfflineSeason,
} from './download-offline-detail.viewmodel';
import {
    boundedOfflinePeople,
    offlineDetailRepresentative,
    offlineDurationLabel,
    offlineEpisodeCoordinate,
    offlineEpisodeCount,
    offlineEpisodeTitle,
    offlineFileByteCount,
    offlineMetadataResolutionKey,
    offlinePersonTrackKey,
    offlinePositiveFinite,
    offlineSeasonTestId,
    type OfflineDetailItem,
} from './download-offline-detail.presentation';
import { DownloadOfflineMetadataResolutionService } from './download-offline-metadata-resolution.service';
import { DownloadOfflineRouteNavigationService } from './download-offline-route-navigation.service';
import { DownloadOfflineFileCoordinatorService } from './download-offline-file-coordinator.service';
import { DownloadOfflineProviderCoordinatorService } from './download-offline-provider-coordinator.service';
import { createDownloadOfflineRouteContext } from './download-offline-route-context';
import { DownloadOfflineSeasonSelectionService } from './download-offline-season-selection.service';

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
        DownloadOfflineFileCoordinatorService,
        DownloadOfflineMetadataResolutionService,
        DownloadOfflineProviderCoordinatorService,
        DownloadOfflineRouteNavigationService,
        DownloadOfflineSeasonSelectionService,
    ],
})
export class DownloadOfflineDetailComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly downloadsService = inject(DownloadsService);
    private readonly settings = inject(SettingsStore);
    private readonly actions = inject(DownloadManagerActionsService);
    private readonly metadataResolution = inject(
        DownloadOfflineMetadataResolutionService
    );
    private readonly routeNavigation = inject(
        DownloadOfflineRouteNavigationService
    );
    private readonly fileCoordinator = inject(
        DownloadOfflineFileCoordinatorService
    );
    private readonly providerCoordinator = inject(
        DownloadOfflineProviderCoordinatorService
    );
    private readonly seasonSelection = inject(
        DownloadOfflineSeasonSelectionService
    );

    readonly pendingIds = this.actions.pendingIds;
    readonly routeContext = createDownloadOfflineRouteContext(this.route);
    readonly downloadId = computed(() => this.routeContext().downloadId);
    readonly detail = computed(() => {
        const downloadId = this.downloadId();
        return downloadId === undefined
            ? undefined
            : buildDownloadOfflineDetail({
                  downloadId,
                  downloads: this.downloadsService.downloads(),
              });
    });
    readonly metadataResolutionKey = computed(() =>
        offlineMetadataResolutionKey(
            this.detail(),
            this.downloadId(),
            this.settings.language()
        )
    );
    readonly currentItem = computed(() =>
        offlineDetailRepresentative(this.detail())
    );
    readonly providerItem = computed(() => {
        const item = this.currentItem();
        const snapshot = this.detail()?.snapshot;
        return item && snapshot
            ? { ...item, metadataSnapshot: snapshot }
            : item;
    });
    readonly selectedRow = computed(() =>
        this.downloadsService
            .downloads()
            .find(({ id }) => id === this.downloadId())
    );
    readonly metadata = computed(() => {
        const detail = this.detail();
        if (!detail) return undefined;
        const resolved = this.metadataResolution.resolution();
        return resolved.key === this.metadataResolutionKey()
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
    readonly providerState = this.providerCoordinator.state;
    readonly canOpenInPortal = computed(
        () => this.providerState().status === 'available'
    );
    readonly providerLoading = computed(
        () => this.providerState().status === 'loading'
    );
    readonly providerPending = computed(
        () => this.providerState().status === 'opening'
    );
    readonly providerUnavailable = computed(
        () => this.providerState().status === 'unavailable'
    );
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
    readonly redirectFailed = computed(() =>
        this.fileCoordinator.isRedirectFailed(this.routeContext())
    );
    readonly seasons = computed(() => {
        const detail = this.detail();
        return detail?.kind === 'series' ? detail.seasons : [];
    });
    readonly selectedSeason = computed(() => {
        return this.seasonSelection.selected(
            this.routeContext(),
            this.seasons()
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
    readonly personTrackKey = offlinePersonTrackKey;

    constructor() {
        void this.downloadsService.loadDownloads();
        this.metadataResolution.connect(
            this.metadataResolutionKey,
            this.detail
        );
        this.providerCoordinator.connect(this.routeContext, this.providerItem);
        this.seasonSelection.connect(this.routeContext, this.seasons);
        this.fileCoordinator.connect({
            detail: this.detail,
            hasLoaded: this.downloadsService.hasLoadedDownloads,
            isLoading: this.downloadsService.isLoadingDownloads,
            route: this.routeContext,
            selectedRow: this.selectedRow,
        });
    }

    selectSeason(season: DownloadOfflineSeason): void {
        this.seasonSelection.select(this.routeContext(), season);
    }

    isSelectedSeason(season: DownloadOfflineSeason): boolean {
        return this.selectedSeason() === season;
    }

    seasonTabId(season: DownloadOfflineSeason): string {
        return this.seasonSelection.tabId(season);
    }

    seasonTabIndex(season: DownloadOfflineSeason): number {
        return this.isSelectedSeason(season) ? 0 : -1;
    }

    onSeasonKeydown(event: KeyboardEvent, index: number): void {
        this.seasonSelection.handleKeydown(
            event,
            index,
            this.routeContext(),
            this.seasons()
        );
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
        await this.fileCoordinator.runFileAction(type, item, this.routeContext);
    }

    async viewInPortal(): Promise<void> {
        const result = await this.providerCoordinator.open(
            this.routeContext(),
            this.providerItem()
        );
        if (result === 'failed') {
            this.actions.showActionError();
        }
    }

    goBack(): void {
        this.routeNavigation.back();
    }

    async retryRedirect(): Promise<void> {
        await this.fileCoordinator.retry(this.routeContext());
    }
}
