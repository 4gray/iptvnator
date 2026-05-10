import {
    Component,
    EventEmitter,
    Output,
    Signal,
    ViewEncapsulation,
    computed,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ClipboardModule } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import { getExtensionFromUrl } from 'm3u-utils';
import {
    ResolvedPortalPlayback,
    Settings,
    STORE_KEY,
    VideoPlayer,
} from 'shared-interfaces';
import type { ExternalPlayerName } from 'shared-interfaces';
import { ArtPlayerComponent } from '../art-player/art-player.component';
import { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import { HtmlVideoPlayerComponent } from '../html-video-player/html-video-player.component';
import {
    type PlaybackDiagnostic,
    PlaybackDiagnosticCode,
    type PlaybackFallbackRequest,
} from '../playback-diagnostics/playback-diagnostics.util';
import { VjsPlayerComponent } from '../vjs-player/vjs-player.component';

@Component({
    selector: 'app-web-player-view',
    templateUrl: './web-player-view.component.html',
    styleUrls: ['./web-player-view.component.scss'],
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
    ],
    encapsulation: ViewEncapsulation.None,
})
export class WebPlayerViewComponent {
    storage = inject(StorageMap);

    streamUrl = input.required<string>();
    title = input('');
    playback = input<ResolvedPortalPlayback | null>(null);
    startTime = input<number>(0);
    volume = input<number>(1);
    showCaptions = input<boolean>(false);
    playerOverride = input<VideoPlayer | null>(null);
    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();
    @Output() externalFallbackRequested =
        new EventEmitter<PlaybackFallbackRequest>();

    settings = toSignal(
        this.storage.get(STORE_KEY.Settings)
    ) as Signal<Settings>;

    channel!: { url: string };
    player!: VideoPlayer;
    vjsOptions!: { sources: { src: string; type: string }[] };
    readonly isDesktop = signal(this.detectDesktop());
    readonly playbackDiagnostic = signal<PlaybackDiagnostic | null>(null);
    readonly canShowExternalFallbackActions = computed(
        () =>
            this.isDesktop() &&
            !!this.playbackDiagnostic()?.externalFallbackRecommended
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
    readonly selectedPlayer = computed(
        () =>
            this.playerOverride() ??
            this.settings()?.player ??
            VideoPlayer.VideoJs
    );

    constructor() {
        effect(() => {
            this.player = this.selectedPlayer();

            const playback = this.resolvedPlayback();
            this.playbackDiagnostic.set(null);
            this.setChannel(playback.streamUrl);
            this.setVjsOptions(playback.streamUrl);
        });
    }

    setVjsOptions(streamUrl: string) {
        const extension = getExtensionFromUrl(streamUrl);
        const mimeType =
            extension === 'm3u' || extension === 'm3u8'
                ? 'application/x-mpegURL'
                : extension === 'ts'
                  ? 'video/mp2t'
                  : 'video/mp4';

        this.vjsOptions = {
            sources: [{ src: streamUrl, type: mimeType }],
        };
    }

    setChannel(streamUrl: string) {
        this.channel = {
            url: streamUrl,
        };
    }

    handlePlaybackIssue(issue: PlaybackDiagnostic | null): void {
        this.playbackDiagnostic.set(issue);
    }

    requestExternalFallback(player: ExternalPlayerName): void {
        const diagnostic = this.playbackDiagnostic();
        if (!diagnostic) {
            return;
        }

        this.externalFallbackRequested.emit({
            player,
            playback: this.resolvedPlayback(),
            diagnostic,
        });
    }

    getDiagnosticTitleKey(issue: PlaybackDiagnostic): string {
        return `${this.getDiagnosticTranslationBase(issue)}.TITLE`;
    }

    getDiagnosticDescriptionKey(issue: PlaybackDiagnostic): string {
        return `${this.getDiagnosticTranslationBase(issue)}.DESCRIPTION`;
    }

    getDiagnosticMeta(issue: PlaybackDiagnostic): string {
        const codecs = [...issue.videoCodecs, ...issue.audioCodecs].join(', ');
        if (codecs) {
            return codecs;
        }

        return issue.container || issue.mimeType || issue.details || '';
    }

    private getDiagnosticTranslationBase(issue: PlaybackDiagnostic): string {
        switch (issue.code) {
            case PlaybackDiagnosticCode.UnsupportedContainer:
                return 'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CONTAINER';
            case PlaybackDiagnosticCode.UnsupportedCodec:
                return 'PLAYBACK_DIAGNOSTICS.UNSUPPORTED_CODEC';
            case PlaybackDiagnosticCode.MediaDecodeError:
                return 'PLAYBACK_DIAGNOSTICS.MEDIA_DECODE_ERROR';
            case PlaybackDiagnosticCode.NetworkError:
                return 'PLAYBACK_DIAGNOSTICS.NETWORK_ERROR';
            case PlaybackDiagnosticCode.DrmOrEncryption:
                return 'PLAYBACK_DIAGNOSTICS.DRM_OR_ENCRYPTION';
            case PlaybackDiagnosticCode.UnknownPlaybackError:
            default:
                return 'PLAYBACK_DIAGNOSTICS.UNKNOWN_PLAYBACK_ERROR';
        }
    }

    private detectDesktop(): boolean {
        return typeof window !== 'undefined' && !!window.electron;
    }
}
