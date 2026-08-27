import {
    DestroyRef,
    Injectable,
    NgZone,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import {
    EmbeddedMpvBounds,
    EmbeddedMpvSession,
    EmbeddedMpvSubtitleStyle,
    EmbeddedMpvSupport,
    RecordingStartMetadata,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { EmbeddedMpvCommandRunner } from './embedded-mpv-command-runner';
import { measureBounds } from './embedded-mpv-format.utils';
import {
    createErrorSession,
    createLoadingSession,
    waitForStartupPaint,
} from './embedded-mpv-session-factory';
import { EmbeddedMpvStalledTracker } from './embedded-mpv-stalled-tracker';

export type EmbeddedMpvBoundsProvider = (
    host: HTMLElement
) => EmbeddedMpvBounds;

type ElectronBridge = Window['electron'];

/**
 * Cadence of the host-position drift poll. 500 ms keeps a stuck native
 * window user-invisible (it snaps back within half a second) while costing
 * one getBoundingClientRect per tick and zero IPC while nothing moves.
 */
const POSITION_POLL_INTERVAL_MS = 500;

/**
 * Sub-pixel measurement noise must not re-send bounds every tick: after a
 * sync the next poll re-measures the same layout, so anything below half a
 * CSS pixel is the same position. Real layout shifts move by whole pixels.
 */
const POSITION_POLL_EPSILON_PX = 0.5;

function boundsDiffer(a: EmbeddedMpvBounds, b: EmbeddedMpvBounds): boolean {
    return (
        Math.abs(a.x - b.x) > POSITION_POLL_EPSILON_PX ||
        Math.abs(a.y - b.y) > POSITION_POLL_EPSILON_PX ||
        Math.abs(a.width - b.width) > POSITION_POLL_EPSILON_PX ||
        Math.abs(a.height - b.height) > POSITION_POLL_EPSILON_PX
    );
}

@Injectable()
export class EmbeddedMpvSessionController {
    readonly support = signal<EmbeddedMpvSupport | null>(null);
    readonly session = signal<EmbeddedMpvSession | null>(null);
    readonly sessionId = signal<string | null>(null);
    readonly retryToken = signal(0);

    private readonly stalledTracker = new EmbeddedMpvStalledTracker();
    readonly stalled = this.stalledTracker.stalled;

    private readonly commands = new EmbeddedMpvCommandRunner({
        sessionId: this.sessionId,
        session: this.session,
    });

    readonly isFrameCopyEngine = computed(
        () => this.support()?.engine === 'frame-copy'
    );

    private readonly sessionStatus = computed(
        () => this.session()?.status ?? null
    );

    private readonly destroyRef = inject(DestroyRef);
    private readonly zone = inject(NgZone);
    private readonly unsubscribeSessionUpdate?: () => void;

    private boundsProvider: EmbeddedMpvBoundsProvider = (host) =>
        measureBounds(host);
    private activeBoundsSync: (() => void) | null = null;
    private boundsAnimationFrame: number | null = null;

    constructor() {
        this.unsubscribeSessionUpdate =
            window.electron?.onEmbeddedMpvSessionUpdate?.((session) => {
                if (session.id !== this.sessionId()) {
                    return;
                }
                this.session.set(session);
            });

        if (typeof window.electron?.getEmbeddedMpvSupport === 'function') {
            void this.loadSupport();
        } else {
            this.support.set({
                supported: false,
                platform: typeof window === 'undefined' ? 'web' : 'unknown',
                reason: 'Embedded MPV requires the Electron desktop build.',
            });
        }

        // Track status only so this effect does not re-run on every
        // position-poll snapshot (~2 Hz) where stalled tracking is a no-op.
        effect(() => {
            const status = this.sessionStatus();
            untracked(() => this.stalledTracker.track(status));
        });

        this.destroyRef.onDestroy(() => {
            this.unsubscribeSessionUpdate?.();
            this.stalledTracker.cancel();
            if (this.boundsAnimationFrame !== null) {
                cancelAnimationFrame(this.boundsAnimationFrame);
                this.boundsAnimationFrame = null;
            }
        });
    }

    setBoundsProvider(provider: EmbeddedMpvBoundsProvider): void {
        this.boundsProvider = provider;
    }

    triggerBoundsSync(): void {
        this.activeBoundsSync?.();
    }

    retry(): void {
        this.stalledTracker.reset();
        this.session.set(null);
        this.sessionId.set(null);
        this.retryToken.update((value) => value + 1);
    }

    /**
     * Spin up an embedded MPV session bound to `host`. Returns a teardown the
     * caller invokes when host/playback changes or the component tears down.
     */
    startSession(
        host: HTMLElement,
        playback: ResolvedPortalPlayback,
        initialVolume: number
    ): () => void {
        let disposed = false;
        let activeSessionId: string | null = null;
        let lastSyncedBounds: EmbeddedMpvBounds | null = null;

        const syncBounds = () => {
            if (!activeSessionId) {
                return;
            }
            const bounds = this.boundsProvider(host);
            lastSyncedBounds = bounds;
            void window.electron
                ?.setEmbeddedMpvBounds(activeSessionId, bounds)
                .catch(() => undefined);
        };

        const scheduleBoundsSync = () => {
            if (this.boundsAnimationFrame !== null) {
                cancelAnimationFrame(this.boundsAnimationFrame);
            }
            this.boundsAnimationFrame = requestAnimationFrame(() => {
                this.boundsAnimationFrame = null;
                syncBounds();
            });
        };

        this.activeBoundsSync = scheduleBoundsSync;

        const resizeObserver = new ResizeObserver(() => scheduleBoundsSync());
        resizeObserver.observe(host);
        window.addEventListener('resize', scheduleBoundsSync);
        window.addEventListener('scroll', scheduleBoundsSync, true);

        // ResizeObserver reports size changes only: an ancestor re-layout
        // that translates the host without resizing it (sidebar content
        // settling, panels loading below the player) moves the DOM while the
        // native child window keeps its old coordinates, and no DOM event
        // observes "position changed" (#1428). A low-frequency poll compares
        // the measured bounds against the last synced ones and re-syncs only
        // on drift, so the idle cost is one getBoundingClientRect per tick
        // with no IPC.
        //
        // The interval runs outside Angular's zone: with zone change
        // detection a zone-registered timer would run app-wide change
        // detection every tick for the whole stream. It never re-enters the
        // zone — the drift path is rAF → setEmbeddedMpvBounds IPC and
        // touches no Angular state. Frame-copy paints into a DOM canvas
        // that moves with the layout, so only native-view can go stale on a
        // position-only shift; the poll skips the measurement there.
        const positionPoll = this.zone.runOutsideAngular(() =>
            window.setInterval(() => {
                if (!activeSessionId || !lastSyncedBounds) {
                    return;
                }
                if (untracked(() => this.isFrameCopyEngine())) {
                    return;
                }
                if (
                    boundsDiffer(this.boundsProvider(host), lastSyncedBounds)
                ) {
                    scheduleBoundsSync();
                }
            }, POSITION_POLL_INTERVAL_MS)
        );

        // Page zoom and monitor DPI rescale the CSS→native-pixel mapping the
        // backend applies to these bounds. Moving the window to a display
        // with a different scale can keep the CSS layout identical (no
        // resize, no ResizeObserver), so watch devicePixelRatio through a
        // re-armed matchMedia query and re-sync when it changes.
        let detachDprWatch: (() => void) | null = null;
        const watchDevicePixelRatio = () => {
            detachDprWatch?.();
            detachDprWatch = null;
            const query = window.matchMedia?.(
                `(resolution: ${window.devicePixelRatio}dppx)`
            );
            if (!query) {
                return;
            }
            const onChange = () => {
                watchDevicePixelRatio();
                scheduleBoundsSync();
            };
            query.addEventListener('change', onChange);
            detachDprWatch = () =>
                query.removeEventListener('change', onChange);
        };
        watchDevicePixelRatio();

        const create = async () => {
            this.session.set(createLoadingSession(playback, initialVolume));
            await waitForStartupPaint();
            if (disposed) {
                return;
            }

            const electron = this.getElectronBridge();
            if (!electron) {
                throw new Error(
                    'Embedded MPV requires the Electron desktop build.'
                );
            }

            const prepared = await electron.prepareEmbeddedMpv?.();
            if (disposed) {
                return;
            }
            if (prepared && !prepared.supported) {
                throw new Error(
                    prepared.reason ??
                        'Embedded MPV is not available in this environment.'
                );
            }

            const created = await electron.createEmbeddedMpvSession(
                measureBounds(host),
                playback.title,
                initialVolume
            );

            if (disposed) {
                await electron.disposeEmbeddedMpvSession(created.id);
                return;
            }

            activeSessionId = created.id;
            this.sessionId.set(created.id);
            this.session.set(created);
            await electron.loadEmbeddedMpvPlayback(created.id, playback);
            if (disposed) {
                return;
            }
            if (untracked(() => this.isFrameCopyEngine())) {
                // Frame-copy engine: start the preload frame pump that
                // paints helper frames onto the component's canvas. A failed
                // attach (no canvas, no WebGL2, reader missing) must surface
                // as a session error — otherwise the helper keeps playing
                // audio behind a black canvas with no recovery UI.
                const attached = await electron
                    .attachEmbeddedMpvFrameView?.(created.id)
                    .catch(() => false);
                if (disposed) {
                    return;
                }
                if (attached === false && !disposed) {
                    await electron
                        .disposeEmbeddedMpvSession(created.id)
                        .catch(() => undefined);
                    throw new Error(
                        'The embedded MPV frame view failed to initialize.'
                    );
                }
            }
            scheduleBoundsSync();
        };

        void create().catch((error) => {
            // A rejection can land after teardown (fast channel zapping):
            // writing the error session then would clobber the state of the
            // session that replaced this one and null its sessionId.
            if (disposed) {
                return;
            }
            // Factory is pure; clear sessionId here (controller owns mutation).
            this.sessionId.set(null);
            this.session.set(
                createErrorSession(playback, initialVolume, error)
            );
        });

        return () => {
            disposed = true;
            resizeObserver.disconnect();
            window.removeEventListener('resize', scheduleBoundsSync);
            window.removeEventListener('scroll', scheduleBoundsSync, true);
            window.clearInterval(positionPoll);
            detachDprWatch?.();
            detachDprWatch = null;

            if (this.activeBoundsSync === scheduleBoundsSync) {
                this.activeBoundsSync = null;
            }
            if (this.boundsAnimationFrame !== null) {
                cancelAnimationFrame(this.boundsAnimationFrame);
                this.boundsAnimationFrame = null;
            }

            const id = activeSessionId;
            activeSessionId = null;
            this.sessionId.set(null);
            this.session.set(null);

            if (id) {
                if (untracked(() => this.isFrameCopyEngine())) {
                    window.electron?.detachEmbeddedMpvFrameView?.();
                }
                void window.electron?.disposeEmbeddedMpvSession(id);
            }
        };
    }

    // Transport/track/recording commands delegate to the command runner (owns
    // IPC + snapshot reconciliation). Bound fields keep the public API stable.
    readonly togglePaused = (): Promise<void> => this.commands.togglePaused();
    readonly seekBy = (deltaSeconds: number): Promise<boolean> =>
        this.commands.seekBy(deltaSeconds);
    readonly seekTo = (seconds: number): Promise<void> =>
        this.commands.seekTo(seconds);
    readonly applyVolume = (value: number): Promise<void> =>
        this.commands.applyVolume(value);
    readonly setAudioTrack = (trackId: number): Promise<void> =>
        this.commands.setAudioTrack(trackId);
    readonly setSubtitleTrack = (trackId: number): Promise<void> =>
        this.commands.setSubtitleTrack(trackId);
    readonly addExternalSubtitle = (): Promise<boolean> =>
        this.commands.addExternalSubtitle();
    readonly setSubtitleDelay = (seconds: number): Promise<void> =>
        this.commands.setSubtitleDelay(seconds);
    readonly setSubtitleStyle = (
        style: EmbeddedMpvSubtitleStyle
    ): Promise<void> => this.commands.setSubtitleStyle(style);
    readonly setSpeed = (speed: number): Promise<void> =>
        this.commands.setSpeed(speed);
    readonly setAspect = (aspect: string): Promise<void> =>
        this.commands.setAspect(aspect);
    readonly startRecording = (
        directory: string | undefined,
        title: string,
        metadata?: RecordingStartMetadata
    ): Promise<EmbeddedMpvSession['recording'] | null> =>
        this.commands.startRecording(directory, title, metadata);
    readonly stopRecording = (): Promise<
        EmbeddedMpvSession['recording'] | null
    > => this.commands.stopRecording();

    private async loadSupport(): Promise<void> {
        try {
            const electron = this.getElectronBridge();
            if (!electron?.getEmbeddedMpvSupport) {
                throw new Error(
                    'Embedded MPV requires the Electron desktop build.'
                );
            }
            this.support.set(await electron.getEmbeddedMpvSupport());
        } catch (error) {
            this.support.set({
                supported: false,
                platform: window.electron?.platform ?? 'unknown',
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private getElectronBridge(): ElectronBridge | undefined {
        return window.electron;
    }
}
