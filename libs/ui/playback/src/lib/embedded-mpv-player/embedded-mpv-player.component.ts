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
import type { PlayerFullscreenController } from '../player-controls';
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

    readonly fullscreenController: PlayerFullscreenController = {
        isFullscreen: this.isFullscreen.asReadonly(),
        // Requires BOTH native bridges: `setMainWindowFullScreen` drives the OS
        // window and `setEmbeddedMpvFill` snaps the native surface to fill it.
        // Without the fill bridge (older addon/bridge) native fullscreen would
        // strand the video at inline bounds, so hide the toggle and let the
        // shared controls fall back to the built-in DOM path.
        canToggle: () =>
            typeof window.electron?.setMainWindowFullScreen === 'function' &&
            typeof window.electron?.setEmbeddedMpvFill === 'function',
        toggle: () =>
            this.isFullscreen()
                ? this.exitFullscreen()
                : this.enterFullscreen(),
    };

    /** Unsubscribe for the window-state reconciliation (OS-initiated exits). */
    private windowStateUnsubscribe?: () => void;

    /**
     * Bumped on every fullscreen enter/exit so a deferred enter callback that is
     * still queued becomes a no-op once the intent has changed (exited or
     * re-toggled). Also see {@link destroyed}.
     */
    private fullscreenGeneration = 0;
    /** Pending requestAnimationFrame id for the deferred window fullscreen. */
    private pendingFullscreenRaf: number | null = null;
    /** Set in {@link ngOnDestroy}; guards deferred callbacks after teardown. */
    private destroyed = false;

    /** Max time to wait for the fill snap before requesting window fullscreen. */
    private static readonly FILL_TIMEOUT_MS = 150;

    /**
     * Enter real macOS native fullscreen. macOS animates a SNAPSHOT of the
     * window taken at the `setMainWindowFullScreen` call, so the window must
     * already show clean full-bleed video at that instant or the snapshot
     * catches a mid-resize state (small corner image / flicker):
     *  1. `embedded-mpv-player--cover` makes the player root `fixed inset:0`.
     *  2. `setFullscreen` hides the surrounding chrome via a body class.
     *  3. `setFill(true)` snaps the native view to fill the window (autoresizing)
     *     and freezes its render so the last frame scales cleanly.
     *  4. `setMainWindowFullScreen(true)` is deferred a couple of frames so
     *     steps 1–3 have applied before macOS snapshots the window.
     */
    private enterFullscreen(): void {
        this.isFullscreen.set(true);
        this.immersive.setFullscreen(true);
        const generation = ++this.fullscreenGeneration;
        void this.driveNativeFullscreen(generation);
    }

    /**
     * Awaits the fill snap (raced with a short timeout so a hung IPC can't block
     * fullscreen forever), then defers the window fullscreen request a couple of
     * frames so the fill/chrome changes have painted before macOS snapshots the
     * window. Every await point re-checks the generation/teardown so a queued
     * request becomes a no-op once fullscreen is exited/re-toggled or the
     * component is destroyed.
     */
    private async driveNativeFullscreen(generation: number): Promise<void> {
        await this.raceFill(true);
        if (this.isFullscreenRequestStale(generation)) {
            return;
        }
        await this.twoFrames();
        if (this.isFullscreenRequestStale(generation)) {
            return;
        }
        void window.electron?.setMainWindowFullScreen?.(true);
    }

    /** True once a queued enter-fullscreen request no longer reflects intent. */
    private isFullscreenRequestStale(generation: number): boolean {
        return this.destroyed || generation !== this.fullscreenGeneration;
    }

    /** Resolves when the fill snap acknowledges or the safety timeout elapses. */
    private raceFill(fill: boolean): Promise<void> {
        return Promise.race([
            this.controller.setFill(fill),
            new Promise<void>((resolve) =>
                setTimeout(
                    resolve,
                    EmbeddedMpvPlayerComponent.FILL_TIMEOUT_MS
                )
            ),
        ]);
    }

    /** Resolves after two animation frames; the rAF id is cancellable. */
    private twoFrames(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.pendingFullscreenRaf = requestAnimationFrame(() => {
                this.pendingFullscreenRaf = requestAnimationFrame(() => {
                    this.pendingFullscreenRaf = null;
                    resolve();
                });
            });
        });
    }

    /**
     * Tear down the fullscreen presentation and (by default) drive the OS window
     * out of fullscreen. Pass `syncWindow = false` when reconciling an exit the
     * user already triggered through the OS (green button / Ctrl+Cmd+F / ESC),
     * where the window has already left fullscreen.
     */
    private exitFullscreen(syncWindow = true): void {
        if (!this.isFullscreen()) {
            return;
        }
        this.isFullscreen.set(false);
        // Invalidate any still-queued enter-fullscreen request.
        this.fullscreenGeneration++;
        this.cancelPendingFullscreenRaf();
        this.immersive.setFullscreen(false);
        void this.controller.setFill(false);
        if (syncWindow) {
            void window.electron?.setMainWindowFullScreen?.(false);
        }
        // Re-dock the native surface to the inline viewport.
        this.controller.triggerBoundsSync();
    }

    constructor() {
        // Reconcile with OS-initiated fullscreen exits (green button /
        // Ctrl+Cmd+F / ESC) that bypass the in-app button: the main process
        // broadcasts window state, so tear down the presentation when the window
        // has left fullscreen but our state still thinks it is fullscreen.
        this.windowStateUnsubscribe = window.electron?.onWindowStateChange?.(
            (state) => {
                if (!state.isFullScreen && this.isFullscreen()) {
                    this.exitFullscreen(false);
                }
            }
        );

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
        this.destroyed = true;
        this.cancelPendingFullscreenRaf();
        this.windowStateUnsubscribe?.();
        // Don't strand the OS window in the macOS fullscreen Space if the player
        // is torn down (e.g. navigating away) while fullscreen.
        if (this.isFullscreen()) {
            void window.electron?.setMainWindowFullScreen?.(false);
        }
        this.immersive.setFullscreen(false);
        this.immersive.setRect(null);
    }

    private cancelPendingFullscreenRaf(): void {
        if (this.pendingFullscreenRaf !== null) {
            cancelAnimationFrame(this.pendingFullscreenRaf);
            this.pendingFullscreenRaf = null;
        }
    }

    retry(): void {
        this.controller.retry();
    }
}
