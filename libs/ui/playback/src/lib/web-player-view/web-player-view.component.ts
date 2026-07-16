import {
    Component,
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import {
    Channel,
    ResolvedPortalPlayback,
    Settings,
    STORE_KEY,
    VideoPlayer,
    normalizeLocalTimeshiftSettings,
} from '@iptvnator/shared/interfaces';
import type { ExternalPlayerName } from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { ArtPlayerComponent } from '../art-player/art-player.component';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import { HtmlVideoPlayerComponent } from '../html-video-player/html-video-player.component';
import {
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    type PlaybackFallbackRequest,
    getLikelyBrowserUnsupportedCodecLabels,
    getPlaybackMediaExtensionFromUrl,
} from '../playback-diagnostics/playback-diagnostics.util';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { VjsPlayerComponent } from '../vjs-player/vjs-player.component';
import { LocalTimeshiftCoordinator } from '../timeshift/local-timeshift-coordinator';
import {
    diagnosticTranslationBase,
    formatDiagnosticPlayer,
    formatDiagnosticSource,
    isInlinePlayer,
    isLivePlayback,
    toPlaybackChannel,
} from './web-player-view.utils';

type PlaybackDiagnosticDetail = {
    readonly labelKey: string;
    readonly value: string;
};

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
        MatProgressSpinnerModule,
        MatTooltipModule,
        TranslatePipe,
        VjsPlayerComponent,
    ],
    providers: [LocalTimeshiftCoordinator],
    encapsulation: ViewEncapsulation.None,
})
export class WebPlayerViewComponent {
    storage = inject(StorageMap);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly localTimeshift = inject(LocalTimeshiftCoordinator);

    streamUrl = input.required<string>();
    title = input('');
    playback = input<ResolvedPortalPlayback | null>(null);
    startTime = input<number>(0);
    volume = input<number>(1);
    showCaptions = input<boolean>(false);
    playerOverride = input<VideoPlayer | null>(null);
    seriesNavigation = input<SeriesPlaybackNavigation | null>(null);
    readonly timeUpdate = output<{
        currentTime: number;
        duration: number;
    }>();
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    settings = toSignal(this.storage.get(STORE_KEY.Settings)) as Signal<
        Settings | undefined
    >;

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
    readonly recordingFolder = computed(
        () => this.settings()?.recordingFolder ?? ''
    );
    readonly playerPlayback = this.localTimeshift.playback;
    readonly timeshiftStarting = this.localTimeshift.isStarting;
    readonly localTimeshiftActive = this.localTimeshift.isActive;
    readonly localTimeshiftError = this.localTimeshift.error;

    constructor() {
        effect(() => {
            const playback = this.resolvedPlayback();
            const selectedPlayer = this.selectedPlayer();
            const settings = normalizeLocalTimeshiftSettings(
                this.settings()?.localTimeshift
            );

            this.playbackDiagnostic.set(null);
            this.localTimeshift.configure(
                playback,
                settings,
                this.runtime.supportsLocalTimeshift &&
                    isInlinePlayer(selectedPlayer)
            );
        });

        effect(() => {
            // Track player changes so stale browser diagnostics are cleared on switch.
            this.selectedPlayer();

            const playback = this.playerPlayback();
            if (!playback) {
                return;
            }
            this.playbackDiagnostic.set(null);
            this.setChannel(playback);
            this.setVjsOptions(playback.streamUrl, isLivePlayback(playback));
        });
    }

    setVjsOptions(streamUrl: string, isLive = true) {
        const extension = getPlaybackMediaExtensionFromUrl(streamUrl);
        const mimeType =
            extension === 'm3u' || extension === 'm3u8'
                ? 'application/x-mpegURL'
                : extension === 'ts' || !extension
                  ? 'video/mp2t'
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

        this.channel = toPlaybackChannel(playback);
    }

    handlePlaybackIssue(issue: PlaybackDiagnostic | null): void {
        if (this.selectedPlayer() === VideoPlayer.EmbeddedMpv) {
            this.playbackDiagnostic.set(null);
            return;
        }

        this.playbackDiagnostic.set(issue);
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
        const playback = this.playerPlayback() ?? this.resolvedPlayback();

        this.playbackDiagnostic.set(null);
        this.reloadToken.update((value) => value + 1);
        this.setChannel(playback);
        this.setVjsOptions(playback.streamUrl, isLivePlayback(playback));
    }

    getDiagnosticTitleKey(issue: PlaybackDiagnostic): string {
        return `${diagnosticTranslationBase(issue)}.TITLE`;
    }

    getDiagnosticDescriptionKey(issue: PlaybackDiagnostic): string {
        if (
            issue.code === PlaybackDiagnosticCode.BrowserAccessError &&
            !this.runtime.supportsManagedExternalPlayers
        ) {
            return 'PLAYBACK_DIAGNOSTICS.BROWSER_ACCESS_ERROR.PWA_DESCRIPTION';
        }

        return `${diagnosticTranslationBase(issue)}.DESCRIPTION`;
    }

    getDiagnosticMeta(issue: PlaybackDiagnostic): string {
        const codecs = [...issue.videoCodecs, ...issue.audioCodecs].join(', ');
        if (codecs) {
            return codecs;
        }

        return issue.container || issue.mimeType || '';
    }

    getDiagnosticCodecHint(issue: PlaybackDiagnostic): string {
        return getLikelyBrowserUnsupportedCodecLabels(issue).join(', ');
    }

    getDiagnosticDetails(
        issue: PlaybackDiagnostic
    ): readonly PlaybackDiagnosticDetail[] {
        return [
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_CODE',
                value: issue.code,
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_PLAYER',
                value: formatDiagnosticPlayer(issue.player),
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_SOURCE',
                value: formatDiagnosticSource(issue.source),
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_CONTAINER',
                value: issue.container,
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_MIME_TYPE',
                value: issue.mimeType ?? '',
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_VIDEO_CODECS',
                value: issue.videoCodecs.join(', '),
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_AUDIO_CODECS',
                value: issue.audioCodecs.join(', '),
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_NATIVE_ERROR_CODE',
                value: issue.nativeErrorCode?.toString() ?? '',
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_NATIVE_ERROR_MESSAGE',
                value: issue.nativeErrorMessage ?? '',
            },
            {
                labelKey: 'PLAYBACK_DIAGNOSTICS.DETAIL_ERROR_DETAILS',
                value: issue.details ?? '',
            },
        ].filter(({ value }) => value.trim().length > 0);
    }
}
