import { ClipboardModule } from '@angular/cdk/clipboard';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
    output,
    signal,
    TemplateRef,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    PlaybackPositionData,
    PlayerContentInfo,
    ResolvedPortalPlayback,
    VideoPlayer,
    type VodSourceDescriptor,
    type VodSourceMatchKind,
} from '@iptvnator/shared/interfaces';
import type { PlaybackFallbackRequest } from '@iptvnator/playback/util';
import type { PlaybackDiagnosticCode } from '@iptvnator/playback/util';
import { SettingsStore } from '@iptvnator/services';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';
import type { PlayerMediaTitle } from '../player-controls';
import {
    FULLSCREEN_CHANNEL_PANEL,
    type FullscreenChannelPanelContext,
} from '../fullscreen-channel-panel/fullscreen-channel-panel.model';
import { FullscreenEpisodePanelComponent } from '../fullscreen-episode-panel/fullscreen-episode-panel.component';
import type { FullscreenPanelEpisodeLike } from '../fullscreen-episode-panel/fullscreen-episode-panel.util';
import {
    createEpisodePanelHost,
    type SeasonLoadStates,
} from './portal-inline-player-episode-panel.host';
import { WebPlayerViewComponent } from '../web-player-view/web-player-view.component';
import type {
    SeriesEpisodeMetadata,
    SeriesPlaybackNavigation,
} from './series-playback-navigation';
import { VodSourcesChipComponent } from '@iptvnator/ui/components';
import {
    ambientImageStyle as toAmbientImageStyle,
    observeStageSize,
    type StageSize,
    UP_NEXT_RAIL_MIN_WIDTH,
    upNextRailAvailableWidth,
} from './portal-inline-player-stage.util';
import { UpNextRailComponent } from './up-next-rail.component';
import type { UpNextRailItem } from './up-next-rail.util';

