import {
    Component,
    OnDestroy,
    Signal,
    ViewEncapsulation,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import {
    Channel,
    ResolvedPortalPlayback,
    Settings,
    STORE_KEY,
    VideoPlayer,
    type VodSourceDescriptor,
} from '@iptvnator/shared/interfaces';
import type { ExternalPlayerName } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { VodSourceRowComponent } from '@iptvnator/ui/components';

/** How many recovery options the error screen shows before it stops helping. */
const ERROR_SCREEN_ALTERNATIVES = 5;
import { ArtPlayerComponent } from '../art-player/art-player.component';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import { HtmlVideoPlayerComponent } from '../html-video-player/html-video-player.component';
import {
    type PlayerMediaTitle,
    WEB_PLAYER_SHARED_CONTROLS,
    WEB_PLAYER_SHARED_CONTROLS_ENABLED,
} from '../player-controls';
import {
    type PlaybackDiagnostic,
    type PlaybackDiagnosticCode,
    type PlaybackFallbackRequest,
    getPlaybackMediaExtensionFromUrl,
} from '@iptvnator/playback/util';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { VjsPlayerComponent } from '../vjs-player/vjs-player.component';
import { ElectronStreamHeadersService } from './electron-stream-headers.service';
import {
    getDiagnosticCodecHint,
    getDiagnosticDescriptionKey,
    getDiagnosticDetails,
    getDiagnosticMeta,
    getDiagnosticTitleKey,
} from './web-player-view-diagnostics.utils';

function resolveWebPlayerSharedControls(): boolean {
    const storedValue = inject(SettingsStore).webPlayerSharedControls?.();
    return typeof storedValue === 'boolean'
        ? storedValue
        : WEB_PLAYER_SHARED_CONTROLS_ENABLED;
}

@Component({
    selector: 'app-web-player-view',
    templateUrl: './web-player-view.component.html',
    styleUrls: ['./web-player-view.component.scss'],
    host: {
        class: 'web-player-view',
    },
    imports: [
        ArtPlayerComponent,
        ClipboardModule,
        EmbeddedMpvPlayerComponent,
        HtmlVideoPlayerComponent,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        TranslatePipe,
        VjsPlayerComponent,
        VodSourceRowComponent,
    ],
    providers: [
        {
            provide: WEB_PLAYER_SHARED_CONTROLS,
            useFactory: resolveWebPlayerSharedControls,
        },
    ],
    encapsulation: ViewEncapsulation.None,
})
export class WebPlayerViewComponent implements OnDestroy {
    storage = inject(StorageMap);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);

    streamUrl = input.required<string>();
    title = input('');
    playback = input<ResolvedPortalPlayback | null>(null);
    startTime = input<number>(0);
    volume = input<number>(1);
    playerOverride = input<VideoPlayer | null>(null);
    seriesNavigation = input<SeriesPlaybackNavigation | null>(null);
    /** Display-ready title lines for the fullscreen overlay; hosts with richer
     * context (e.g. series name + episode label) pass it explicitly. */
    mediaTitle = input<PlayerMediaTitle | null>(null);
    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    /**
     * Alternative sources offered on the error screen, turning a dead end into
     * a recovery point. Empty (the default) keeps the overlay exactly as it
     * was for every non-multi-source host.
     */
    readonly alternativeSources = input<VodSourceDescriptor[]>([]);
    readonly alternativeSourceRequested = output<string>();
    /** The row's Check action, which has to reach the host that can probe. */
    readonly sourceCheckRequested = output<string>();
    /**
     * A playback failure the host may be able to recover from by switching
     * source. Emitted alongside showing the overlay, never instead of it: if
     * the host does nothing, the user still sees the honest error.
     */
    readonly playbackFailed = output<PlaybackDiagnosticCode>();

    /**
     * An error screen is a recovery point, not a catalogue. Offering fifty
     * options here is worse than offering the best few — the full list stays
     * one click away behind the player's own sources button.
     */
    readonly visibleAlternatives = computed(() =>
        this.alternativeSources().slice(0, ERROR_SCREEN_ALTERNATIVES)
    );
    readonly hiddenAlternativeCount = computed(() =>
        Math.max(0, this.alternativeSources().length - ERROR_SCREEN_ALTERNATIVES)
    );
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    settings = toSignal(this.storage.get(STORE_KEY.Settings)) as Signal<
        Settings | undefined
    >;

    /**
     * Subtitle preference for the built-in web players. Read from the settings
     * store instead of an input so every host (M3U, Xtream, Stalker, portal
     * detail pages) gets it without having to wire it through — the missing
     * bindings were why the setting looked like a no-op (#1155).
     */
    readonly showCaptions = computed(
        () => this.settingsStore.showCaptions?.() ?? false
    );

    channel!: Channel;
    vjsOptions!: {
        isLive: boolean;
        reloadToken: number;
        sources: { src: string; type: string }[];
    };
    readonly reloadToken = signal(0);
    readonly playbackDiagnostic = signal<PlaybackDiagnostic | null>(null);
    readonly visiblePlaybackDiagnostic = computed(() =>
        this.selectedPlayer() === VideoPlayer.EmbeddedMpv
            ? null
            : this.playbackDiagnostic()
    );
    readonly playbackInteractionEnabled = computed(
        () => this.visiblePlaybackDiagnostic() === null
    );
    readonly canShowExternalFallbackActions = computed(
        () =>
            this.runtime.supportsManagedExternalPlayers &&
            !!this.visiblePlaybackDiagnostic()?.externalFallbackRecommended
    );
    readonly diagnosticHeadlineKey = computed(() =>
        this.canShowExternalFallbackActions()
            ? 'PLAYBACK_DIAGNOSTICS.NATIVE_FALLBACK_TITLE'
            : 'PLAYBACK_DIAGNOSTICS.INLINE_FAILURE_TITLE'
    );

    readonly resolvedPlayback = computed<ResolvedPortalPlayback>(() => {
        const playback = this.playback();
        if (playback) {
            return playback;
        }

        return {
            streamUrl: this.streamUrl(),
            title: this.title() || this.streamUrl(),
            startTime: this.startTime(),
        };
    });
    readonly resolvedIsLive = computed(() => {
        const playback = this.resolvedPlayback();
        return typeof playback.isLive === 'boolean'
            ? playback.isLive
            : !playback.contentInfo;
    });
    readonly selectedPlayer = computed(
        () =>
            this.playerOverride() ??
            this.settings()?.player ??
            VideoPlayer.VideoJs
    );
    readonly resolvedMediaTitle = computed<PlayerMediaTitle | null>(() => {
        const explicit = this.mediaTitle();
        if (explicit?.primary?.trim()) {
            return explicit;
        }
        const playback = this.resolvedPlayback();
        const title = playback.title?.trim();
        // resolvedPlayback() falls back to the stream URL as title; a raw URL
        // is not a watchable overlay title.
        if (!title || title === playback.streamUrl) {
            return null;
        }
        return { primary: title, secondary: null };
    });
    readonly recordingFolder = computed(() => this.settings()?.recordingFolder ?? '');

    /** Stream URL the currently configured Electron header override belongs to. */
    private headerScopeStreamUrl: string | null = null;
    private readonly streamHeaders = inject(ElectronStreamHeadersService);

    constructor() {
        effect(() => {
            // Track player changes so stale browser diagnostics are cleared on switch.
            this.selectedPlayer();

            const playback = this.resolvedPlayback();
            const isLive = this.resolvedIsLive();
            this.playbackDiagnostic.set(null);
            this.applyPlayback(playback, isLive);
        });
    }

    ngOnDestroy(): void {
        // Portal credentials must not outlive the playback session that
        // needed them: dropping the scoped override here keeps only the
        // playlist-level (unscoped) User-Agent/Referer defaults active. The
        // service no-ops if a newer consumer already owns the override slot.
        this.streamHeaders.clear(this.headerScopeStreamUrl);
    }

    /**
     * Configures the scoped Electron request headers BEFORE the stream source
     * is handed to a player, so the very first media request already carries
     * them — an auth-gated portal stream answers 403 without its
     * Cookie/Authorization, and several engines treat that first failure as
     * fatal. In the PWA there is no header bridge and the source applies
     * synchronously, exactly as before.
     */
    private applyPlayback(
        playback: ResolvedPortalPlayback,
        isLive: boolean
    ): void {
        const headerSync = this.streamHeaders.apply(playback);
        this.headerScopeStreamUrl = playback.streamUrl;
        const handOff = (): void => {
            this.setChannel(playback);
            this.setVjsOptions(playback.streamUrl, isLive);
        };

        if (!headerSync) {
            handOff();
            return;
        }

        void headerSync.then((stillCurrent) => {
            if (stillCurrent) {
                handOff();
            }
        });
    }

    setVjsOptions(streamUrl: string, isLive = true) {
        const extension = getPlaybackMediaExtensionFromUrl(streamUrl);
        const mimeType =
            extension === 'm3u' || extension === 'm3u8'
                ? 'application/x-mpegURL'
                : extension === 'ts' || !extension
                  ? 'video/mp2t'
                  : extension === 'mkv'
                    ? 'video/matroska'
                    : 'video/mp4';

        this.vjsOptions = {
            isLive,
            reloadToken: untracked(() => this.reloadToken()),
            sources: [{ src: streamUrl, type: mimeType }],
        };
    }

    setChannel(playbackOrUrl: ResolvedPortalPlayback | string) {
        const playback =
            typeof playbackOrUrl === 'string'
                ? {
                      streamUrl: playbackOrUrl,
                      title: playbackOrUrl,
                  }
                : playbackOrUrl;

        this.channel = {
            id: playback.streamUrl,
            url: playback.streamUrl,
            name: playback.title || playback.streamUrl,
            group: { title: '' },
            tvg: {
                id: '',
                name: playback.title || playback.streamUrl,
                url: '',
                logo: playback.thumbnail ?? '',
                rec: '',
            },
            http: {
                referrer:
                    playback.referer ??
                    this.getHeaderValue(playback.headers, 'Referer') ??
                    '',
                'user-agent':
                    playback.userAgent ??
                    this.getHeaderValue(playback.headers, 'User-Agent') ??
                    '',
                origin:
                    playback.origin ??
                    this.getHeaderValue(playback.headers, 'Origin') ??
                    '',
            },
            radio: 'false',
            drm: playback.drm,
        };
    }

    handlePlaybackIssue(issue: PlaybackDiagnostic | null): void {
        if (this.selectedPlayer() === VideoPlayer.EmbeddedMpv) {
            this.playbackDiagnostic.set(null);
            return;
        }

        this.playbackDiagnostic.set(issue);
        if (issue) {
            this.playbackFailed.emit(issue.code);
        }
    }

    requestExternalFallback(player: ExternalPlayerName): void {
        const diagnostic = this.visiblePlaybackDiagnostic();
        if (!diagnostic) {
            return;
        }

        this.externalFallbackRequested.emit({
            player,
            playback: this.resolvedPlayback(),
            diagnostic,
        });
    }

    retryPlayback(): void {
        const playback = this.resolvedPlayback();

        this.playbackDiagnostic.set(null);
        this.reloadToken.update((value) => value + 1);
        this.setChannel(playback);
        this.setVjsOptions(playback.streamUrl, this.resolvedIsLive());
    }

    readonly getDiagnosticTitleKey = getDiagnosticTitleKey;
    readonly getDiagnosticMeta = getDiagnosticMeta;
    readonly getDiagnosticCodecHint = getDiagnosticCodecHint;
    readonly getDiagnosticDetails = getDiagnosticDetails;

    getDiagnosticDescriptionKey(issue: PlaybackDiagnostic): string {
        return getDiagnosticDescriptionKey(
            issue,
            this.runtime.supportsManagedExternalPlayers
        );
    }

    private getHeaderValue(
        headers: ResolvedPortalPlayback['headers'] | undefined,
        name: string
    ): string | undefined {
        if (!headers) {
            return undefined;
        }

        const matchingKey = Object.keys(headers).find(
            (key) => key.toLowerCase() === name.toLowerCase()
        );
        return matchingKey ? headers[matchingKey] : undefined;
    }
}
