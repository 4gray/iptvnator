import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    EventEmitter,
    OnDestroy,
    Output,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { PlayerControlsComponent } from '../player-controls';
import { readStoredVolume } from '../player-controls';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { EmbeddedMpvControlsAdapter } from './embedded-mpv-controls.adapter';
import { measureBounds } from './embedded-mpv-compositor';
import { EmbeddedMpvImmersiveService } from './embedded-mpv-immersive.service';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

/**
 * Hosts the native embedded MPV surface and wires it to the shared
 * {@link PlayerControlsComponent} via {@link EmbeddedMpvControlsAdapter}.
 *
 * Immersive overlay (option b): the native MPV surface is composited BELOW the
 * WebContents (native addon built with `NSWindowBelow`) and is always full-bleed
 * — the controller's default {@link measureBounds} provider. While the player is
 * shown, {@link EmbeddedMpvImmersiveService} opens a transparent "tunnel"
 * through the shell so the video shows through and the inline
 * `app-player-controls` float over full-bleed video in the MAIN window. The
 * component owns only the native surface lifecycle and status/loader overlays.
 */
@Component({
    selector: 'app-embedded-mpv-player',
    templateUrl: './embedded-mpv-player.component.html',
    styleUrl: './embedded-mpv-player.component.scss',
    imports: [
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        PlayerControlsComponent,
    ],
    providers: [EmbeddedMpvSessionController, EmbeddedMpvControlsAdapter],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'embedded-mpv-player-host',
    },
})
export class EmbeddedMpvPlayerComponent implements OnDestroy {
    readonly playback = input.required<ResolvedPortalPlayback>();
    readonly showControls = input(true);
    readonly recordingFolder = input('');
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);

    @Output() timeUpdate = new EventEmitter<{
        currentTime: number;
        duration: number;
    }>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    private readonly controller = inject(EmbeddedMpvSessionController);
    private readonly immersive = inject(EmbeddedMpvImmersiveService);
    readonly adapter = inject(EmbeddedMpvControlsAdapter);

    readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
    readonly playerRoot = viewChild<ElementRef<HTMLDivElement>>('playerRootEl');
    readonly controls = viewChild(PlayerControlsComponent);

    readonly support = this.controller.support;
    readonly session = this.controller.session;
    readonly stalled = this.controller.stalled;

    readonly isFullscreen = signal(false);

    readonly isSupported = computed(() => this.support()?.supported ?? false);
    readonly isLoading = computed(() => this.adapter.state().status === 'loading');
    readonly isErrored = computed(() => this.adapter.state().status === 'error');
    readonly isPlaying = computed(() => this.adapter.state().status === 'playing');
    /**
     * True only when a video frame is actually on screen (playing or paused) —
     * NOT while loading/idle/ended/error. Gates the transparency tunnel so the
     * UI stays opaque until the video is showing.
     */
    readonly videoVisible = computed(() => {
        const status = this.adapter.state().status;
        return status === 'playing' || status === 'paused';
    });
    /** Single source of truth: the adapter derives the same status text. */
    readonly statusLabel = computed(() => this.adapter.state().statusMessage);

    private lastEndedSessionId: string | null = null;

    private readonly onFullscreenChange = () => {
        const playerRoot = this.playerRoot()?.nativeElement;
        const fullscreen = Boolean(
            playerRoot && document.fullscreenElement === playerRoot
        );
        this.isFullscreen.set(fullscreen);
        // Hide the surrounding chrome so the transparent fullscreen surface
        // reveals the native video (filling the screen), not the UI behind it.
        this.immersive.setFullscreen(fullscreen);
        // Re-sync the native surface to the new (fullscreen) viewport bounds.
        this.controller.triggerBoundsSync();
    };

    constructor() {
        if (typeof document !== 'undefined') {
            document.addEventListener(
                'fullscreenchange',
                this.onFullscreenChange
            );
        }

        // The native surface is always full-bleed (the controller's default
        // measureBounds provider); the inline controls float over it. No custom
        // bounds provider / docking is needed in the immersive overlay.

        // Open the transparent tunnel ONLY while a video frame is actually on
        // screen (playing/paused) — never during "Loading stream"/idle/error,
        // so the UI stays opaque until there is video to show. The effect
        // re-runs on status changes; closing on teardown is handled by cleanup.
        effect((onCleanup) => {
            if (!this.isSupported() || !this.videoVisible()) {
                return;
            }
            this.immersive.activate();
            onCleanup(() => this.immersive.deactivate());
        });

        // Feed the native video viewport rect to the immersive backdrop so its
        // hole stays congruent with the native surface. boundsTick bumps on
        // every native bounds sync (resize/scroll/fullscreen/RAF) — same source
        // the controller uses — so reading it keeps the hole in lockstep. Clear
        // the rect whenever there is no on-screen video; teardown clears too.
        effect((onCleanup) => {
            this.controller.boundsTick();
            const viewport = this.viewport()?.nativeElement;
            if (!this.isSupported() || !this.videoVisible() || !viewport) {
                this.immersive.setRect(null);
                return;
            }
            this.immersive.setRect(measureBounds(viewport));
            onCleanup(() => this.immersive.setRect(null));
        });

        // Push host context into the adapter.
        effect(() => {
            this.adapter.playback.set(this.playback());
            this.adapter.seriesNavigation.set(this.seriesNavigation());
            this.adapter.recordingFolder.set(this.recordingFolder());
        });

        // Native session lifecycle.
        effect((onCleanup) => {
            const viewport = this.viewport();
            const playback = this.playback();
            const supported = this.isSupported();
            this.controller.retryToken();

            if (
                !viewport ||
                !playback.streamUrl ||
                !supported ||
                !window.electron
            ) {
                return;
            }

            // volume is read untracked so adjusting it during playback does
            // not re-trigger this effect (which would tear down and recreate
            // the session, restarting the stream from the beginning).
            this.adapter.setRecordingMessage(null);
            const teardown = this.controller.startSession(
                viewport.nativeElement,
                playback,
                untracked(() => readStoredVolume())
            );
            onCleanup(teardown);
        });

        // Bridge session snapshots to timeUpdate without pulling transitive deps.
        effect(() => {
            const session = this.session();
            if (!session) {
                this.lastEndedSessionId = null;
                return;
            }
            untracked(() => {
                this.timeUpdate.emit({
                    currentTime: session.positionSeconds,
                    duration: session.durationSeconds ?? 0,
                });
            });
        });

        effect(() => {
            const session = this.session();
            if (!session || session.status !== 'ended') {
                return;
            }
            if (this.lastEndedSessionId === session.id) {
                return;
            }
            this.lastEndedSessionId = session.id;
            this.playbackEnded.emit();
        });
    }

    ngOnDestroy(): void {
        if (typeof document !== 'undefined') {
            document.removeEventListener(
                'fullscreenchange',
                this.onFullscreenChange
            );
        }
        this.immersive.setFullscreen(false);
        this.immersive.setRect(null);
    }

    retry(): void {
        this.controller.retry();
    }
}
