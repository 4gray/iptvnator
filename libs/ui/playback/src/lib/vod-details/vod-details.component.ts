import {
    Component,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
    ChangeDetectionStrategy,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
    PORTAL_EXTERNAL_PLAYBACK,
    createDiscoverFacetNavigation,
    createExternalPlaybackButtonState,
} from '@iptvnator/portal/shared/util';
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
    TrailerDialogService,
    ViewInPortalActionComponent,
    VodMoreMenuComponent,
    scrollToCastCrewRow,
    type SimilarRailItem,
} from '@iptvnator/ui/components';
import { Router } from '@angular/router';
import {
    ExternalPlayerName,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
    TmdbEnrichedCastMember,
    VodDetailsItem,
    getVodNumericId,
    normalizeVodDetails,
    youtubeEmbedUrl,
} from '@iptvnator/shared/interfaces';
import {
    CrossPortalSimilarItem,
    CrossPortalSimilarService,
    DownloadsService,
    RuntimeCapabilitiesService,
    SettingsStore,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { VOD_DETAILS_MENU_ACTION } from './vod-details-presentation';
import { createVodDetailsHeroState } from './vod-details-hero.state';
import type { PlaybackFallbackRequest } from '@iptvnator/playback/util';
import { PortalInlinePlayerComponent } from '../portal-inline-player/portal-inline-player.component';
import { createVodDownloadState } from './vod-download-state.util';

/**
 * Unified VOD details component for both Xtream and Stalker portals.
 *
 * Uses discriminated union (VodDetailsItem) for type-safe handling.
 * All actions are emitted as outputs - parent components handle
 * store-specific operations (play, favorites, downloads).
 *
 * @example
 * ```html
 * <app-vod-details
 *   [item]="vodItem"
 *   [isFavorite]="isFavorite()"
 *   [playbackPosition]="position()"
 *   (playClicked)="onPlay($event)"
 *   (resumeClicked)="onResume($event)"
 *   (favoriteToggled)="onToggleFavorite($event)"
 * />
 * ```
 */
@Component({
    selector: 'app-vod-details',
    templateUrl: './vod-details.component.html',
    styleUrls: ['../styles/detail-view.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [
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
        ViewInPortalActionComponent,
        VodMoreMenuComponent,
        PortalInlinePlayerComponent,
        TranslatePipe,
    ],
})
export class VodDetailsComponent {
    // ============ Inputs ============

    /** VOD item with discriminated union type */
    readonly item = input.required<VodDetailsItem>();
    readonly playbackSessionKey = input.required<string>();

    /** Whether this item is in favorites (managed by parent) */
    readonly isFavorite = input<boolean>(false);

    /** Playback position in seconds for resume feature (managed by parent) */
    readonly playbackPosition = input<number | null>(null);
    /** Duration the saved position was recorded against, for "N min left". */
    readonly playbackDurationSeconds = input<number | null>(null);
    /** Playlist name shown in the "Movie · source" eyebrow. */
    readonly sourceLabel = input<string | null>(null);

    /** Inline playback payload for embedded players (managed by parent) */
    readonly inlinePlayback = input<ResolvedPortalPlayback | null>(null);

    /** Active external playback session for launch state */
    readonly externalPlayback = input<ExternalPlayerSession | null>(null);

    /** Provider detail handoff hides local/download presentation only. */
    readonly providerOnly = input(false);

    /** The host's verdict on the position row (≥90% or marked by hand). */
    readonly isWatched = input(false);

    /** A watched write is in flight; the toggle waits for it. */
    readonly watchedToggleBusy = input(false);

    /** The host has the stored row in hand (`playbackPosition` is not a placeholder). */
    readonly watchedToggleReady = input(true);

    /**
     * A Play/Resume is still resolving with the portal: nothing plays yet,
     * but the player about to start would overwrite a row written now.
     */
    readonly playbackStartPending = input(false);

    // ============ Outputs ============

    /** Emitted when play button is clicked */
    readonly playClicked = output<VodDetailsItem>();

    /** Emitted when resume button is clicked (includes position) */
    readonly resumeClicked = output<{
        item: VodDetailsItem;
        positionSeconds: number;
    }>();

    /** Emitted when favorite toggle is clicked */
    readonly favoriteToggled = output<{
        item: VodDetailsItem;
        isFavorite: boolean;
    }>();

    /** Emitted when the manual watched toggle is clicked (desired state) */
    readonly watchedToggled = output<{
        item: VodDetailsItem;
        watched: boolean;
    }>();

    /** Emitted when back button is clicked */
    readonly backClicked = output<void>();

    /** Emitted when download is requested (parent handles URL construction) */
    readonly downloadRequested = output<VodDetailsItem>();

    /** Emitted when inline playback position changes */
    readonly inlineTimeUpdated = output<{
        currentTime: number;
        duration: number;
    }>();

    /** Emitted when the inline player should be closed */
    readonly inlinePlaybackClosed = output<void>();

    /** Emitted when the stream url is copied */
    readonly streamUrlCopied = output<void>();

    /** Emitted when the inline player requests MPV/VLC fallback */
    readonly inlineExternalFallbackRequested =
        output<PlaybackFallbackRequest>();
    /** "Open in external player": the host resolves and launches MPV/VLC. */
    readonly externalPlayRequested = output<{
        item: VodDetailsItem;
        player: ExternalPlayerName;
        positionSeconds: number | null;
    }>();
    /** "Reset progress": the host clears the saved position. */
    readonly resetProgressRequested = output<VodDetailsItem>();

    // ============ Services ============

    private readonly downloadsService = inject(DownloadsService);

    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly crossPortalSimilar = inject(CrossPortalSimilarService);
    private readonly externalPlaybackActions = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly router = inject(Router);
    private readonly settingsStore = inject(SettingsStore);
    private readonly translate = inject(TranslateService);
    private readonly trailerDialog = inject(TrailerDialogService);

    // ============ Computed State ============

    /** Whether running in Electron (downloads available) */
    readonly isElectron = computed(() => this.downloadsService.isAvailable());

    /** Normalized metadata for display */
    readonly normalizedMeta = computed(() => normalizeVodDetails(this.item()));

    readonly trailerEmbedUrl = computed(() =>
        youtubeEmbedUrl(this.normalizedMeta().youtubeTrailer)
    );
    /** Provider + playlist + id: the hero keys its one-time layout decision on it. */
    readonly contentKey = computed(
        () =>
            `${this.item().type}:${this.item().playlistId}:${getVodNumericId(this.item())}`
    );
    /** Settings → Playback → Play trailers in details background. */
    readonly trailerBackdropUrl = computed(() =>
        this.settingsStore.detailTrailerBackdrop?.() === true
            ? this.trailerEmbedUrl()
            : null
    );

    /**
     * TMDB recommendations found in the user's OTHER portals (batched DB
     * match, Electron only). Loaded async — the section appears when
     * resolved; staleness-guarded against item changes in flight.
     */
    private readonly similarInPortalsMatched = signal<CrossPortalSimilarItem[]>(
        []
    );
    /** Filtered on read: a relock hides matches cached while unlocked. */
    readonly similarInPortals = computed(() =>
        this.crossPortalSimilar.visible(this.similarInPortalsMatched())
    );

    private readonly loadSimilarInPortals = effect(() => {
        const meta = this.normalizedMeta();
        const recommendations = meta.tmdbRecommendations;
        untracked(() => {
            this.similarInPortalsMatched.set([]);
            if (
                !recommendations?.length ||
                !this.crossPortalSimilar.isAvailable
            ) {
                return;
            }
            void this.crossPortalSimilar
                .matchRecommendations(recommendations, 'movie')
                .then((items) => {
                    if (
                        this.normalizedMeta().tmdbRecommendations ===
                        recommendations
                    ) {
                        this.similarInPortalsMatched.set(items);
                    }
                });
        });
    });

    openSimilarInPortals(item: CrossPortalSimilarItem): void {
        void this.router.navigate(this.crossPortalSimilar.buildLink(item));
    }

    /**
     * Whether there's a playback position to resume from. A watched movie
     * shows Play, not "Resume 1:32:00" from its final seconds.
     */
    readonly hasPlaybackPosition = computed(
        () => (this.playbackPosition() ?? 0) > 0 && !this.isWatched()
    );

    private readonly downloadState = createVodDownloadState(
        this.downloadsService,
        this.item
    );
    readonly isDownloaded = computed(
        () => !this.providerOnly() && this.downloadState.isDownloaded()
    );
    readonly isDownloading = computed(
        () => !this.providerOnly() && this.downloadState.isDownloading()
    );
    readonly isPausedDownload = computed(
        () => !this.providerOnly() && this.downloadState.isPausedDownload()
    );

    private readonly externalButton = createExternalPlaybackButtonState({
        session: this.externalPlayback,
        playlistId: computed(() => this.item().playlistId),
        contentId: computed(() => getVodNumericId(this.item())),
    });
    readonly matchedExternalPlayback = this.externalButton.matchedSession;
    readonly externalPrimaryLabel = this.externalButton.primaryLabel;
    readonly externalPrimaryIcon = this.externalButton.primaryIcon;
    readonly isExternalLaunchPending = this.externalButton.isLaunchPending;
    readonly isExternalStopAction = this.externalButton.isStopAction;
    readonly externalPrimaryButtonState = this.externalButton.buttonState;
    readonly isOfflinePrimary = computed(
        () =>
            this.isDownloaded() && this.externalPrimaryButtonState() === 'idle'
    );

    // ============ Hero presentation ============

    readonly hero = createVodDetailsHeroState({
        meta: this.normalizedMeta,
        sourceLabel: this.sourceLabel,
        playbackPosition: this.playbackPosition,
        playbackDurationSeconds: this.playbackDurationSeconds,
        hasPlaybackPosition: this.hasPlaybackPosition,
        isWatched: this.isWatched,
        supportsExternalPlayers: () =>
            this.runtime.supportsManagedExternalPlayers,
        playbackStartPending: this.playbackStartPending,
        isOfflinePrimary: this.isOfflinePrimary,
        externalLabel: this.externalPrimaryLabel,
        externalIcon: this.externalPrimaryIcon,
        externalState: this.externalPrimaryButtonState,
        similarInPortals: this.similarInPortals,
        configuredPlayer: this.settingsStore.player,
        translate: this.translate,
    });

    runMenuAction(actionId: string): void {
        switch (actionId) {
            case VOD_DETAILS_MENU_ACTION.ExternalPlayer:
                this.externalPlayRequested.emit({
                    item: this.item(),
                    player: this.hero.externalPlayer(),
                    positionSeconds: this.hasPlaybackPosition()
                        ? this.playbackPosition()
                        : null,
                });
                return;
            case VOD_DETAILS_MENU_ACTION.StartOver:
                this.onPlay();
                return;
            case VOD_DETAILS_MENU_ACTION.ResetProgress:
                this.resetProgressRequested.emit(this.item());
                return;
        }
    }

    openTrailer(): void {
        const embedUrl = this.trailerEmbedUrl();
        if (embedUrl) {
            this.trailerDialog.open({
                embedUrl,
                title: this.normalizedMeta().title ?? '',
            });
        }
    }

    readonly scrollToCast = scrollToCastCrewRow;

    openSimilarRailItem(item: SimilarRailItem): void {
        const match = this.similarInPortals().find(
            (candidate) =>
                `x${candidate.match.playlistId}-${candidate.match.xtreamId}` ===
                item.key
        );
        if (match) {
            this.openSimilarInPortals(match);
        }
    }

    // ============ Actions ============

    /** Handle play button click */
    onPlay(): void {
        this.playClicked.emit(this.item());
    }

    async onPrimaryAction(): Promise<void> {
        if (this.isExternalStopAction()) {
            try {
                await this.stopExternalPlayback();
            } catch {
                // The dock stays visible when process teardown is unconfirmed.
            }
            return;
        }

        if (this.isDownloaded()) {
            await this.playFromLocal();
            return;
        }

        this.onProviderAction();
    }

    onProviderAction(): void {
        if (this.hasPlaybackPosition()) {
            this.onResume();
            return;
        }

        this.onPlay();
    }

    /** Handle resume button click */
    onResume(): void {
        const pos = this.playbackPosition();
        if (pos && pos > 0) {
            this.resumeClicked.emit({
                item: this.item(),
                positionSeconds: pos,
            });
        }
    }

    /**
     * The manual watched toggle stays off while playback owns the row: the
     * player persists its position every ~15 s and would overwrite a
     * just-written full-progress row, silently flipping the movie back.
     */
    readonly canToggleWatched = computed(
        () =>
            !this.watchedToggleBusy() &&
            this.watchedToggleReady() &&
            !this.playbackStartPending() &&
            this.inlinePlayback() === null &&
            this.matchedExternalPlayback() === null &&
            !this.isExternalLaunchPending()
    );

    toggleWatched(): void {
        if (!this.canToggleWatched()) {
            return;
        }
        this.watchedToggled.emit({
            item: this.item(),
            watched: !this.isWatched(),
        });
    }

    /** Handle favorite toggle - emits the desired new state */
    toggleFavorite(): void {
        this.favoriteToggled.emit({
            item: this.item(),
            isFavorite: !this.isFavorite(),
        });
    }

    /** Handle back navigation - emit event for parent to handle */
    openActor(member: TmdbEnrichedCastMember): void {
        if (!member.tmdbPersonId) {
            return;
        }
        const item = this.item();
        const basePath =
            item.type === 'stalker'
                ? '/workspace/stalker'
                : '/workspace/xtreams';
        void this.router.navigate([
            basePath,
            item.playlistId,
            'actor',
            member.tmdbPersonId,
        ]);
    }

    goBack(): void {
        this.backClicked.emit();
    }

    /** Clickable year/genre/country chips (Discover pages) */
    private readonly tmdbEnrichment = inject(TmdbEnrichmentService);

    readonly discover = createDiscoverFacetNavigation(() => {
        const item = this.item();
        // Discover reads its results from TMDB, so a chip must not offer a
        // page that enrichment cannot fill
        return item.playlistId && this.tmdbEnrichment.isEnabled()
            ? {
                  portal: item.type === 'stalker' ? 'stalker' : 'xtream',
                  // Stalker embedded-VOD series render here but are matched
                  // as tv, so the merge's verdict decides — not the route
                  mediaType: this.normalizedMeta().tmdbMediaType ?? 'movie',
                  playlistId: item.playlistId,
              }
            : null;
    });

    /** Handle download request */
    onDownload(): void {
        this.downloadRequested.emit(this.item());
    }

    /** Resume the paused download of this VOD */
    async resumePausedDownload(): Promise<void> {
        const item = this.item();
        await this.downloadsService.resumeDownloadByContent(
            getVodNumericId(item),
            item.playlistId,
            'vod'
        );
    }

    onInlineTimeUpdate(event: { currentTime: number; duration: number }): void {
        this.inlineTimeUpdated.emit(event);
    }

    closeInlinePlayback(): void {
        this.inlinePlaybackClosed.emit();
    }

    onStreamUrlCopied(): void {
        this.streamUrlCopied.emit();
    }

    onInlineExternalFallbackRequested(request: PlaybackFallbackRequest): void {
        this.inlineExternalFallbackRequested.emit(request);
    }

    async stopExternalPlayback(): Promise<void> {
        await this.externalPlaybackActions.closeSession(
            this.matchedExternalPlayback()
        );
    }

    /** Play from local downloaded file */
    async playFromLocal(): Promise<void> {
        const item = this.item();
        const vodId = getVodNumericId(item);

        const filePath = this.downloadsService.getDownloadedFilePath(
            vodId,
            item.playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }
}
