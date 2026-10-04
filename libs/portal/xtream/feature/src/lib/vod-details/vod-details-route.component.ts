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
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    CastCrewRowComponent,
    DetailActionButtonComponent,
    DetailActionsTemplateDirective,
    DetailCreditsComponent,
    DetailIconButtonComponent,
    DetailMetaTemplateDirective,
    DetailTagsTemplateDirective,
    MetaChipComponent,
    PortalDetailShellComponent,
    SimilarRailComponent,
    type SimilarRailItem,
    ViewInPortalActionComponent,
    VodMoreMenuComponent,
    scrollToCastCrewRow,
} from '@iptvnator/ui/components';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    registerContentMetadataBackfill,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    type PlaybackFallbackRequest,
    PortalInlinePlayerComponent,
} from '@iptvnator/ui/playback';
import { DownloadsService, SettingsStore } from '@iptvnator/services';
import {
    TmdbEnrichedCastMember,
    XtreamVodDetails,
    XtreamVodInfo,
    type ExternalPlayerName,
} from '@iptvnator/shared/interfaces';
import { injectXtreamDetailNavigation } from '../xtream-detail-navigation';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { VodDetailsMultiSourceUiService } from './vod-details-multi-source-ui.service';
import { VodDetailsDownloadsService } from './vod-details-downloads.service';
import { VodDetailsWatchedService } from './vod-details-watched.service';
import { VodDetailsHeroPresenter } from './vod-details-hero.presenter';
import { VodDetailsMenuService } from './vod-details-menu.service';
import { VodDetailsSelectionService } from './vod-details-selection.service';
import { VodDetailsSimilarService } from './vod-details-similar.service';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';

