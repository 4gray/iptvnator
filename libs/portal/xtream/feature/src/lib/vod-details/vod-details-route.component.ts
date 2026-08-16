import { Location, NgTemplateOutlet, SlicePipe } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    OnInit,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    DetailActionsTemplateDirective,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    DialogService,
    PortalDetailShellComponent,
    ViewInPortalActionComponent,
    VodSourcesChipComponent,
} from '@iptvnator/ui/components';
import { SafePipe } from '@iptvnator/pipes';
import {
    createDiscoverFacetNavigation,
    createLogger,
    isProviderOnlyDetailState,
} from '@iptvnator/portal/shared/util';
import {
    registerContentMetadataBackfill,
    resolveXtreamVodPlaybackSource,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
    DownloadsService,
    SettingsStore,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import {
    getXtreamVodInfo,
    normalizeTitleKeys,
    playlistDisplayLabel,
    reportsPlaybackFailures,
    TmdbEnrichedCastMember,
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodInfo,
    XtreamVodStream,
    youtubeEmbedUrl,
    type PlaybackPositionData,
    type VodSourceCandidate,
    type VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';
import {
    SimilarCatalogItem,
    matchRecommendationsToCatalog,
} from '../tmdb-similar.util';
import {
    buildXtreamVodFallbackViewModel,
    hasUsableXtreamVodMetadata,
} from './vod-details-fallback.util';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodDetailsMultiSourceUiService } from './vod-details-multi-source-ui.service';
import { VodDetailsDownloadsService } from './vod-details-downloads.service';
import { VodDetailsSimilarService } from './vod-details-similar.service';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';
import { resolveVodMultiSourceMovie } from './vod-multi-source-identity';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';

type XtreamVodIdentityItem = XtreamVodDetails & {
    readonly id?: number | string;
    readonly stream_id?: number | string;
    readonly xtream_id?: number | string;
};

function resolveVodIdentity(item: XtreamVodDetails): number | null {
    const candidate = item as XtreamVodIdentityItem;
    const value =
        item.movie_data?.stream_id ??
        candidate.xtream_id ??
        candidate.stream_id ??
        candidate.id;
    const id = typeof value === 'string' ? Number(value) : value;

    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
        ? id
        : null;
}

@Component({
    templateUrl: './vod-details-route.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './vod-details-route.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        VodDetailsPlaybackService,
        VodMultiSourceHostService,
        VodDetailsMultiSourceUiService,
        VodDetailsSimilarService,
        VodDetailsDownloadsService,
    ],
    imports: [
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatIcon,
        MatTooltip,
        NgTemplateOutlet,
        PortalDetailShellComponent,
        ViewInPortalActionComponent,
        SafePipe,
        SlicePipe,
        TranslateModule,
        PortalInlinePlayerComponent,
        VodSourcesChipComponent,
    ],
})
export class VodDetailsRouteComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly settingsStore = inject(SettingsStore);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly crossPortalSimilar = inject(CrossPortalSimilarService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly downloadsService = inject(DownloadsService);
    private readonly dialogService = inject(DialogService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly playback = inject(VodDetailsPlaybackService);
    /** Alternative sources for this movie in the user's other playlists */
    readonly multiSource = inject(VodMultiSourceHostService);
    private readonly msUi = inject(VodDetailsMultiSourceUiService);
    private readonly similar = inject(VodDetailsSimilarService);
    private readonly downloads = inject(VodDetailsDownloadsService);
    private readonly logger = createLogger('VodDetailsRoute');
    /** `playlistId:vodId` of the last initialized detail view */
    private readonly lastInitKey = signal<string | null>(null);
    readonly inlinePlayback = this.playback.inlinePlayback;
    readonly vodPlaybackPosition = this.playback.vodPlaybackPosition;
    /** The route copy's own row — what Resume acts on. */
    readonly routePlaybackPosition = this.playback.routePlaybackPosition;

    /**
     * Reactive route params: the component is reused when navigating
     * between two VOD details (e.g. via the Similar rail), so computeds
     * must not read the one-shot snapshot.
     */
    private readonly routeParams = toSignal(this.route.params, {
        initialValue: this.route.snapshot.params,
    });

    readonly theme = this.settingsStore.theme;
    readonly isElectron = this.downloadsService.isAvailable;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly selectedVodId = computed(() => Number(this.routeParams().vodId));
    readonly playbackSessionKey = computed(() => {
        const sourceId = this.xtreamStore.currentPlaylist()?.id;
        const contentId = this.selectedVodId();
        return sourceId && Number.isFinite(contentId) && contentId > 0
            ? createPlaybackSessionKey({ kind: 'vod', sourceId, contentId })
            : '';
    });
    readonly providerOnly = computed(() => {
        this.routeParams();
        return isProviderOnlyDetailState(window.history.state);
    });
    readonly selectedItem = computed(() => {
        const item =
            this.xtreamStore.selectedItem() as unknown as XtreamVodDetails | null;

        return item && resolveVodIdentity(item) === this.selectedVodId()
            ? item
            : null;
    });
    private readonly scopedVodCategories = computed(() => {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        return playlistId &&
            this.xtreamStore.vodCategoriesPlaylistId() === playlistId
            ? this.xtreamStore.vodCategories()
            : [];
    });
    private readonly scopedVodStreams = computed(() => {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        return playlistId &&
            this.xtreamStore.vodStreamsPlaylistId() === playlistId
            ? this.xtreamStore.vodStreams()
            : [];
    });
    readonly selectedCategory = computed<Partial<XtreamCategory> | null>(() => {
        const categoryId = this.routeParams().categoryId;
        if (!categoryId) {
            return null;
        }

        return (
            this.scopedVodCategories().find(
                (category) =>
                    String(
                        (
                            category as XtreamCategory & {
                                id?: string | number;
                            }
                        ).category_id ??
                            (
                                category as XtreamCategory & {
                                    id?: string | number;
                                }
                            ).id
                    ) === String(categoryId)
            ) ?? null
        );
    });
    readonly selectedCatalogItem = computed<
        | (Partial<XtreamVodStream> & {
              id?: string | number;
              poster_url?: string;
              title?: string;
              xtream_id?: string | number;
          })
        | null
    >(() => {
        const vodId = this.selectedVodId();
        if (!Number.isFinite(vodId) || vodId <= 0) {
            return null;
        }

        return (
            this.scopedVodStreams().find(
                (item) =>
                    Number(
                        (
                            item as XtreamVodStream & {
                                id?: string | number;
                                xtream_id?: string | number;
                            }
                        ).xtream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).stream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).id
                    ) === vodId
            ) ?? null
        );
    });
    /** Movie identity for multi-source discovery; null until a title exists */
    private readonly multiSourceMovie = computed(() => {
        // Electron stores categories under `name`, the live API under
        // `category_name` — the same duality the fallback view reads.
        const category = this.selectedCategory() as {
            name?: string;
            category_name?: string;
        } | null;

        return resolveVodMultiSourceMovie({
            playlistId: this.xtreamStore.currentPlaylist()?.id,
            // `title` is the alias the Xtream data source actually writes
            // (createPlaylist maps name -> title), so reading only `name`
            // would fall back to the raw playlist UUID in the sources list.
            playlistName:
                this.xtreamStore.currentPlaylist()?.name ??
                this.xtreamStore.currentPlaylist()?.title,
            vodId: this.selectedVodId(),
            vodInfo: this.selectedVodInfo(),
            catalogItem: this.selectedCatalogItem(),
            containerExtension:
                this.selectedItem()?.movie_data?.container_extension,
            categoryName: category?.name ?? category?.category_name ?? null,
        });
    });
    readonly selectedVodInfo = computed(() => {
        const item = this.selectedItem();
        return item && hasUsableXtreamVodMetadata(item)
            ? getXtreamVodInfo(item)
            : null;
    });
    readonly playableVodItem = computed(() => {
        const item = this.selectedItem();
        return item && resolveXtreamVodPlaybackSource(item) ? item : null;
    });
    readonly fallbackView = computed(() => {
        const item = this.selectedItem();
        if (!item || this.selectedVodInfo()) {
            return null;
        }

        return buildXtreamVodFallbackViewModel({
            vodDetails: item,
            catalogItem: this.selectedCatalogItem(),
            category: this.selectedCategory(),
            vodId: this.selectedVodId(),
        });
    });
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly matchedExternalPlayback = this.playback.matchedExternalPlayback;
    readonly externalPrimaryLabel = this.playback.externalPrimaryLabel;
    readonly externalPrimaryIcon = this.playback.externalPrimaryIcon;
    readonly isExternalLaunchPending = this.playback.isExternalLaunchPending;
    readonly isExternalStopAction = this.playback.isExternalStopAction;
    readonly externalPrimaryButtonState =
        this.playback.externalPrimaryButtonState;
    readonly vodPlaybackProgress = this.playback.vodPlaybackProgress;

    readonly hasPlaybackPosition = this.msUi.hasPlaybackPosition;

    private readonly downloadedFromLibrary = this.downloads.isDownloaded;
    readonly isDownloaded = computed(
        () => !this.providerOnly() && this.downloadedFromLibrary()
    );
    readonly isDownloading = this.downloads.isDownloading;
    readonly isPausedDownload = this.downloads.isPausedDownload;
    readonly downloadPercent = this.downloads.downloadPercent;
    readonly isOfflinePrimary = computed(
        () =>
            this.isDownloaded() && this.externalPrimaryButtonState() === 'idle'
    );

    /** 2πr of the r=15.5 progress-ring circle in its 36×36 viewBox. */
    readonly downloadRingCircumference = 2 * Math.PI * 15.5;

    /**
     * Dash offset that leaves the arc at the real percent — or a fixed
     * quarter arc when the total size is unknown and the ring spins instead.
     */
    readonly downloadRingOffset = computed(() => {
        const percent = this.downloadPercent();
        return percent === null
            ? this.downloadRingCircumference * 0.75
            : this.downloadRingCircumference * (1 - percent / 100);
    });

    /** Drives the heart's brief scale pulse when favoriting toggles. */
    readonly favoritePulse = signal(false);
    private favoritePulseTimer: ReturnType<typeof setTimeout> | null = null;

    readonly trailerEmbedUrl = computed(() =>
        youtubeEmbedUrl(this.selectedVodInfo()?.youtube_trailer)
    );

    readonly similarItems = this.similar.similarItems;
    readonly similarInPortals = this.similar.similarInPortals;

    /**
     * The alternative the player is on, in playback's terms — null while the
     * route's own source is playing, which the matcher already recognises.
     */

    constructor() {
        this.downloads.bind({ routeContentId: this.selectedVodId });

        this.similar.bind({
            vodInfo: this.selectedVodInfo,
            routeContentId: this.selectedVodId,
        });

        this.msUi.bind({
            routeContentId: this.selectedVodId,
            movieTitle: computed(() => this.multiSourceMovie()?.title ?? ''),
        });

        this.playback.bind({
            vodId: this.selectedVodId,
            vodInfo: this.selectedVodInfo,
            activeSource: this.msUi.activeAlternativeSource,
            supersedePendingSwitch: () =>
                this.multiSource.supersedePendingSwitch(),
        });

        effect(() => {
            const position = this.playback.vodPlaybackPosition();
            if (!position) {
                return;
            }

            if (this.inlinePlayback()) {
                // Seeding only: the inline player reports the live timecode
                // itself, and this stored value lags it by up to the save
                // throttle — applying it would rewind the switch. Before the
                // first timeupdate there is nothing to protect, so a switch
                // made straight off the Resume button still resumes.
                this.multiSource.seedResumePosition(position.positionSeconds);
                return;
            }

            // MPV and VLC have no timeupdate to report; this polled position
            // IS their live one, so a source switch after an hour in an
            // external player must not rewind to where it started.
            this.multiSource.reportPosition(position.positionSeconds);
        });
        this.multiSource.bind({
            // Route every switch through the same inline-vs-external fork a
            // normal Play uses, so the two paths cannot drift apart.
            startPlayback: async (playback, isCurrent) => {
                const started = await this.playback.startResolvedPlayback(
                    playback,
                    isCurrent
                );
                if (started) {
                    // A switch mounts a DIFFERENT stream in the same host, so
                    // evidence from the previous one says nothing about it.
                    this.msUi.reset();
                }
                return started;
            },
            movie: this.multiSourceMovie,
            playbackLive: this.playbackLive,
            playbackStartBlocked: this.playback.isExternalLaunchPending,
        });

        // Initializes on first render and RE-initializes when the route
        // params change while the component is reused (Similar rail).
        effect(() => {
            const playlistId = this.xtreamStore.currentPlaylist()?.id;
            const vodId = this.selectedVodId();
            if (!playlistId || !Number.isFinite(vodId) || vodId <= 0) return;

            const initKey = `${playlistId}:${vodId}`;
            if (this.lastInitKey() === initKey) return;
            this.lastInitKey.set(initKey);

            this.inlinePlayback.set(null);
            // Both, or the primary button keeps the previous movie's Resume
            // label until the new lookup lands — and starts the new stream
            // there. `loadPosition` is guarded on the same key, so an older
            // lookup cannot repopulate either one.
            this.vodPlaybackPosition.set(null);
            this.playback.routePlaybackPosition.set(null);
            this.msUi.reset();
            this.initializeVodDetails(playlistId, vodId);
        });

        registerContentMetadataBackfill({
            store: this.xtreamStore,
            contentType: 'movie',
            playlistId: () => this.xtreamStore.currentPlaylist()?.id,
            xtreamId: () => this.selectedVodId(),
            info: () => this.selectedVodInfo(),
        });
    }

    ngOnInit(): void {
        // Initialization is handled by the params-driven effect in the
        // constructor; the hook remains for interface compatibility.
        if (!this.xtreamStore.currentPlaylist()?.id) {
            this.logger.warn('Deferring VOD details init: playlist not ready');
        }
    }

    openSimilarInPortals(item: CrossPortalSimilarItem): void {
        void this.router.navigate(this.crossPortalSimilar.buildLink(item));
    }

    openSimilar(item: SimilarCatalogItem): void {
        void this.router.navigate(['../..', item.categoryId, item.id], {
            relativeTo: this.route,
        });
    }

    openActor(member: TmdbEnrichedCastMember): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        if (!playlistId || !member.tmdbPersonId) {
            return;
        }
        void this.router.navigate([
            '/workspace/xtreams',
            playlistId,
            'actor',
            member.tmdbPersonId,
        ]);
    }

    /** Clickable year/genre/country chips (Discover pages) */
    private readonly tmdbEnrichment = inject(TmdbEnrichmentService);

    readonly discover = createDiscoverFacetNavigation(() => {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        // Discover reads its results from TMDB, so a chip must not offer a
        // page that enrichment cannot fill
        return playlistId && this.tmdbEnrichment.isEnabled()
            ? { portal: 'xtream', mediaType: 'movie', playlistId }
            : null;
    });

    ngOnDestroy(): void {
        if (this.favoritePulseTimer) {
            clearTimeout(this.favoritePulseTimer);
        }
        this.xtreamStore.cancelDetailsRequest();
        this.playback.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
    }

    async playVod(vodItem: XtreamVodDetails | null): Promise<boolean> {
        this.multiSource.supersedePendingSwitch();
        const started = await this.playback.playVod(vodItem);
        if (!started) {
            return false;
        }

        // Restart means from the beginning. The controller still holds the
        // position this page was seeded with, and a failure before the first
        // timeupdate would otherwise resolve the next source back at it.
        this.multiSource.reportPosition(0);
        this.multiSource.markRouteSourceActive();
        this.msUi.beginPlayback();
        return true;
    }

    /**
     * Restart from the beginning — of whatever the primary button acts on.
     *
     * When a pin points at another copy, Resume honours it, so Restart sitting
     * beside it must too; calling `playVod` there would quietly switch the
     * user to the route's playlist.
     */
    async restartVod(vodItem: XtreamVodDetails | null): Promise<void> {
        if (this.isExternalLaunchPending()) {
            return;
        }

        if (this.msUi.primaryIsPinnedCopy()) {
            const outcome = await this.multiSource.playPinnedSource(async () =>
                Promise.resolve(0)
            );
            if (outcome !== 'unavailable') {
                return;
            }
        }

        await this.playVod(vodItem);
    }

    async resumeVod(vodItem: XtreamVodDetails | null): Promise<boolean> {
        this.multiSource.supersedePendingSwitch();
        const started = await this.playback.resumeVod(vodItem);
        if (!started) {
            return false;
        }

        // The controller can still hold an ALTERNATIVE's timecode. A failure
        // before the first timeupdate would otherwise resolve the next source
        // at a position that belongs to a different copy.
        this.multiSource.reportPosition(
            this.playback.routePlaybackPosition()?.positionSeconds ?? 0
        );
        this.multiSource.markRouteSourceActive();
        this.msUi.beginPlayback();
        return true;
    }

    async onPrimaryAction(vodItem: XtreamVodDetails | null): Promise<void> {
        // When the button reads Stop, it stops. Consulting the pin first would
        // make the control do the opposite of what it says — launching a
        // second player while the first keeps running.
        if (this.playback.isExternalStopAction()) {
            try {
                await this.playback.stopExternalPlayback();
            } catch {
                // The dock stays visible when process teardown is unconfirmed.
            }
            return;
        }

        if (this.playback.isExternalLaunchPending()) {
            return;
        }

        if (this.isDownloaded()) {
            await this.playFromLocal();
            return;
        }

        await this.playFromProviderSource(vodItem);
    }

    async playFromProviderSource(
        vodItem: XtreamVodDetails | null
    ): Promise<void> {
        if (
            this.isExternalLaunchPending() ||
            this.externalPrimaryButtonState() !== 'idle'
        ) {
            return;
        }

        // A pinned source is an explicit "play this movie from here", so it
        // outranks the playlist the route happens to be on. Falls through to
        // the normal path when nothing is pinned or the pin cannot resolve.
        const pinned = await this.multiSource.playPinnedSource(
            this.msUi.resumeSecondsFor
        );
        // Only "no usable pin" falls through. A superseded attempt means a
        // newer action already owns the screen — starting the route source
        // here would override the playback that action just began.
        if (pinned !== 'unavailable') {
            return;
        }

        // Through the route's OWN wrappers, not the service's: they carry the
        // bookkeeping a route start needs — clearing the playback evidence and
        // replacing whatever timecode an alternative left in the controller.
        if (this.playback.hasPlaybackPosition()) {
            await this.resumeVod(vodItem);
            return;
        }

        await this.playVod(vodItem);
    }

    stopExternalPlayback(): Promise<void> {
        return this.playback.stopExternalPlayback();
    }

    formatPosition(): string {
        return this.msUi.formatPosition();
    }

    toggleFavorite(): void {
        const playlist = this.xtreamStore.currentPlaylist();
        if (!playlist) {
            return;
        }

        this.xtreamStore.toggleFavorite(
            this.route.snapshot.params.vodId,
            playlist.id,
            'movie',
            this.selectedVodInfo()?.backdrop_path?.[0]
        );

        this.favoritePulse.set(true);
        if (this.favoritePulseTimer) {
            clearTimeout(this.favoritePulseTimer);
        }
        this.favoritePulseTimer = setTimeout(
            () => this.favoritePulse.set(false),
            220
        );
    }

    getBackdropUrl(info: XtreamVodInfo): string | undefined {
        return info.backdrop_path?.[0];
    }

    goBack(): void {
        this.playback.closeInlinePlayer();
        this.location.back();
    }

    closeInlinePlayer(): void {
        this.playback.closeInlinePlayer();
    }

    readonly multiSourceTitle = this.msUi.multiSourceTitle;
    readonly activeSourceCaption = this.msUi.activeSourceCaption;

    playFromSource(sourceId: string): void {
        this.msUi.playFromSource(sourceId);
    }

    pinSource(sourceId: string): void {
        this.msUi.pinSource(sourceId);
    }

    checkSource(sourceId: string): void {
        this.msUi.checkSource(sourceId);
    }

    readonly autoFailoverSupported = this.msUi.autoFailoverSupported;

    setAutoFailover(enabled: boolean): void {
        this.msUi.setAutoFailover(enabled);
    }

    onPlaybackFailed(): Promise<void> {
        return this.msUi.onPlaybackFailed();
    }

    readonly playbackLive = this.msUi.playbackLive;

    handleInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.msUi.handleInlineTimeUpdate(event);
    }

    showCopyNotification(): void {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            undefined,
            {
                duration: 2000,
            }
        );
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        this.playback.handleExternalFallbackRequest(request);
    }

    resumePausedDownload(): Promise<void> {
        return this.downloads.resumePaused();
    }

    /**
     * A running download is destroyed by one click, so the icon button asks
     * first — there is no label left to warn what the click does.
     */
    promptCancelDownload(): void {
        this.dialogService.openConfirmDialog({
            title: this.translateService.instant(
                'DOWNLOADS.CANCEL_CONFIRM_TITLE'
            ),
            message: this.translateService.instant(
                'DOWNLOADS.CANCEL_CONFIRM_MESSAGE'
            ),
            onConfirm: () => void this.downloads.cancelActive(),
        });
    }

    revealDownloadedFile(): Promise<void> {
        return this.downloads.revealDownloaded();
    }

    downloadVod(vodItem: XtreamVodDetails | null): Promise<void> {
        return this.downloads.start(vodItem);
    }

    playFromLocal(): Promise<void> {
        return this.downloads.playLocal();
    }

    private initializeVodDetails(playlistId: string, vodId: number): void {
        const { categoryId } = this.route.snapshot.params;
        this.xtreamStore.fetchVodDetailsWithMetadata({
            vodId: String(vodId),
            categoryId,
        });
        this.xtreamStore.checkFavoriteStatus(vodId, playlistId, 'movie');
        void this.playback.loadPosition(playlistId, vodId);
    }
}
