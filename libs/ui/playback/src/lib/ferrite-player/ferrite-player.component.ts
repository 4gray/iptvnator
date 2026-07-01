import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    HostListener,
    inject,
    input,
    NgZone,
    OnDestroy,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { Channel, createDevLogger } from '@iptvnator/shared/interfaces';
import {
    persistVolume,
    readStoredVolume,
} from '../embedded-mpv-player/embedded-mpv-format.utils';
import { type PlaybackDiagnostic } from '../playback-diagnostics/playback-diagnostics.util';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import Ferrite, { type FerritePlayer } from 'ferrite.js';
import { FerriteControlsComponent } from './ferrite-controls.component';
import { FerriteDebugOverlayComponent } from './ferrite-debug-overlay.component';
import {
    ferriteAssetUrls,
    startFerriteSession,
    stopFerriteSession,
} from './ferrite-session';
import { wireOverlayInteractions } from './overlay-interactions';

const debugFerritePlayer = createDevLogger('FerritePlayer');

/**
 * Ferrite player — the 4th sibling inline player (canvas + WASM software/WebCodecs decode), wired
 * into WebPlayerViewComponent's `selectedPlayer()` ladder for `VideoPlayer.Ferrite`. Same component
 * I/O as `HtmlVideoPlayerComponent`, but ferrite renders to a `<canvas>` and is driven through the
 * mpegts.js-shaped facade (`attachCanvas` instead of `attachMediaElement`). It is the high-value
 * path for the PWA / no-HW-HEVC case where `<video>`+hls.js/mpegts.js can't software-decode HEVC.
 *
 * On top of the bare canvas it composes two overlays: an auto-hiding
 * Material controls bar (play/mute/volume/fullscreen) and a long-press diagnostic panel (the latter
 * is critical on a devtools-less PWA device — it reveals `isolated: NO` when COOP/COEP is missing).
 *
 * Handles both live and VOD: the `isLive` input drives the facade's source transport (live =
 * reconnecting edge; VOD = bounded forward-range + clean EOF). VOD is the path for HEVC
 * movies the browser player can't decode in software.
 * Ferrite needs `crossOriginIsolated` (COOP/COEP) for SharedArrayBuffer; when it is off the facade
 * surfaces an explicit unsupported-codec ERROR (degrade-gracefully) which the host classifies into
 * the external-fallback banner.
 */
