import {
    DestroyRef,
    Injectable,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import {
    EmbeddedMpvBounds,
    EmbeddedMpvSession,
    EmbeddedMpvSupport,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { measureBounds } from './embedded-mpv-compositor';
import { EmbeddedMpvCommandRunner } from './embedded-mpv-command-runner';
import {
    createAttachingSession,
    createErrorSession,
    createLoadingSession,
    waitForStartupPaint,
} from './embedded-mpv-session-factory';
import { EmbeddedMpvStalledTracker } from './embedded-mpv-stalled-tracker';

export type EmbeddedMpvBoundsProvider = (
    host: HTMLElement
) => EmbeddedMpvBounds;

type ElectronBridge = Window['electron'];

@Injectable()
export class EmbeddedMpvSessionController {
    readonly support = signal<EmbeddedMpvSupport | null>(null);
    readonly session = signal<EmbeddedMpvSession | null>(null);
    readonly sessionId = signal<string | null>(null);
    readonly retryToken = signal(0);
    /**
     * Bumped on every native bounds sync (resize/scroll/fullscreen/RAF). A host
     * overlay effect reads this to follow the viewport without coupling the
     * (pure) bounds provider to overlay side-effects.
     */
    readonly boundsTick = signal(0);

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

    /**
     * Attach to an existing MPV session owned by another window (the main
     * renderer). Unlike {@link startSession}, this does NOT create or load a
     * session — it only sets `sessionId` so the `onEmbeddedMpvSessionUpdate`
     * subscription populates `session` from broadcasts. Used by the overlay.
     */
    attach(sessionId: string): void {
        this.sessionId.set(sessionId);
        if (!this.session()) {
            // Placeholder until the first broadcast snapshot arrives so the
            // controls render a loading state instead of an empty surface.
            this.session.set(createAttachingSession(sessionId));
        }
        if (typeof window.electron?.getEmbeddedMpvSupport === 'function') {
            void this.loadSupport();
        }
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

        const syncBounds = () => {
            if (!activeSessionId) {
                return;
            }
            void window.electron
                ?.setEmbeddedMpvBounds(
                    activeSessionId,
                    this.boundsProvider(host)
                )
                .catch(() => undefined);
        };

        const scheduleBoundsSync = () => {
            if (this.boundsAnimationFrame !== null) {
                cancelAnimationFrame(this.boundsAnimationFrame);
            }
            this.boundsAnimationFrame = requestAnimationFrame(() => {
                this.boundsAnimationFrame = null;
                syncBounds();
                // Notify host overlay reconciliation that the viewport moved.
                this.boundsTick.update((value) => value + 1);
            });
        };

        this.activeBoundsSync = scheduleBoundsSync;

        const resizeObserver = new ResizeObserver(() => scheduleBoundsSync());
        resizeObserver.observe(host);
        window.addEventListener('resize', scheduleBoundsSync);
        window.addEventListener('scroll', scheduleBoundsSync, true);

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
            if (prepared?.supported) {
                this.support.set(prepared);
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
            if (untracked(() => this.isFrameCopyEngine())) {
                // Frame-copy engine: start the preload frame pump that
                // paints helper frames onto the component's canvas. A failed
                // attach (no canvas, no WebGL2, reader missing) must surface
                // as a session error — otherwise the helper keeps playing
                // audio behind a black canvas with no recovery UI.
                const attached = await electron
                    .attachEmbeddedMpvFrameView?.(created.id)
                    .catch(() => false);
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
    readonly setSpeed = (speed: number): Promise<void> =>
        this.commands.setSpeed(speed);
    readonly setAspect = (aspect: string): Promise<void> =>
        this.commands.setAspect(aspect);
    readonly startRecording = (
        directory: string | undefined,
        title: string
    ): Promise<EmbeddedMpvSession['recording'] | null> =>
        this.commands.startRecording(directory, title);
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
