import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { AsyncPipe, CommonModule } from '@angular/common';
import {
    Component,
    ElementRef,
    HostListener,
    Injector,
    OnDestroy,
    OnInit,
    TemplateRef,
    computed,
    effect,
    forwardRef,
    inject,
    linkedSignal,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from '@iptvnator/ui/components';
import {
    applyChannelNameStrip,
    getM3uArchiveDays,
    extractDrmFromRaw,
    isDashChannel,
    isDashStreamUrl,
    isLikelyM3uMovie,
    isM3uCatchupPlaybackSupported,
} from '@iptvnator/shared/m3u-utils';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    COMPONENT_OVERLAY_REF,
    EpgDateNavigationDirection,
    EpgListViewComponent,
    EpgProgramActivationEvent,
    EpgTimelineComponent,
    EpgTimelineEmptyReason,
    getTodayEpgDateKey,
    MultiEpgContainerComponent,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import { EpgService } from '@iptvnator/epg/data-access';
import {
    ChannelActions,
    EpgActions,
    PlaylistActions,
    buildExternalPlayerPayload,
    resolveExternalPlayerHttpHeaders,
    resolveChannelEpgLookupKey,
    selectActive,
    selectActiveEpgProgram,
    selectActivePlaybackUrl,
    selectActivePlaylist,
    selectChannels,
    selectChannelsLoading,
    selectCurrentEpgProgram,
} from '@iptvnator/m3u-state';
import {
    firstValueFrom,
    Observable,
    Subscription,
    catchError,
    combineLatest,
    filter,
    map,
    of,
    startWith,
    switchMap,
    take,
} from 'rxjs';
import {
    getAdjacentChannelItem,
    getChannelItemByNumber,
    isTypingInInput,
    isWorkspaceLayoutRoute,
    LiveEpgPanelState,
    LiveSidebarState,
    persistLiveEpgPanelState,
    persistLiveSidebarState,
    PORTAL_EXTERNAL_PLAYBACK,
    isLiveExternalPlayerSession,
    REMOTE_CONTROL_RESET_STATUS,
    restoreLiveEpgPanelState,
    restoreLiveSidebarState,
    WorkspaceHeaderContextService,
} from '@iptvnator/portal/shared/util';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
import {
    AudioPlayerComponent,
    FULLSCREEN_CHANNEL_PANEL,
    type FullscreenChannelPanelContext,
    type FullscreenChannelPanelHost,
    type PlaybackFallbackRequest,
    SidebarComponent,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { LiveEpgPanelSummary } from '@iptvnator/ui/shared-portals';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import { ChannelListLoadingStateComponent } from '@iptvnator/ui/components';
import {
    DataService,
    PlaylistsService,
    RecordingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import {
    Channel,
    createDevLogger,
    EpgProgram,
    epgProviderClockMs,
    ExternalPlayerSession,
    filterRecordingProgramsOverlap,
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    PLAYLIST_PARSE_BY_URL,
    M3uRecentlyViewedItem,
    playlistDisplayLabel,
    PlaylistMeta,
    RecordingStartMetadata,
    RecordingStoppedEvent,
    toRecordingProgramSnapshot,
    ResolvedPortalPlayback,
    STORE_KEY,
    Settings,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { M3uVodDetailComponent } from '../m3u-vod-detail/m3u-vod-detail.component';
import { M3uFullscreenChannelListComponent } from './fullscreen-channel-list/m3u-fullscreen-channel-list.component';
import { createM3uChannelPlaybackRequest } from './m3u-channel-playback-actions';

const M3U_MULTI_EPG_HEADER_ACTION_ID = 'm3u-multi-epg';
const M3U_SIDEBAR_STORAGE_KEY = 'm3u-sidebar-width';
const M3U_GROUPS_SIDEBAR_STORAGE_KEY = 'm3u-groups-sidebar-width';
const M3U_SIDEBAR_MIN_WIDTH = 200;
const M3U_SIDEBAR_MAX_WIDTH = 600;
const M3U_SIDEBAR_DEFAULT_WIDTH = 460;

/**
 * Shared `volume` bus the player engines and the audio player persist to.
 *
 * The empty cases must be rejected BEFORE `Number()` sees them: it maps both
 * `null` (nothing stored yet) and `''` to 0, which would silently start every
 * first-run playback muted.
 */
function readStoredVolume(): number {
    const stored = localStorage.getItem('volume')?.trim();
    if (!stored) {
        return 1;
    }

    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
}

/**
 * PageUp/PageDown switch channels unless the key would scroll something the
 * user is focused in (the sidebar's virtual list, a menu): a focused row in a
 * scrollable list keeps the browser's native paging.
 */
function isInsideScrollableRegion(
    target: EventTarget | null,
    boundary: HTMLElement
): boolean {
    let element = target instanceof HTMLElement ? target : null;
    while (element && element !== boundary && element !== document.body) {
        const { overflowY } = getComputedStyle(element);
        if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            element.scrollHeight > element.clientHeight
        ) {
            return true;
        }
        element = element.parentElement;
    }
    return false;
}

@Component({
    selector: 'app-video-player',
    imports: [
        AsyncPipe,
        AudioPlayerComponent,
        ChannelListLoadingStateComponent,
        CommonModule,
        EpgListViewComponent,
        EpgTimelineComponent,
        M3uFullscreenChannelListComponent,
        M3uVodDetailComponent,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        PortalEmptyStateComponent,
        ResizableDirective,
        SidebarComponent,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    providers: [
        // The fullscreen channel panel inside the player renders this page's
        // channel list (see the `fullscreenChannelPanel` template).
        {
            provide: FULLSCREEN_CHANNEL_PANEL,
            useExisting: forwardRef(() => VideoPlayerComponent),
        },
    ],
    templateUrl: './video-player.component.html',
    styleUrl: './video-player.component.scss',
})
export class VideoPlayerComponent
    implements OnInit, OnDestroy, FullscreenChannelPanelHost
{
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly hostElement = inject(ElementRef<HTMLElement>);
    private readonly dataService = inject(DataService);
    private readonly overlay = inject(Overlay);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly router = inject(Router);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly storage = inject(StorageMap);
    private readonly store = inject(Store);
    private readonly epgService = inject(EpgService);
    private readonly tmdbEnrichment = inject(TmdbEnrichmentService);
    private readonly externalPlayback = inject(PORTAL_EXTERNAL_PLAYBACK);
    private readonly workspaceHeaderContext = inject(
        WorkspaceHeaderContextService
    );
    private readonly debugLog = createDevLogger('VideoPlayerComponent');

    /** Active selected channel */
    readonly activeChannel = this.store.selectSignal(selectActive);
    readonly activePlaybackUrl = this.store.selectSignal(
        selectActivePlaybackUrl
    );
    readonly activeEpgProgram = this.store.selectSignal(selectActiveEpgProgram);
    readonly activeEpgProgramOrNull = computed(
        () => this.activeEpgProgram() ?? null
    );
    readonly activePlaylistId = this.playlistContext.resolvedPlaylistId;
    readonly playbackSessionKey = computed(() => {
        const sourceId = this.activePlaylistId();
        const contentId = this.activeChannel()?.id;
        return sourceId && contentId !== undefined
            ? createPlaybackSessionKey({ kind: 'live', sourceId, contentId })
            : '';
    });
    readonly channels = this.store.selectSignal(selectChannels);
    readonly channelsLoading = this.store.selectSignal(selectChannelsLoading);
    readonly activePlaylistRecentItems = computed(
        () => this.playlistContext.activePlaylist()?.recentlyViewed ?? []
    );

    private readonly fullscreenChannelPanelTemplate =
        viewChild<TemplateRef<FullscreenChannelPanelContext>>(
            'fullscreenChannelPanel'
        );
    /**
     * FULLSCREEN_CHANNEL_PANEL: the playlist's channel list, unless opted
     * out. Withheld while the M3U VOD detail hosts the player: a movie is
     * not something to zap away from, and the nested `WebPlayerViewComponent`
     * would otherwise inherit this component-level provider.
     */
    readonly panelTemplate = computed(() =>
        this.settingsStore.fullscreenChannelPanel?.() === false ||
        this.showMovieDetail()
            ? null
            : (this.fullscreenChannelPanelTemplate() ?? null)
    );
    readonly panelTitle = computed(() =>
        playlistDisplayLabel(this.activePlaylistMeta()?.title)
    );
    /**
     * Radio stations are withheld from the panel: they render through
     * `app-audio-player` instead of `app-web-player-view`, so selecting one
     * destroys the element that owns fullscreen and drops the user out of it —
     * the opposite of what this panel exists for. Every panel view resolves
     * against this list (favorites and recent look their rows up in it), so
     * one filter covers all four. PageUp/PageDown deliberately keep stepping
     * onto radio: those keys also zap on the windowed player, where switching
     * to a station is exactly right.
     */
    readonly fullscreenPanelChannels = computed(() =>
        this.channels().filter((channel) => channel.radio !== 'true')
    );
    readonly archivePlaybackAvailable = computed(() =>
        isM3uCatchupPlaybackSupported(this.activeChannel())
    );
    /**
     * DASH (.mpd) playback always runs inline via the Shaka engine. True when
     * either the channel itself or the resolved catch-up URL is DASH —
     * mirroring the external-player guard in the m3u-state effects, so a
     * DASH-flavored session can never end up with no player at all.
     */
    readonly activeChannelIsDash = computed(
        () =>
            isDashStreamUrl(this.activePlaybackUrl() ?? undefined) ||
            isDashChannel(this.activeChannel())
    );
    /**
     * Player forced for DASH channels: ArtPlayer keeps ArtPlayer (it has a
     * Shaka source engine); every other choice — Video.js (no DASH bridge),
     * embedded/external MPV and VLC (no KODIPROP ClearKey support) — falls
     * back to the HTML5 player.
     */
    readonly dashPlayerOverride = computed<VideoPlayer>(() =>
        this.settingsStore.player() === VideoPlayer.ArtPlayer
            ? VideoPlayer.ArtPlayer
            : VideoPlayer.Html5Player
    );
    /**
     * The active channel is a movie FILE (URL-shape heuristic) and the user
     * has TMDB enrichment plus the recognition toggle on — the content area
     * shows the VOD detail experience instead of the player + EPG zone.
     * Synchronous on purpose: the layout is chosen at activation, and the
     * TMDB lookup inside the detail host only patches metadata afterwards.
     */
    readonly showMovieDetail = computed(() => {
        const channel = this.activeChannel();
        return (
            !!channel &&
            this.settingsStore.m3uVodDetails?.() !== false &&
            this.tmdbEnrichment.isEnabled() &&
            isLikelyM3uMovie(channel)
        );
    });
    /** Full multi-day programme window for the active channel (timeline). */
    readonly epgPrograms = toSignal(this.epgService.currentEpgPrograms$, {
        initialValue: [] as EpgProgram[],
    });
    // Shared helper skips blank strings (`tvg-rec=""` is a common default that
    // `??` would not fall through), so a channel with only `timeshift`/
    // `catchup-days` still gets its real window instead of 0 (unbounded).
    readonly epgArchiveDays = computed(() =>
        getM3uArchiveDays(this.activeChannel())
    );
    readonly timelineChannelName = computed(() =>
        applyChannelNameStrip(
            this.activeChannel()?.name,
            this.settingsStore.stripCountryPrefix?.()
        )
    );
    /** Channel name for the radio player header. */
    readonly displayChannelName = computed(() => {
        const channel = this.activeChannel();
        return applyChannelNameStrip(
            channel?.name || channel?.tvg?.name,
            this.settingsStore.stripCountryPrefix?.()
        );
    });
    /** Display title for the inline web player header. */
    readonly inlinePlayerTitle = computed(() =>
        applyChannelNameStrip(
            this.embeddedPlayback()?.title,
            this.settingsStore.stripCountryPrefix?.()
        )
    );
    /** Channel logo from the EPG feed (M3U playlists often lack tvg-logo). */
    private readonly epgChannelLogo = toSignal(
        toObservable(this.activeChannel).pipe(
            switchMap((channel) => {
                const key = channel ? resolveChannelEpgLookupKey(channel) : '';
                if (!key) {
                    return of('');
                }
                return this.epgService
                    .getChannelMetadataForChannels([key])
                    .pipe(
                        map(
                            (metadata) =>
                                metadata.get(key)?.iconUrl?.trim() || ''
                        ),
                        catchError(() => of(''))
                    );
            })
        ),
        { initialValue: '' }
    );
    readonly timelineChannelLogo = computed(
        () => this.activeChannel()?.tvg?.logo?.trim() || this.epgChannelLogo()
    );
    private readonly epgNowMs = signal(Date.now());
    readonly playbackChannel = computed<Channel | null>(() => {
        const activeChannel = this.activeChannel();
        if (!activeChannel) {
            return null;
        }

        const playbackUrl = this.activePlaybackUrl();
        if (!playbackUrl) {
            return activeChannel;
        }

        return {
            ...activeChannel,
            url: playbackUrl,
            epgParams: '',
        } as Channel;
    });
    readonly embeddedPlayback = computed<ResolvedPortalPlayback | null>(() => {
        const activeChannel = this.activeChannel();
        const playbackTarget = this.playbackChannel();

        if (!activeChannel || !playbackTarget) {
            return null;
        }

        // Embedded MPV requests bypass the Electron webRequest override, so
        // the playlist-level custom headers must ride in the payload; channel
        // #EXTVLCOPT values still win.
        const effective = resolveExternalPlayerHttpHeaders(
            playbackTarget,
            this.activePlaylistMeta()
        );
        const headers: Record<string, string> = {};
        if (effective['user-agent']) {
            headers['User-Agent'] = effective['user-agent'];
        }
        if (effective.referer) {
            headers['Referer'] = effective.referer;
        }
        if (effective.origin) {
            headers['Origin'] = effective.origin;
        }

        return {
            streamUrl: `${playbackTarget.url}${playbackTarget.epgParams ?? ''}`,
            title:
                activeChannel.name?.trim() ||
                activeChannel.tvg?.name ||
                playbackTarget.url,
            thumbnail: activeChannel.tvg?.logo ?? null,
            isLive: !this.activePlaybackUrl(),
            headers: Object.keys(headers).length > 0 ? headers : undefined,
            userAgent: effective['user-agent'],
            referer: effective.referer,
            origin: effective.origin,
            // Playlists imported before the DRM feature carry no drm field
            // yet, but their raw KODIPROP block survived in the stored items
            // — extract lazily so they work without a re-import.
            drm: playbackTarget.drm ?? extractDrmFromRaw(playbackTarget.raw),
        };
    });
    readonly sidebarStorageKey = computed(() =>
        this.activeView() === 'groups'
            ? M3U_GROUPS_SIDEBAR_STORAGE_KEY
            : M3U_SIDEBAR_STORAGE_KEY
    );
    readonly sidebarWidth = signal(M3U_SIDEBAR_DEFAULT_WIDTH);
    readonly sidebarMinWidth = M3U_SIDEBAR_MIN_WIDTH;
    readonly sidebarMaxWidth = M3U_SIDEBAR_MAX_WIDTH;
    readonly liveEpgPanelState = signal<LiveEpgPanelState>(
        restoreLiveEpgPanelState()
    );
    readonly selectedLiveEpgDate = signal(getTodayEpgDateKey());
    /** Live EPG panel layout chosen in settings; hosts swap timeline ↔ list. */
    readonly epgViewMode = this.settingsStore.resolvedEpgViewMode;
    readonly epgOffsetMinutes = this.settingsStore.resolvedEpgOffsetMinutes;
    readonly isLiveEpgPanelCollapsed = computed(
        () => this.liveEpgPanelState() === 'collapsed'
    );
    readonly liveSidebarState = signal<LiveSidebarState>(
        restoreLiveSidebarState()
    );
    readonly isSidebarCollapsed = computed(
        () => this.liveSidebarState() === 'collapsed'
    );

    /** Channels list */
    readonly channels$: Observable<Channel[]> = this.store.select(
        selectChannels
    ) as Observable<Channel[]>;

    /** Current epg program */
    readonly epgProgram = this.store.selectSignal(selectCurrentEpgProgram);
    readonly liveEpgPanelSummary = computed(() =>
        this.toLiveEpgPanelSummary(
            this.activeEpgProgramOrNull() ?? this.epgProgram()
        )
    );
    readonly liveEpgPanelSummaryLabelKey = computed(() =>
        this.activeEpgProgramOrNull()
            ? 'EPG.ARCHIVE_PLAYBACK'
            : 'EPG.CURRENT_PROGRAM'
    );
    private readonly activePlaylistMeta =
        this.store.selectSignal(selectActivePlaylist);
    private readonly recordingsService = inject(RecordingsService);
    /**
     * Channel/EPG snapshot for the embedded-MPV recording tracker, captured
     * at recording start (EPG cannot be reconstructed after the fact).
     */
    readonly recordingMetadata = computed<RecordingStartMetadata | null>(() => {
        const channel = this.activeChannel();
        if (!channel) {
            return null;
        }
        // Derive the airing program from the ACTIVE channel's own schedule
        // and the 30 s clock — the NgRx `currentEpgProgram` retains its last
        // value across a channel switch and through EPG gaps (the mirror
        // effect below only dispatches when a program exists), so it can
        // still describe the previous channel when recording starts. An EPG
        // gap must snapshot no program, not a stale one — stop enrichment
        // deliberately never overwrites a persisted start title.
        const program =
            findCurrentEpgProgram(
                this.epgPrograms(),
                epgProviderClockMs(this.epgNowMs(), this.epgOffsetMinutes())
            ) ?? null;
        const playlistName = playlistDisplayLabel(
            this.activePlaylistMeta()?.title
        );
        return {
            channelName:
                channel.name?.trim() || channel.tvg?.name?.trim() || 'Live TV',
            channelLogoUrl: this.timelineChannelLogo() || undefined,
            playlistId: this.activePlaylistId() || undefined,
            playlistName: playlistName || undefined,
            sourceType: 'm3u',
            epgChannelId: resolveChannelEpgLookupKey(channel) || undefined,
            // The EPG lookup key can be shared by several channels (same
            // tvgId, or the name fallback); the channel id is unique.
            sourceItemKey: channel.id,
            currentProgram: program
                ? toRecordingProgramSnapshot(program)
                : undefined,
        };
    });

    /**
     * Stop enrichment: report every program overlapping the recorded window
     * from the in-memory multi-day schedule (a recording can span a program
     * boundary). Fire-and-forget — a failed update leaves the start snapshot.
     */
    onRecordingStopped(event: RecordingStoppedEvent): void {
        // A channel switch auto-stops the recording, and by now this host
        // already describes the new channel — enriching then would attach the
        // wrong schedule (and could promote an unrelated program to the
        // recording's title).
        if (
            event.epgChannelId &&
            event.epgChannelId !== this.recordingMetadata()?.epgChannelId
        ) {
            return;
        }
        // The EPG key alone cannot tell two same-keyed channels apart —
        // the channel id must also match the exact recorded selection.
        if (
            event.sourceItemKey &&
            event.sourceItemKey !== this.recordingMetadata()?.sourceItemKey
        ) {
            return;
        }
        const programs = filterRecordingProgramsOverlap(
            this.epgPrograms().map(toRecordingProgramSnapshot),
            event.startedAt,
            event.endedAt,
            this.epgOffsetMinutes()
        );
        if (programs.length === 0) {
            return;
        }
        void this.recordingsService.updatePrograms(event.targetPath, programs);
    }
    /**
     * Without a single configured XMLTV source the whole playlist has no EPG,
     * so the panel's empty state should point at the EPG settings page
     * instead of implying that just this channel is unmapped. Only claims
     * "needs setup" when nothing contradicts it: no programmes for the
     * channel (uploaded XMLTV files produce programmes without any URL), no
     * global source in settings (legacy values may be a plain string), and no
     * playlist-scoped `url-tvg` source either.
     */
    readonly liveEpgEmptyReason = computed<EpgTimelineEmptyReason>(() => {
        if (this.epgPrograms().length > 0) {
            return 'none';
        }

        const globalSources = this.settingsStore.epgUrl?.() ?? [];
        const hasGlobalSources = Array.isArray(globalSources)
            ? globalSources.some((url) => Boolean(url?.trim?.()))
            : Boolean(globalSources);
        const hasPlaylistSources = (
            this.activePlaylistMeta()?.epgUrls ?? []
        ).some((url) => Boolean(url?.trim?.()));

        return hasGlobalSources || hasPlaylistSources
            ? 'none'
            : 'm3u-needs-setup';
    });
    readonly showReturnToLive = computed(
        () => this.activeEpgProgramOrNull() !== null
    );

    /** Active M3U view (all, groups, favorites, recent) */
    readonly activeView = toSignal(
        this.activatedRoute.params.pipe(
            map((params) => params['view'] || 'all')
        ),
        { initialValue: 'all' }
    );

    /** Selected video player options */
    playerSettings: Partial<Settings> = {
        player: VideoPlayer.VideoJs,
    };

    readonly isDesktop = this.runtime.isElectron;
    readonly supportsEpg = this.runtime.supportsEpg;
    readonly isWorkspaceLayout = isWorkspaceLayoutRoute(this.activatedRoute);

    /** EPG overlay reference */
    private overlayRef!: OverlayRef;
    private unsubscribeRemoteChannelChange?: () => void;
    private unsubscribeRemoteCommand?: () => void;
    private statusSubscription?: Subscription;
    private lastKnownVolume = 1;
    private lastRecordedRecentKey = '';
    private lastExternalSessionStateKey = this.getExternalSessionStateKey(
        this.externalPlayback.activeSession()
    );

    /** Channel number input state */
    channelNumberInput = '';
    showChannelNumberOverlay = false;
    private channelNumberTimeout?: number;

    /**
     * Volume handed to each new player instance, re-read from the shared
     * `volume` localStorage bus on every channel change.
     *
     * The bus is what the engines actually write to (they persist on
     * `volumechange` and never call back into this component), and every
     * channel switch mints a new source revision, which recreates the engine
     * component and re-reads this input. A plain constructor snapshot
     * therefore snapped playback back to the volume the page was opened
     * with as soon as the user zapped after adjusting it in the player.
     * Remote-control writes still `set()` this signal directly and store the
     * same value, so re-reading the bus per channel agrees with them.
     *
     * The source is the whole channel, not a derived key: `linkedSignal`
     * re-runs its computation whenever the source EXPRESSION invalidates —
     * the derived value's equality does not gate it (`producerRecomputeValue`
     * calls `computation()` right after re-evaluating `source()`). Selecting
     * the channel is therefore the trigger, which is exactly the intent, and
     * nothing here depends on ids being distinct — `createChannel` falls back
     * to the URL, so one stream listed in two groups shares an id. A re-read
     * is one idempotent localStorage hit, so an extra one costs nothing.
     */
    readonly volume = linkedSignal({
        source: () => this.activeChannel(),
        computation: () => readStoredVolume(),
    });

    constructor() {
        // React to settings changes
        effect(() => {
            this.playerSettings = {
                player: this.settingsStore.player(),
            };
        });

        // Keep "now" fresh so EPG state re-evaluates over time.
        effect((onCleanup) => {
            const intervalId = window.setInterval(
                () => this.epgNowMs.set(Date.now()),
                30_000
            );
            onCleanup(() => clearInterval(intervalId));
        });

        // Mirror the legacy uncontrolled epg-list store side effects so the
        // toolbar, summary and diagnostics keep reflecting the live programme.
        effect(() => {
            const channel = this.activeChannel();
            const nowMs = this.epgNowMs();

            // The old uncontrolled <app-epg-list> only existed (and only
            // dispatched these) while a non-radio channel was active and EPG
            // was supported. Outside that window it dispatched nothing, so the
            // flag/current-program held their last value. Preserve that to
            // avoid clobbering EPG state on radio/no-channel.
            if (!channel || channel.radio === 'true' || !this.supportsEpg) {
                return;
            }

            const programs = this.epgPrograms();
            this.store.dispatch(
                EpgActions.setEpgAvailableFlag({ value: programs.length > 0 })
            );

            // Raw programme times vs. now in the provider's EPG clock
            // (`epg-display-offset.util.ts`, clock form).
            const currentProgram = findCurrentEpgProgram(
                programs,
                epgProviderClockMs(nowMs, this.epgOffsetMinutes())
            );
            if (currentProgram) {
                this.store.dispatch(
                    EpgActions.setCurrentEpgProgram({ program: currentProgram })
                );
            } else if (!this.activePlaybackUrl()) {
                // No live programme right now. Only clear stale EPG state when
                // NOT in catch-up/timeshift: resetActiveEpgProgram also nulls
                // activePlaybackUrl, so firing it on every 30s tick would knock
                // the user out of an in-progress archive playback whenever the
                // channel has an EPG gap at the current clock time.
                this.store.dispatch(EpgActions.resetActiveEpgProgram());
            }
        });

        effect(() => {
            this.sidebarWidth.set(
                this.loadSidebarWidth(this.sidebarStorageKey())
            );
        });

        effect(() => {
            const playlistId = this.activePlaylistId();
            const activeChannel = this.activeChannel();

            if (!playlistId || !activeChannel?.url) {
                return;
            }

            const nextKey = `${playlistId}::${activeChannel.url}`;
            if (this.lastRecordedRecentKey === nextKey) {
                return;
            }

            this.lastRecordedRecentKey = nextKey;
            void this.persistRecentlyViewedChannel(playlistId, activeChannel);
        });

        effect(() => {
            const currentView = this.activeView();
            const channels = this.channels();
            const activeChannel = this.activeChannel();
            const state =
                this.router.currentNavigation()?.extras?.state ??
                window.history.state;
            const recentTargetUrl =
                typeof state?.openRecentChannelUrl === 'string'
                    ? state.openRecentChannelUrl.trim()
                    : '';
            const globalSearchTargetUrl =
                typeof state?.openM3uChannelUrl === 'string'
                    ? state.openM3uChannelUrl.trim()
                    : '';
            const targetUrl = globalSearchTargetUrl || recentTargetUrl;
            const canOpenGlobalSearchTarget =
                !!globalSearchTargetUrl && currentView === 'all';
            const canOpenRecentTarget =
                !!recentTargetUrl && currentView === 'recent';

            if (
                (!canOpenGlobalSearchTarget && !canOpenRecentTarget) ||
                !targetUrl ||
                channels.length === 0
            ) {
                return;
            }

            if (activeChannel?.url === targetUrl) {
                this.clearConsumedChannelOpenState();
                return;
            }

            const matchedChannel = channels.find(
                (channel) => channel.url === targetUrl
            );
            if (!matchedChannel) {
                return;
            }

            this.store.dispatch(
                ChannelActions.setActiveChannel({ channel: matchedChannel })
            );
            this.clearConsumedChannelOpenState();
        });

        effect(() => {
            const player = this.settingsStore.player();
            const session = this.externalPlayback.activeSession();
            const activeChannel = this.activeChannel();
            const sessionStateKey = this.getExternalSessionStateKey(session);

            if (sessionStateKey === this.lastExternalSessionStateKey) {
                return;
            }

            this.lastExternalSessionStateKey = sessionStateKey;

            if (
                !activeChannel ||
                !this.isExternalPlayer(player) ||
                !this.isTerminalExternalSession(session)
            ) {
                return;
            }

            this.store.dispatch(ChannelActions.resetActiveChannel());
        });

        // An external session starting or ending flips who owns the audio
        // without any store emission (e.g. a diagnostic-recovery MPV launch
        // while a web player is configured) — republish the volume
        // capability so the remote's buttons stay honest. Everything except
        // the session signal is read untracked: channel changes and volume
        // changes already publish through their own paths.
        effect(() => {
            this.externalPlayback.activeSession();
            untracked(() => {
                const remoteControl = this.remoteControlBridge;
                const activeChannel = this.activeChannel();
                if (
                    !remoteControl?.updateRemoteControlStatus ||
                    !activeChannel
                ) {
                    return;
                }

                remoteControl.updateRemoteControlStatus({
                    portal: 'm3u',
                    isLiveView: true,
                    supportsVolume: this.isRemoteVolumeSupported(activeChannel),
                    volume: this.volume(),
                    muted: this.volume() === 0,
                });
            });
        });
    }

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
        this.applySettings();
        this.getPlaylistUrlAsParam();
        this.registerHeaderShortcut();

        // Setup remote control channel change listener (Electron only)
        const remoteControl = this.remoteControlBridge;
        if (remoteControl?.onChannelChange) {
            const unsubscribe = remoteControl.onChannelChange(
                (data: { direction: 'up' | 'down' }) => {
                    this.handleRemoteChannelChange(data.direction);
                }
            );
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteChannelChange = unsubscribe;
            }
        }
        if (remoteControl?.onRemoteControlCommand) {
            const unsubscribe = remoteControl.onRemoteControlCommand(
                (command) => {
                    this.handleRemoteControlCommand(command);
                }
            );
            if (typeof unsubscribe === 'function') {
                this.unsubscribeRemoteCommand = unsubscribe;
            }
        }

        this.statusSubscription = combineLatest([
            this.channels$,
            this.store.select(selectActive),
            this.store.select(selectCurrentEpgProgram).pipe(startWith(null)),
        ]).subscribe(([channels, activeChannel, epgProgram]) => {
            const remoteControl = this.remoteControlBridge;
            if (!remoteControl?.updateRemoteControlStatus) {
                return;
            }

            // The active channel can be reset in place (e.g. the user quits
            // an external MPV/VLC session) — without a reset the remote
            // would keep advertising the last channel as live.
            if (!activeChannel) {
                remoteControl.updateRemoteControlStatus(
                    REMOTE_CONTROL_RESET_STATUS
                );
                return;
            }

            const currentEpgProgram = epgProgram as
                EpgProgram | null | undefined;
            const currentIndex = channels.findIndex(
                (channel) => channel.url === activeChannel.url
            );

            remoteControl.updateRemoteControlStatus({
                portal: 'm3u',
                isLiveView: true,
                channelName: activeChannel.name ?? activeChannel.tvg?.name,
                channelNumber: currentIndex >= 0 ? currentIndex + 1 : undefined,
                epgTitle: currentEpgProgram?.title,
                epgStart: currentEpgProgram?.start,
                epgEnd: currentEpgProgram?.stop,
                supportsVolume: this.isRemoteVolumeSupported(activeChannel),
                volume: this.volume(),
                muted: this.volume() === 0,
            });
        });
    }

    /**
     * Handle remote control channel change
     */
    handleRemoteChannelChange(direction: 'up' | 'down'): void {
        this.debugLog('Remote control channel change:', direction);

        // Use combineLatest to get both values and take only the first emission
        combineLatest([this.channels$, this.store.select(selectActive)])
            .pipe(
                filter(([channels, activeChannel]) => {
                    return channels.length > 0 && !!activeChannel;
                }),
                take(1),
                map(([channels, activeChannel]) => {
                    return {
                        channels,
                        activeChannel: activeChannel as Channel,
                    };
                })
            )
            .subscribe({
                next: ({ channels, activeChannel }) => {
                    const nextChannel = getAdjacentChannelItem(
                        channels,
                        activeChannel.url,
                        direction,
                        (channel) => channel.url
                    );

                    if (!nextChannel) {
                        return;
                    }

                    this.store.dispatch(
                        createM3uChannelPlaybackRequest(nextChannel)
                    );
                },
                error: (err) => {
                    console.error('Error changing channel:', err);
                },
            });
    }

    ngOnDestroy(): void {
        this.workspaceHeaderContext.clearAction(M3U_MULTI_EPG_HEADER_ACTION_ID);
        this.unsubscribeRemoteChannelChange?.();
        this.unsubscribeRemoteCommand?.();
        this.statusSubscription?.unsubscribe();
        // Leaving the player would otherwise keep the last channel advertised
        // as live on the remote forever.
        this.remoteControlBridge?.updateRemoteControlStatus?.(
            REMOTE_CONTROL_RESET_STATUS
        );
    }

    onSidebarWidthChange(width: number): void {
        this.sidebarWidth.set(this.clampSidebarWidth(width));
    }

    onSidebarResizeEnd(width: number): void {
        this.persistSidebarWidth(this.sidebarStorageKey(), width);
    }

    onGroupedSidebarWidthRequested(width: number): void {
        this.sidebarWidth.set(this.clampSidebarWidth(width));
    }

    onGroupedSidebarWidthRequestEnded(width: number): void {
        this.persistSidebarWidth(this.sidebarStorageKey(), width);
    }

    onLiveEpgPanelCollapsedChange(collapsed: boolean): void {
        const state: LiveEpgPanelState = collapsed ? 'collapsed' : 'expanded';
        this.liveEpgPanelState.set(state);
        persistLiveEpgPanelState(state);
    }

    toggleSidebar(): void {
        const next: LiveSidebarState = this.isSidebarCollapsed()
            ? 'expanded'
            : 'collapsed';
        this.liveSidebarState.set(next);
        persistLiveSidebarState(next);
    }

    onLiveEpgDateNavigation(direction: EpgDateNavigationDirection): void {
        this.selectedLiveEpgDate.set(
            shiftEpgDateKey(this.selectedLiveEpgDate(), direction)
        );
    }

    onLiveEpgSelectedDateChange(selectedDate: string): void {
        this.selectedLiveEpgDate.set(selectedDate);
    }

    returnToLivePlayback(): void {
        this.store.dispatch(EpgActions.returnToLivePlayback());
    }

    /** Deep link from the EPG panel's "needs setup" empty state */
    openEpgSettings(): void {
        void this.router.navigate(['/workspace/settings', 'epg']);
    }

    onTimelineProgramActivated(event: EpgProgramActivationEvent): void {
        if (event.type === 'live') {
            this.returnToLivePlayback();
            return;
        }
        this.store.dispatch(
            EpgActions.setActiveEpgProgram({ program: event.program })
        );
    }

    /**
     * Opens a playlist provided as a url param
     * e.g. iptvnat.or?url=http://...
     * @pwaOnly
     */
    getPlaylistUrlAsParam() {
        const URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;
        const playlistUrl = this.activatedRoute.snapshot.queryParams['url'];

        if (playlistUrl && playlistUrl.match(URL_REGEX)) {
            this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
                url: playlistUrl,
                isTemporary: true,
            });
        }
    }

    /**
     * Reads the app configuration from the browsers storage and applies the settings in the current component
     */
    applySettings(): void {
        this.storage.get(STORE_KEY.Settings).subscribe((settings: unknown) => {
            if (settings && Object.keys(settings as Settings).length > 0) {
                this.playerSettings = {
                    player:
                        (settings as Settings).player || VideoPlayer.VideoJs,
                };
            }
        });
    }

    private loadSidebarWidth(storageKey: string): number {
        const fallbackKey =
            storageKey === M3U_GROUPS_SIDEBAR_STORAGE_KEY
                ? M3U_SIDEBAR_STORAGE_KEY
                : '';
        const storedWidth = Number.parseInt(
            localStorage.getItem(storageKey) ??
                (fallbackKey ? localStorage.getItem(fallbackKey) : '') ??
                '',
            10
        );

        return this.clampSidebarWidth(
            Number.isNaN(storedWidth) ? M3U_SIDEBAR_DEFAULT_WIDTH : storedWidth
        );
    }

    private persistSidebarWidth(storageKey: string, width: number): void {
        const clampedWidth = this.clampSidebarWidth(width);
        this.sidebarWidth.set(clampedWidth);
        localStorage.setItem(storageKey, clampedWidth.toString());
    }

    private clampSidebarWidth(width: number): number {
        return Math.max(
            M3U_SIDEBAR_MIN_WIDTH,
            Math.min(M3U_SIDEBAR_MAX_WIDTH, width)
        );
    }

    private async persistRecentlyViewedChannel(
        playlistId: string,
        channel: Channel
    ): Promise<void> {
        const recentlyViewedItem: M3uRecentlyViewedItem = {
            source: 'm3u',
            id: channel.url,
            url: channel.url,
            title: channel.name?.trim() || channel.tvg?.name || channel.url,
            channel_id: channel.id,
            poster_url: channel.tvg?.logo || undefined,
            tvg_id: channel.tvg?.id || undefined,
            tvg_name: channel.tvg?.name || undefined,
            group_title: channel.group?.title || undefined,
            category_id: 'live',
            added_at: new Date().toISOString(),
        };

        const updatedPlaylist = await firstValueFrom(
            this.playlistsService.addM3uRecentlyViewed(
                playlistId,
                recentlyViewedItem
            )
        );

        this.store.dispatch(
            PlaylistActions.updatePlaylistMeta({
                playlist: {
                    _id: playlistId,
                    recentlyViewed: updatedPlaylist?.recentlyViewed ?? [],
                } as PlaylistMeta,
            })
        );
    }

    private clearConsumedChannelOpenState(): void {
        const historyState = (window.history.state ?? {}) as Record<
            string,
            unknown
        >;
        if (
            !historyState['openRecentChannelUrl'] &&
            !historyState['openM3uChannelUrl']
        ) {
            return;
        }

        try {
            const nextState = { ...historyState };
            delete nextState['openRecentChannelUrl'];
            delete nextState['openM3uChannelUrl'];
            window.history.replaceState(nextState, document.title);
        } catch {
            // no-op
        }
    }

    /**
     * Opens the overlay with multi EPG view
     */
    openMultiEpgView(): void {
        if (!this.supportsEpg) {
            return;
        }

        const positionStrategy = this.overlay
            .position()
            .global()
            .centerHorizontally()
            .centerVertically();

        this.overlayRef = this.overlay.create({
            hasBackdrop: true,
            positionStrategy,
            width: '100%',
            height: '100%',
        });

        const injector = Injector.create({
            providers: [
                {
                    provide: COMPONENT_OVERLAY_REF,
                    useValue: this.overlayRef,
                },
            ],
        });

        const portal = new ComponentPortal(
            MultiEpgContainerComponent,
            null,
            injector
        );

        const componentRef = this.overlayRef.attach(portal);
        componentRef.instance.playlistChannels = this.store.select(
            selectChannels
        ) as Observable<Channel[]>;

        // Pass the active channel's tvg.id for highlighting
        const currentChannel = this.activeChannel();
        if (currentChannel) {
            componentRef.instance.activeChannelId =
                currentChannel.tvg?.id || null;
        }

        this.overlayRef.backdropClick().subscribe(() => {
            this.overlayRef.dispose();
        });
    }

    @HostListener('document:keydown', ['$event'])
    handleKeyPress(event: KeyboardEvent): void {
        if (isTypingInInput(event)) {
            return;
        }
        // Behind the workspace's phone context drawer the route content is
        // inert; this document-level listener still fires, so it opts out
        // itself instead of switching channels or toggling the sidebar
        // behind the modal surface.
        if (this.hostElement.nativeElement.closest('[inert]')) {
            return;
        }
        if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'b'
        ) {
            event.preventDefault();
            this.toggleSidebar();
            return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) {
            return;
        }
        // PageUp/PageDown zap through the list like a remote's channel keys —
        // the one way to change channels from the keyboard in fullscreen.
        if (event.key === 'PageUp' || event.key === 'PageDown') {
            if (
                isInsideScrollableRegion(
                    event.target,
                    this.hostElement.nativeElement
                )
            ) {
                return;
            }
            // There is nothing to zap from until a channel is playing, and
            // handleRemoteChannelChange would park the press on a pending
            // subscription that fires the moment the user picks their first
            // channel — jumping straight off it.
            if (!this.activeChannel()) {
                return;
            }
            event.preventDefault();
            this.handleRemoteChannelChange(
                event.key === 'PageUp' ? 'up' : 'down'
            );
            return;
        }
        // Only handle digit keys (0-9)
        if (event.key >= '0' && event.key <= '9') {
            event.preventDefault();
            this.handleChannelNumberInput(event.key);
        }
    }

    /**
     * Handle channel number input from keyboard
     * Debounces input to allow multi-digit channel numbers
     */
    handleChannelNumberInput(digit: string): void {
        // Clear existing timeout
        if (this.channelNumberTimeout) {
            clearTimeout(this.channelNumberTimeout);
        }

        // Add digit to current input
        this.channelNumberInput += digit;
        this.showChannelNumberOverlay = true;

        // Set timeout to switch channel after 2 seconds of no input
        this.channelNumberTimeout = window.setTimeout(() => {
            this.switchToChannelByNumber(parseInt(this.channelNumberInput, 10));
            this.clearChannelNumberInput();
        }, 2000);
    }

    /**
     * Switch to channel by number (1-based index)
     */
    switchToChannelByNumber(channelNumber: number): void {
        this.channels$
            .pipe(
                take(1),
                map((channels) =>
                    getChannelItemByNumber(channels, channelNumber)
                )
            )
            .subscribe((channel) => {
                if (channel) {
                    this.store.dispatch(
                        createM3uChannelPlaybackRequest(channel)
                    );
                }
            });
    }

    /**
     * Clear channel number input and hide overlay
     */
    clearChannelNumberInput(): void {
        this.channelNumberInput = '';
        this.showChannelNumberOverlay = false;
        if (this.channelNumberTimeout) {
            clearTimeout(this.channelNumberTimeout);
            this.channelNumberTimeout = undefined;
        }
    }

    private handleRemoteControlCommand(command: {
        type:
            | 'channel-select-number'
            | 'volume-up'
            | 'volume-down'
            | 'volume-toggle-mute';
        number?: number;
    }): void {
        if (
            command.type !== 'channel-select-number' &&
            !this.isRemoteVolumeSupported(this.activeChannel())
        ) {
            // The active playback runs in MPV/VLC or Embedded MPV — adjusting
            // the stored web-player volume would silently do nothing audible.
            return;
        }

        if (command.type === 'channel-select-number' && command.number) {
            this.switchToChannelByNumber(command.number);
            return;
        }

        if (command.type === 'volume-up') {
            this.setVolume(this.volume() + 0.1);
        } else if (command.type === 'volume-down') {
            this.setVolume(this.volume() - 0.1);
        } else if (command.type === 'volume-toggle-mute') {
            if (this.volume() === 0) {
                this.setVolume(this.lastKnownVolume || 1);
            } else {
                this.lastKnownVolume = this.volume();
                this.setVolume(0);
            }
        }
    }

    /**
     * Pull the latest volume off the shared bus before a player is mounted
     * without a channel change (the movie detail's Browse → Play). The
     * engines persist their adjustments there and never call back, so the
     * remounted player would otherwise start at the pre-adjustment value.
     */
    refreshVolumeFromBus(): void {
        this.volume.set(readStoredVolume());
    }

    private setVolume(next: number): void {
        const clamped = Math.max(0, Math.min(1, Number(next.toFixed(2))));
        this.volume.set(clamped);
        if (clamped > 0) {
            this.lastKnownVolume = clamped;
        }
        localStorage.setItem('volume', String(clamped));

        const remoteControl = this.remoteControlBridge;
        if (remoteControl?.updateRemoteControlStatus) {
            remoteControl.updateRemoteControlStatus({
                portal: 'm3u',
                isLiveView: true,
                supportsVolume: this.isRemoteVolumeSupported(
                    this.activeChannel()
                ),
                volume: this.volume(),
                muted: this.volume() === 0,
            });
        }
    }

    onInlineVolumeChange(volume: number): void {
        this.setVolume(volume);
    }

    /**
     * Remote volume commands act on the built-in inline players only:
     * radio's audio element, the DASH-forced web player, and the HTML5/
     * Video.js/ArtPlayer engines. External MPV/VLC and Embedded MPV own
     * their audio, so advertising volume support there would enable remote
     * buttons that do nothing audible.
     */
    private isRemoteVolumeSupported(
        channel: Channel | null | undefined
    ): boolean {
        if (!channel) {
            return false;
        }
        // Radio's audio element is always mounted inline, so it stays
        // audible and controllable even if an older external session
        // lingers.
        if (channel.radio === 'true') {
            return true;
        }

        // A live external session owns the audio regardless of how it
        // started: a diagnostic-recovery "Open in MPV/VLC" launch while a
        // web player remains configured, or the managed clear-DASH fallback
        // after Shaka's browser-support preflight fails — the DASH-forced
        // inline player is not audible then, so this check must precede the
        // DASH shortcut.
        if (
            isLiveExternalPlayerSession(this.externalPlayback.activeSession())
        ) {
            return false;
        }

        if (this.activeChannelIsDash()) {
            return true;
        }

        const player = this.playerSettings.player;
        return (
            !this.isExternalPlayer(player) && player !== VideoPlayer.EmbeddedMpv
        );
    }

    private get remoteControlBridge(): Window['electron'] | undefined {
        return this.runtime.supportsRemoteControl ? window.electron : undefined;
    }

    shouldShowInlinePlayer(channel: Channel | null | undefined): boolean {
        if (!channel) {
            return false;
        }

        // DASH playback bypasses the external-player setting (radio
        // precedent): MPV/VLC cannot receive the KODIPROP ClearKey
        // configuration. Checked on the effective (possibly catch-up) URL.
        if (this.activeChannelIsDash()) {
            return true;
        }

        return !this.isExternalPlayer(this.playerSettings.player);
    }

    handleExternalFallbackRequest(request: PlaybackFallbackRequest): void {
        const payload = buildExternalPlayerPayload(
            this.activeChannel(),
            request.playback.streamUrl,
            this.activePlaylistMeta()
        );
        if (!payload) {
            return;
        }

        const launch = Promise.resolve(
            this.dataService.sendIpcEvent<ExternalPlayerSession>(
                request.player === 'mpv' ? OPEN_MPV_PLAYER : OPEN_VLC_PLAYER,
                payload
            )
        );
        request.trackLaunch(launch);
        void launch;
    }

    private toLiveEpgPanelSummary(
        program: EpgProgram | null | undefined
    ): LiveEpgPanelSummary | null {
        if (!program) {
            return null;
        }

        return {
            title: program.title,
            start: program.start,
            stop: program.stop,
        };
    }

    private getExternalSessionStateKey(
        session: ExternalPlayerSession | null | undefined
    ): string | null {
        if (!session) {
            return null;
        }

        const lifecycle = isLiveExternalPlayerSession(session)
            ? 'live'
            : 'terminal';
        return `${session.id}:${session.status}:${lifecycle}`;
    }

    private isExternalPlayer(
        player: VideoPlayer | null | undefined
    ): player is VideoPlayer.MPV | VideoPlayer.VLC {
        return player === VideoPlayer.MPV || player === VideoPlayer.VLC;
    }

    private isTerminalExternalSession(
        session: ExternalPlayerSession | null | undefined
    ): boolean {
        return !!session && !isLiveExternalPlayerSession(session);
    }

    private registerHeaderShortcut(): void {
        if (!this.isWorkspaceLayout || !this.supportsEpg) {
            return;
        }

        this.workspaceHeaderContext.setAction({
            id: M3U_MULTI_EPG_HEADER_ACTION_ID,
            icon: 'view_list',
            tooltipKey: 'TOP_MENU.OPEN_MULTI_EPG',
            ariaLabelKey: 'TOP_MENU.OPEN_MULTI_EPG',
            palette: {
                labelKey: 'TOP_MENU.OPEN_MULTI_EPG',
                descriptionKey:
                    'WORKSPACE.SHELL.COMMANDS.OPEN_MULTI_EPG_DESCRIPTION',
                keywords: ['epg', 'guide', 'schedule'],
                priority: 10,
            },
            run: () => this.openMultiEpgView(),
        });
    }
}

function findCurrentEpgProgram(
    programs: EpgProgram[],
    nowMs: number
): EpgProgram | undefined {
    return programs.find((program) => {
        const start = epgTimeMs(program.start, program.startTimestamp);
        const stop = epgTimeMs(program.stop, program.stopTimestamp);
        return nowMs >= start && nowMs <= stop;
    });
}

function epgTimeMs(isoValue: string, timestamp?: number | null): number {
    if (Number.isFinite(timestamp) && Number(timestamp) > 0) {
        return Number(timestamp) * 1000;
    }
    return Date.parse(isoValue);
}