@Component({
    templateUrl: './vod-details-route.component.html',
    styleUrls: [
        '../../../../../../ui/components/src/lib/styles/detail-view.scss',
        './vod-details-route.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        VodDetailsSelectionService,
        VodDetailsPlaybackService,
        VodMultiSourceHostService,
        VodDetailsMultiSourceUiService,
        VodDetailsSimilarService,
        VodDetailsDownloadsService,
        VodDetailsWatchedService,
        VodDetailsHeroPresenter,
        VodDetailsMenuService,
    ],
    imports: [
        DetailActionsTemplateDirective,
        DetailMetaTemplateDirective,
        DetailTagsTemplateDirective,
        MatIcon,
        NgTemplateOutlet,
        PortalDetailShellComponent,
        ViewInPortalActionComponent,
        SlicePipe,
        TranslateModule,
        PortalInlinePlayerComponent,
        CastCrewRowComponent,
        DetailActionButtonComponent,
        DetailCreditsComponent,
        DetailIconButtonComponent,
        MetaChipComponent,
        SimilarRailComponent,
        VodMoreMenuComponent,
    ],
})
export class VodDetailsRouteComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly settingsStore = inject(SettingsStore);
    private readonly route = inject(ActivatedRoute);
    private readonly navigation = injectXtreamDetailNavigation('movie');
    private readonly xtreamStore = inject(XtreamStore);
    private readonly downloadsService = inject(DownloadsService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translateService = inject(TranslateService);
    private readonly playback = inject(VodDetailsPlaybackService);
    /** Alternative sources for this movie in the user's other playlists */
    readonly multiSource = inject(VodMultiSourceHostService);
    private readonly msUi = inject(VodDetailsMultiSourceUiService);
    private readonly similar = inject(VodDetailsSimilarService);
    private readonly downloads = inject(VodDetailsDownloadsService);
    private readonly watched = inject(VodDetailsWatchedService);
    readonly hero = inject(VodDetailsHeroPresenter);
    readonly menu = inject(VodDetailsMenuService);
    /** The movie the route addresses, see {@link VodDetailsSelectionService}. */
    private readonly selection = inject(VodDetailsSelectionService);
    private readonly logger = createLogger('VodDetailsRoute');
    /** `playlistId:vodId` of the last initialized detail view */
    private readonly lastInitKey = signal<string | null>(null);
    readonly inlinePlayback = this.playback.inlinePlayback;
    readonly vodPlaybackPosition = this.playback.vodPlaybackPosition;
    /** The route copy's own row — what Resume acts on. */
    readonly routePlaybackPosition = this.playback.routePlaybackPosition;

    readonly theme = this.settingsStore.theme;
    readonly isElectron = this.downloadsService.isAvailable;

    readonly isFavorite = this.xtreamStore.isFavorite;
    readonly isWatched = this.watched.isWatched;
    readonly canToggleWatched = this.watched.canToggle;
    readonly selectedVodId = this.selection.selectedVodId;
    readonly playbackSessionKey = this.selection.playbackSessionKey;
    readonly providerOnly = this.selection.providerOnly;
    readonly selectedItem = this.selection.selectedItem;
    readonly selectedCategory = this.selection.selectedCategory;
    readonly selectedCatalogItem = this.selection.selectedCatalogItem;
    private readonly multiSourceMovie = this.selection.multiSourceMovie;
    readonly selectedVodInfo = this.selection.selectedVodInfo;
    readonly playableVodItem = this.selection.playableVodItem;
    readonly fallbackView = this.selection.fallbackView;
    readonly isLoadingDetails = this.xtreamStore.isLoadingDetails;
    readonly detailsError = this.xtreamStore.detailsError;
    readonly matchedExternalPlayback = this.playback.matchedExternalPlayback;
    readonly externalPrimaryLabel = this.playback.externalPrimaryLabel;
    readonly externalPrimaryIcon = this.playback.externalPrimaryIcon;
    readonly isExternalLaunchPending = this.playback.isExternalLaunchPending;
    readonly startBlocked = this.playback.startBlocked;
    readonly isExternalStopAction = this.playback.isExternalStopAction;
    readonly externalPrimaryButtonState =
        this.playback.externalPrimaryButtonState;

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

    readonly downloadRingCircumference = this.downloads.ringCircumference;
    readonly downloadRingOffset = this.downloads.ringOffset;

    /** Drives the heart's brief scale pulse when favoriting toggles. */
    readonly favoritePulse = signal(false);
    private favoritePulseTimer: ReturnType<typeof setTimeout> | null = null;

    readonly trailerEmbedUrl = this.hero.trailerEmbedUrl;
    readonly contentKey = this.selection.contentKey;
    readonly trailerBackdropUrl = this.hero.trailerBackdropUrl;
    readonly scrollToCast = scrollToCastCrewRow;
    /** Clickable year/genre/country chips (Discover pages) */
    readonly discover = this.navigation.discover;

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
            resetTarget: this.msUi.primaryTarget,
            reportExternalLaunchFailure: (error) => {
                this.logger.error('External launch failed', error);
                this.snackBar.open(
                    this.translateService.instant('PORTALS.PLAYBACK_ERROR'),
                    undefined,
                    { duration: 3000 }
                );
            },
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
            startPlayback: async (playback, isCurrent, player) => {
                const started = await this.playback.startResolvedPlayback(
                    playback,
                    isCurrent,
                    player
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
            playbackStartBlocked: this.playback.startBlocked,
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

        this.watched.bind(this.selectedVodId);
        this.hero.bind({
            info: this.selectedVodInfo,
            // The copy the button starts, so the progress bar and the
            // remaining time describe that copy, not the route's row.
            position: this.msUi.primaryPosition,
            hasPlaybackPosition: this.hasPlaybackPosition,
            isOfflinePrimary: this.isOfflinePrimary,
            externalLabel: this.externalPrimaryLabel,
            externalIcon: this.externalPrimaryIcon,
            externalState: this.externalPrimaryButtonState,
            formatPosition: () => this.formatPosition(),
            similarItems: this.similarItems,
            similarInPortals: this.similarInPortals,
            openSimilar: (item) => this.navigation.openSimilar(item),
            openSimilarInPortals: (item) =>
                this.navigation.openSimilarInPortals(item),
        });
        this.menu.bind({
            item: this.playableVodItem,
            vodId: this.selectedVodId,
            category: this.selectedCategory,
            restart: () => this.restartVod(this.playableVodItem()),
            openExternal: (player) =>
                this.openInExternalPlayer(this.playableVodItem(), player),
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

    openSimilarRailItem(item: SimilarRailItem): void {
        this.hero.openSimilarRailItem(item);
    }

    openTrailer(): void {
        this.hero.openTrailer();
    }

    openActor(member: TmdbEnrichedCastMember): void {
        this.navigation.openActor(member);
    }

    ngOnDestroy(): void {
        if (this.favoritePulseTimer) {
            clearTimeout(this.favoritePulseTimer);
        }
        this.xtreamStore.cancelDetailsRequest();
        this.playback.closeInlinePlayer();
        this.xtreamStore.setSelectedItem(null);
    }

    async playVod(
        vodItem: XtreamVodDetails | null,
        player?: ExternalPlayerName
    ): Promise<boolean> {
        this.multiSource.supersedePendingSwitch();
        const started = await this.playback.playVod(vodItem, player);
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
        if (this.startBlocked()) {
            return;
        }

        if (this.msUi.primaryIsPinnedCopy()) {
            const outcome = await this.multiSource.playPinnedSource(
                async () => Promise.resolve(0),
                { replacePlaying: true }
            );
            if (outcome !== 'unavailable') {
                return;
            }
        }

        await this.playVod(vodItem);
    }

    async resumeVod(
        vodItem: XtreamVodDetails | null,
        player?: ExternalPlayerName
    ): Promise<boolean> {
        this.multiSource.supersedePendingSwitch();
        const started = await this.playback.resumeVod(vodItem, player);
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

    /**
     * The "…" menu's MPV/VLC launch: the copy the primary button acts on,
     * from where it would resume. A pinned copy outranks the route's, as it
     * does for Play and Restart, so the launch and the button never disagree
     * about the source or the position.
     */
    async openInExternalPlayer(
        vodItem: XtreamVodDetails | null,
        player: ExternalPlayerName
    ): Promise<void> {
        if (this.startBlocked()) {
            return;
        }
        if (this.msUi.primaryIsPinnedCopy()) {
            // Also while that copy already plays: the viewer's chosen source
            // is relaunched, never swapped for the route's copy.
            const outcome = await this.multiSource.playPinnedSource(
                this.msUi.resumeSecondsFor,
                { player, replacePlaying: true }
            );
            if (outcome !== 'unavailable') {
                return;
            }
        }
        if (this.playback.hasPlaybackPosition()) {
            await this.resumeVod(vodItem, player);
            return;
        }
        await this.playVod(vodItem, player);
    }

    async playFromProviderSource(
        vodItem: XtreamVodDetails | null
    ): Promise<void> {
        if (
            this.startBlocked() ||
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
            this.route.snapshot.params['vodId'],
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

    toggleWatched(vodItem: XtreamVodDetails | null): Promise<boolean> {
        return this.watched.toggleWatched(vodItem);
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

    promptCancelDownload(): void {
        this.downloads.promptCancel();
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