@Component({
    selector: 'app-portal-inline-player',
    templateUrl: './portal-inline-player.component.html',
    styleUrl: './portal-inline-player.component.scss',
    imports: [
        ClipboardModule,
        FullscreenEpisodePanelComponent,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        TranslateModule,
        UpNextRailComponent,
        VodSourcesChipComponent,
        WebPlayerViewComponent,
    ],
    providers: [
        // The fullscreen side panel inside the nested player lists this
        // series' episodes (see the `fullscreenEpisodePanel` template). A
        // movie host gets `null` from `panelTemplate`, so nothing renders —
        // and, being the nearest provider, this also shields the nested view
        // from a page-level channel-list provider (the M3U player's).
        {
            provide: FULLSCREEN_CHANNEL_PANEL,
            useFactory: () => inject(PortalInlinePlayerComponent).episodePanel,
        },
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'portal-inline-player',
        '[attr.data-has-player]': 'hasPlayback()',
    },
})
export class PortalInlinePlayerComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly episodeMetadata = input<SeriesEpisodeMetadata | null>(null);
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);
    /** Series name for the fullscreen title overlay. Xtream episode playback
     * carries the episode title, so the series name must come from the host. */
    readonly seriesTitle = input<string | null>(null);
    /** "Up Next" entries built by the series host; null for movies/live. */
    readonly upNextEpisodes = input<UpNextRailItem[] | null>(null);
    /**
     * Every season of the playing series, keyed like the season container's
     * input, for the fullscreen episode panel; null for movies/live.
     */
    readonly seriesEpisodes = input<Record<
        string,
        readonly FullscreenPanelEpisodeLike[]
    > | null>(null);
    /** Per-episode positions behind the panel's progress bars and check marks. */
    readonly episodePlaybackPositions = input<ReadonlyMap<
        number,
        PlaybackPositionData
    > | null>(null);
    /**
     * Seasons in flight or not yet answered by the portal (Stalker lazy VOD
     * series), keyed by season; absent keys are loaded.
     */
    readonly seasonLoadStates = input<SeasonLoadStates | null>(null);
    /**
     * Initial player volume. Only hosts that own a persisted volume pass it
     * (the M3U player shares one across its channels); the portals keep the
     * engines' own default, which is what this default preserves.
     */
    readonly volume = input(1);
    /**
     * Engine the host already resolved. `WebPlayerViewComponent` otherwise
     * waits for its own asynchronous settings read and mounts Video.js
     * meanwhile — and the engine is part of the application token, so that
     * correction swaps the player under a running session. Hosts that hold
     * the settings synchronously pass them; `null` keeps the old behaviour.
     */
    readonly playerOverride = input<VideoPlayer | null>(null);
    private readonly settingsStore = inject(SettingsStore);
    // Strip only live-channel titles — VOD/series titles ("Mission:
    // Impossible - Fallout") must never lose their leading segment.
    readonly title = computed(() =>
        applyChannelNameStrip(
            this.playback()?.title,
            this.playback()?.isLive && this.settingsStore.stripCountryPrefix?.()
        )
    );
    readonly streamUrl = computed(() => this.playback()?.streamUrl ?? '');
    readonly startTime = computed(() => this.playback()?.startTime ?? 0);
    /**
     * Poster used for the "Ambient mode" fill behind the player. Live channels
     * carry logos rather than posters, so they are excluded.
     */
    readonly ambientImageStyle = computed<string | null>(() => {
        const playback = this.playback();
        return playback && !playback.isLive
            ? toAmbientImageStyle(playback.thumbnail)
            : null;
    });
    // Web players only — mirrors the settings UI, which offers the ambient
    // and Up Next toggles for HTML5, Video.js, and ArtPlayer. Embedded MPV
    // composites a native video layer, so extra DOM stays out of the mix.
    private readonly isWebPlayerEngine = computed<boolean>(() => {
        const player = this.settingsStore.player?.();
        return (
            player === VideoPlayer.VideoJs ||
            player === VideoPlayer.Html5Player ||
            player === VideoPlayer.ArtPlayer
        );
    });
    readonly ambientEnabled = computed<boolean>(() => {
        return (
            this.isWebPlayerEngine() &&
            this.settingsStore.playerAmbientMode?.() === true &&
            !!this.ambientImageStyle()
        );
    });
    readonly contentInfo = computed<PlayerContentInfo | undefined>(
        () => this.playback()?.contentInfo
    );
    readonly hasPlayback = computed(() => !!this.playback()?.streamUrl);
    readonly episodeMetadataText = computed(() => {
        const metadata = this.episodeMetadata();
        if (!metadata) {
            return '';
        }

        return metadata.title
            ? `${metadata.label} - ${metadata.title}`
            : metadata.label;
    });
    readonly playerMediaTitle = computed<PlayerMediaTitle | null>(() => {
        const metadata = this.episodeMetadata();
        const primary = (
            (metadata ? this.seriesTitle() : null) || this.title()
        )?.trim();
        if (!primary) {
            return null;
        }

        return { primary, secondary: metadata?.label ?? null };
    });

    private readonly stageViewport =
        viewChild<ElementRef<HTMLElement>>('stageViewport');
    /** Border-box size of the theater stage, written by a ResizeObserver. */
    readonly stageSize = signal<StageSize | null>(null);
    /**
     * The rail docks in only for inline series playback on web engines, when
     * the setting (default on) is enabled and the stage is wide enough; on
     * near-16:9 or taller windows the theater/ambient centering remains.
     */
    readonly upNextRailVisible = computed<boolean>(() => {
        const playback = this.playback();
        return (
            this.settingsStore.playerUpNextRail?.() !== false &&
            this.isWebPlayerEngine() &&
            !!this.upNextEpisodes()?.length &&
            !playback?.isLive &&
            playback?.contentInfo?.contentType === 'episode' &&
            upNextRailAvailableWidth(this.stageSize()) >= UP_NEXT_RAIL_MIN_WIDTH
        );
    });
    readonly upNextRailItems = computed<UpNextRailItem[]>(
        () => this.upNextEpisodes() ?? []
    );

    private readonly fullscreenEpisodePanelTemplate = viewChild<
        TemplateRef<FullscreenChannelPanelContext>
    >('fullscreenEpisodePanel');
    /** FULLSCREEN_CHANNEL_PANEL host for the nested view: this series' episodes. */
    readonly episodePanel = createEpisodePanelHost({
        template: this.fullscreenEpisodePanelTemplate,
        panelEnabled: () =>
            this.settingsStore.fullscreenChannelPanel?.() !== false,
        playback: this.playback,
        seriesEpisodes: this.seriesEpisodes,
        playbackPositions: this.episodePlaybackPositions,
        seasonLoadStates: this.seasonLoadStates,
        seriesTitle: this.seriesTitle,
        fallbackTitle: this.title,
    });

    readonly closed = output<void>();
    /** Back arrow in the now-playing bar: route-level back, not just close. */
    readonly backClicked = output<void>();
    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly streamUrlCopied = output<void>();
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    /** Alternatives offered on the playback-error screen. */
    readonly alternativeSources = input<VodSourceDescriptor[]>([]);
    /** Every source incl. the playing one — powers the in-player picker. */
    readonly allSources = input<VodSourceDescriptor[]>([]);
    /** Formatted resume timecode shown in the picker header. */
    readonly sourcesResumeLabel = input<string | null>(null);
    /** How the sources were matched — the picker states it, so it must be true. */
    readonly sourcesMatchKind = input<VodSourceMatchKind>('title-year');
    /**
     * Auto-failover is one persisted setting, and this picker is the same
     * picker as the detail page's. Without these two the in-player copy would
     * show the toggle off while it is on, and switching it would change
     * nothing.
     */
    readonly sourcesAutoFailoverEnabled = input(false);
    /** See `VodSourcesMenuComponent.autoFailoverSupported`. */
    readonly sourcesAutoFailoverSupported = input(true);
    /** See `VodSourceRowComponent.playbackLive`. */
    readonly sourcesPlaybackLive = input(false);
    readonly sourcesAutoFailoverToggled = output<boolean>();
    readonly sourcePinRequested = output<string>();
    readonly sourceCheckRequested = output<string>();
    readonly alternativeSourceRequested = output<string>();
    /** Relayed playback failure, so hosts can offer/auto-pick a source. */
    readonly playbackFailed = output<PlaybackDiagnosticCode>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
    /** An episode picked in the Up Next rail or the fullscreen episode panel. */
    readonly upNextEpisodeSelected = output<UpNextRailItem>();
    /** A season tab picked in the fullscreen episode panel (lazy load hook). */
    readonly episodePanelSeasonSelected = output<string>();

    constructor() {
        effect((onCleanup) => {
            const element = this.stageViewport()?.nativeElement;
            if (!element || typeof ResizeObserver === 'undefined') {
                this.stageSize.set(null);
                return;
            }

            onCleanup(
                observeStageSize(element, (size) => this.stageSize.set(size))
            );
        });
    }

    onClose(): void {
        this.closed.emit();
    }

    onBack(): void {
        this.backClicked.emit();
    }

    onTimeUpdate(event: { currentTime: number; duration: number }): void {
        this.timeUpdate.emit(event);
    }

    onCopied(): void {
        this.streamUrlCopied.emit();
    }

    onExternalFallbackRequested(request: PlaybackFallbackRequest): void {
        this.externalFallbackRequested.emit(request);
    }

    onPlaybackEnded(): void {
        this.playbackEnded.emit();
    }

    onPreviousEpisodeRequested(): void {
        this.previousEpisodeRequested.emit();
    }

    onNextEpisodeRequested(): void {
        this.nextEpisodeRequested.emit();
    }

    onUpNextEpisodeSelected(item: UpNextRailItem): void {
        this.upNextEpisodeSelected.emit(item);
    }

    /** Panel pick: same host path as the rail, then the panel slides away. */
    onPanelEpisodeSelected(item: UpNextRailItem, close: () => void): void {
        this.upNextEpisodeSelected.emit(item);
        close();
    }
}