@Component({
    selector: 'app-ferrite-player',
    templateUrl: './ferrite-player.component.html',
    styleUrls: ['./ferrite-player.component.scss'],
    imports: [
        SeriesPlaybackNavigationControlsComponent,
        FerriteControlsComponent,
        FerriteDebugOverlayComponent,
    ],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FerritePlayerComponent implements OnDestroy {
    readonly channel = input<Channel>();
    // Live vs VOD, fed from web-player-view (resolvedPlayback.isLive). Drives the facade's source
    // transport: live = reconnecting edge; VOD = bounded forward-range source with a finite duration
    // + clean EOF. Default true (the live channel case).
    readonly isLive = input(true);
    // Null-sentinel: the parent passes a real volume (0..1) to drive the player, or `null` to mean
    // "no opinion — keep the localStorage-restored value". Avoids a synthetic default clobbering the
    // restored volume while still applying a genuine initial parent value (mirrors AudioPlayerComponent).
    readonly volume = input<number | null>(null);
    // startTime = the VOD resume position (seconds); consumed in playChannel — we seek to it once the
    // source is seekable. showCaptions is accepted for parity with HtmlVideoPlayerComponent but caption
    // rendering is not wired yet. Both are no-ops for live.
    readonly startTime = input(0);
    readonly showCaptions = input(false);
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);

    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackIssue = output<PlaybackDiagnostic | null>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    private readonly canvasRef =
        viewChild<ElementRef<HTMLCanvasElement>>('canvas');
    private readonly shellRef = viewChild<ElementRef<HTMLElement>>('shell');
    private readonly zone = inject(NgZone);

    // --- overlay UI state (read by the two child overlay components) ---------------------------
    protected readonly paused = signal(false);
    protected readonly muted = signal(false);
    protected readonly uiVolume = signal(1);
    protected readonly fullscreen = signal(false);
    protected readonly controlsVisible = signal(true);
    // Debug panel (long-press toggled, off by default). `isolated` is page-global + constant.
    protected readonly dbgVisible = signal(false);
    protected readonly dbgIsolated = !!Ferrite.getFeatureList()['crossOriginIsolated'];
    protected readonly dbgTier = signal('—');
    protected readonly dbgFormat = signal('—');
    protected readonly dbgStatus = signal('idle');
    protected readonly dbgClock = signal('—');

    // Software-tier deinterlace control. `deintSupported` gates the select to the software tier (the
    // WC/HW tier deinterlaces in hardware); `deintMode` mirrors the worker's auto default; `deintFailed`
    // lights the "deint n/a" warning from the DEINT_FAILED event (which carries the live failed state).
    protected readonly deintMode = signal(1);
    protected readonly deintFailed = signal(false);
    // Audio-dynamics ("Dyna") control (0=line, 1=RF, 2=night); always shown; reset per stream like deint.
    protected readonly dynaMode = signal(0);
    // `dbgTier` carries the facade's authoritative decode tier (`player.tier`, fed by the MEDIA_INFO
    // wiring), not a cosmetic label — so gating the deint select on it is sound: deint is a
    // software-avfilter feature, unavailable on the WebCodecs/HW tier.
    protected readonly deintSupported = computed(
        () => this.dbgTier() === 'software'
    );

    // VOD playhead — fed from TIME_UPDATE; drives the controls' seek bar. duration is 0 for live (the
    // facade reports Infinity, normalised to 0 here) and finite for a seekable VOD source.
    protected readonly currentTime = signal(0);
    protected readonly duration = signal(0);

    // Keys the template <canvas> by the EFFECTIVE source URL (url + epgParams, matching playChannel) so
    // a channel zap — or an epgParams-only change — recreates the element. A canvas handed to the
    // present worker via transferControlToOffscreen() can never be re-attached.
    protected readonly canvasKey = computed(() => {
        const channel = this.channel();
        const url = channel?.url ? channel.url + (channel.epgParams ?? '') : '';
        return url ? [url] : [];
    });

    private player: FerritePlayer | null = null;
    private detachInteractions: (() => void) | null = null;
    /** The URL + canvas the active player was created for — guards against re-creating on no-op
     *  re-renders, AND forces a re-attach if the canvas element identity ever changes (a stale
     *  canvas would otherwise keep getting rendered while the visible one stays black). */
    private currentUrl = '';
    private currentCanvas: HTMLCanvasElement | null = null;

    // Same-origin engine + worker-chunk URLs (see ferrite-session.ts for why they must be explicit).
    private readonly urls = ferriteAssetUrls();

    constructor() {
        this.uiVolume.set(readStoredVolume());

        // (Re)start playback whenever the channel changes OR the (per-channel, keyed) canvas resolves.
        // Reading both signals makes the effect re-run on canvas attach (view-init ordering) and on zap.
        effect(() => {
            const channel = this.channel();
            const canvas = this.canvasRef()?.nativeElement;
            if (!channel?.url || !canvas) {
                return;
            }
            untracked(() => this.playChannel(channel, canvas));
        });

        // Wire the overlay pointer interactions to the canvas + shell. The canvas is recreated per
        // channel (keyed @for), so re-bind on every canvas change: detach the previous listeners and
        // wire the new element. Registered OUTSIDE the Angular zone so a routine pointermove does NOT
        // trigger an app tick; the signal writes still drive OnPush via the signal scheduler, and
        // set(true) when already true is a no-op. Only reveal/hide/long-press transitions re-render.
        effect(() => {
            const canvas = this.canvasRef()?.nativeElement;
            const shell = this.shellRef()?.nativeElement;
            if (!canvas || !shell) {
                return;
            }
            this.detachInteractions?.();
            this.detachInteractions = this.zone.runOutsideAngular(() =>
                wireOverlayInteractions(shell, canvas, {
                    onActivity: () => this.controlsVisible.set(true),
                    onIdle: () => this.controlsVisible.set(false),
                    onLongPress: () => this.dbgVisible.update((v) => !v),
                })
            );
        });

        // External volume applied live without restarting. `null` = the parent has no opinion → keep
        // the localStorage-restored value; a real number (incl. the genuine initial value) applies.
        effect(() => {
            const v = this.volume();
            untracked(() => {
                if (v === null) {
                    return;
                }
                this.applyVolume(v, false);
            });
        });
    }

    private playChannel(channel: Channel, canvas: HTMLCanvasElement): void {
        const url = channel.url + (channel.epgParams ?? '');
        if (this.player && url === this.currentUrl && canvas === this.currentCanvas) {
            return; // same source on the same canvas — re-render without churn
        }
        this.teardown();
        this.currentUrl = url;
        this.currentCanvas = canvas;
        this.playbackIssue.emit(null);
        this.paused.set(false);
        this.dbgStatus.set('loading');
        this.dbgTier.set('—');
        this.dbgFormat.set('—');
        this.deintMode.set(1); // auto — the worker's default for the new stream
        this.deintFailed.set(false);
        this.dynaMode.set(0); // line — the facade's setDrc default for the new stream

        // Create + wire + start the session (player creation runs outside the Angular zone — see
        // ferrite-session.ts). The component owns only the signal/output sinks it writes into.
        this.player = startFerriteSession({
            url,
            isLive: this.isLive(),
            canvas,
            zone: this.zone,
            urls: this.urls,
            volume: this.uiVolume(),
            muted: this.muted(),
            startTime: this.startTime(),
            sinks: {
                status: this.dbgStatus,
                tier: this.dbgTier,
                format: this.dbgFormat,
                clock: this.dbgClock,
                dbgVisible: this.dbgVisible,
                deintFailed: this.deintFailed,
                currentTime: this.currentTime,
                duration: this.duration,
                emitIssue: (d) => this.playbackIssue.emit(d),
                emitTimeUpdate: (t) => this.timeUpdate.emit(t),
                emitEnded: () => this.playbackEnded.emit(),
            },
        });
    }

    // --- overlay control actions (wired from the child controls component) ---------------------
    protected togglePlay(): void {
        const player = this.player;
        if (!player) {
            return;
        }
        // Capture the intended state before the toggle: play() is async, so reading
        // player.paused immediately afterwards may still return the pre-toggle value.
        const nextPaused = !player.paused;
        this.zone.runOutsideAngular(() => {
            if (player.paused) {
                void player.play();
            } else {
                player.pause();
            }
        });
        this.paused.set(nextPaused);
        this.dbgStatus.set(nextPaused ? 'paused' : 'playing');
    }

    protected toggleMute(): void {
        const player = this.player;
        if (!player) {
            return;
        }
        const m = !this.muted();
        player.muted = m;
        this.muted.set(m);
    }

    protected onVolumeInput(v: number): void {
        this.applyVolume(v, true);
    }

    /** Software-tier deinterlace override (0=off, 1=auto, 3=bwdif). Drives the facade's setDeint();
     *  no-op on the WC/HW tier (the select is hidden there via `deintSupported`). */
    protected onDeintChange(mode: number): void {
        this.deintMode.set(mode);
        this.player?.setDeint(mode);
    }

    /** Audio-dynamics ("Dyna") override (0=line, 1=RF, 2=night) → facade setDrc(); applies to both tiers. */
    protected onDynaChange(mode: number): void {
        this.dynaMode.set(mode);
        this.player?.setDrc(mode);
    }

    /** Seek to `seconds` (VOD only — a no-op on a non-seekable/live source inside the facade). */
    protected onSeek(seconds: number): void {
        this.player?.seek(seconds);
        this.currentTime.set(seconds);
    }

    private applyVolume(v: number, persist: boolean): void {
        const clamped = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
        this.uiVolume.set(clamped);
        if (clamped > 0 && this.muted()) {
            this.muted.set(false);
            if (this.player) {
                this.player.muted = false;
            }
        }
        if (this.player) {
            this.player.volume = clamped;
        }
        if (persist) {
            persistVolume(clamped);
        }
    }

    protected toggleFullscreen(): void {
        const shell = this.shellRef()?.nativeElement;
        if (!shell) {
            return;
        }
        if (document.fullscreenElement) {
            void document.exitFullscreen();
        } else {
            void shell.requestFullscreen?.();
        }
    }

    @HostListener('document:fullscreenchange')
    protected onFullscreenChange(): void {
        const shell = this.shellRef()?.nativeElement;
        this.fullscreen.set(
            !!document.fullscreenElement && document.fullscreenElement === shell
        );
    }

    private teardown(): void {
        const player = this.player;
        if (!player) {
            return;
        }
        this.player = null;
        this.currentUrl = '';
        this.currentCanvas = null;
        stopFerriteSession(player, this.zone, debugFerritePlayer);
    }

    ngOnDestroy(): void {
        this.detachInteractions?.();
        this.detachInteractions = null;
        this.teardown();
    }
}
