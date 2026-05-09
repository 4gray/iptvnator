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
} from 'shared-interfaces';
import { measureBounds } from './embedded-mpv-format.utils';

export type EmbeddedMpvBoundsProvider = (
    host: HTMLElement
) => EmbeddedMpvBounds;

const STALLED_TIMEOUT_MS = 30_000;

@Injectable()
export class EmbeddedMpvSessionController {
    readonly support = signal<EmbeddedMpvSupport | null>(null);
    readonly session = signal<EmbeddedMpvSession | null>(null);
    readonly sessionId = signal<string | null>(null);
    readonly stalled = signal(false);
    readonly retryToken = signal(0);

    private readonly sessionStatus = computed(
        () => this.session()?.status ?? null
    );

    private readonly destroyRef = inject(DestroyRef);
    private readonly unsubscribeSessionUpdate?: () => void;

    private boundsProvider: EmbeddedMpvBoundsProvider = (host) =>
        measureBounds(host);
    private activeBoundsSync: (() => void) | null = null;
    private boundsAnimationFrame: number | null = null;
    private stalledTimer: number | null = null;

    constructor() {
        this.unsubscribeSessionUpdate =
            window.electron?.onEmbeddedMpvSessionUpdate?.((session) => {
                if (session.id !== this.sessionId()) {
                    return;
                }
                this.session.set(session);
            });

        if (window.electron?.getEmbeddedMpvSupport) {
            void this.loadSupport();
        } else {
            this.support.set({
                supported: false,
                platform: typeof window === 'undefined' ? 'web' : 'unknown',
                reason: 'Embedded MPV requires the Electron desktop build.',
            });
        }

        // Track the narrowest possible signal — status only — so this effect
        // does not re-run on every position-poll snapshot (~2 Hz during play)
        // even though handleStalledTracking would be a no-op for those.
        effect(() => {
            const status = this.sessionStatus();
            untracked(() => this.handleStalledTracking(status));
        });

        this.destroyRef.onDestroy(() => {
            this.unsubscribeSessionUpdate?.();
            this.cancelStalledTimer();
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
        this.stalled.set(false);
        this.session.set(null);
        this.sessionId.set(null);
        this.retryToken.update((value) => value + 1);
    }

    /**
     * Spin up an embedded MPV session bound to `host`. Returns a teardown
     * function the caller must invoke when the host or playback changes (or
     * the component tears down). All bounds and lifecycle bookkeeping lives
     * here so the component can stay view-focused.
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
            const bounds = this.boundsProvider(host);
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

        const create = async () => {
            this.session.set(
                this.createLoadingSession(playback, initialVolume)
            );
            await this.waitForStartupPaint();
            if (disposed) {
                return;
            }

            const prepared = await window.electron!.prepareEmbeddedMpv?.();
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

            const created = await window.electron!.createEmbeddedMpvSession(
                measureBounds(host),
                playback.title,
                initialVolume
            );

            if (disposed) {
                await window.electron!.disposeEmbeddedMpvSession(created.id);
                return;
            }

            activeSessionId = created.id;
            this.sessionId.set(created.id);
            this.session.set(created);
            await window.electron!.loadEmbeddedMpvPlayback(
                created.id,
                playback
            );
            scheduleBoundsSync();
        };

        void create().catch((error) =>
            this.session.set(
                this.createErrorSession(playback, initialVolume, error)
            )
        );

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
                void window.electron?.disposeEmbeddedMpvSession(id);
            }
        };
    }

    async togglePaused(): Promise<void> {
        const id = this.sessionId();
        const session = this.session();
        if (!id || !session || !window.electron?.setEmbeddedMpvPaused) {
            return;
        }
        const updated = await this.guardIpc(() =>
            window.electron!.setEmbeddedMpvPaused(
                id,
                session.status !== 'paused'
            )
        );
        if (updated) {
            this.session.set(updated);
        }
    }

    async seekBy(deltaSeconds: number): Promise<boolean> {
        const id = this.sessionId();
        const session = this.session();
        if (!id || !session || !window.electron?.seekEmbeddedMpv) {
            return false;
        }
        const next = Math.max(0, session.positionSeconds + deltaSeconds);
        const updated = await this.guardIpc(() =>
            window.electron!.seekEmbeddedMpv(id, next)
        );
        if (updated) {
            this.session.set(updated);
        }
        return true;
    }

    async seekTo(seconds: number): Promise<void> {
        const id = this.sessionId();
        if (!id || !window.electron?.seekEmbeddedMpv) {
            return;
        }
        const updated = await this.guardIpc(() =>
            window.electron!.seekEmbeddedMpv(id, seconds)
        );
        if (updated) {
            this.session.set(updated);
        }
    }

    async applyVolume(value: number): Promise<void> {
        const id = this.sessionId();
        if (!id || !window.electron?.setEmbeddedMpvVolume) {
            return;
        }
        const updated = await this.guardIpc(() =>
            window.electron!.setEmbeddedMpvVolume(id, value)
        );
        if (updated) {
            this.session.set(updated);
        }
    }

    async setAudioTrack(trackId: number): Promise<void> {
        const id = this.sessionId();
        if (!id || !window.electron?.setEmbeddedMpvAudioTrack) {
            return;
        }
        const updated = await this.guardIpc(() =>
            window.electron!.setEmbeddedMpvAudioTrack(id, trackId)
        );
        if (updated) {
            this.session.set(updated);
        }
    }

    async setSubtitleTrack(trackId: number): Promise<void> {
        const id = this.sessionId();
        if (!id || !window.electron?.setEmbeddedMpvSubtitleTrack) {
            return;
        }
        const updated = await this.guardIpc(() =>
            window.electron!.setEmbeddedMpvSubtitleTrack!(id, trackId)
        );
        if (updated) {
            this.session.set(updated);
        }
    }

    async setSpeed(speed: number): Promise<void> {
        const id = this.sessionId();
        if (!id || !window.electron?.setEmbeddedMpvSpeed) {
            return;
        }
        const updated = await this.guardIpc(() =>
            window.electron!.setEmbeddedMpvSpeed!(id, speed)
        );
        if (updated) {
            this.session.set(updated);
        }
    }

    async setAspect(aspect: string): Promise<void> {
        const id = this.sessionId();
        if (!id || !window.electron?.setEmbeddedMpvAspect) {
            return;
        }
        const updated = await this.guardIpc(() =>
            window.electron!.setEmbeddedMpvAspect!(id, aspect)
        );
        if (updated) {
            this.session.set(updated);
        }
    }

    async startRecording(
        directory: string | undefined,
        title: string
    ): Promise<EmbeddedMpvSession['recording'] | null> {
        const id = this.sessionId();
        if (!id || !window.electron?.startEmbeddedMpvRecording) {
            return null;
        }

        const resolvedDirectory =
            directory?.trim() ||
            (await window.electron.getEmbeddedMpvDefaultRecordingFolder?.());
        const updated = await this.guardIpc(() =>
            window.electron!.startEmbeddedMpvRecording!(id, {
                directory: resolvedDirectory,
                title,
            })
        );
        if (updated) {
            this.session.set(updated);
            return updated.recording ?? null;
        }
        return null;
    }

    async stopRecording(): Promise<EmbeddedMpvSession['recording'] | null> {
        const id = this.sessionId();
        if (!id || !window.electron?.stopEmbeddedMpvRecording) {
            return null;
        }
        const updated = await this.guardIpc(() =>
            window.electron!.stopEmbeddedMpvRecording!(id)
        );
        if (updated) {
            this.session.set(updated);
            return updated.recording ?? null;
        }
        return null;
    }

    private async guardIpc<T>(call: () => Promise<T>): Promise<T | null> {
        try {
            return await call();
        } catch {
            // The session may have been torn down or an addon-side throw
            // raced the IPC. Swallow — the next snapshot will resync state.
            return null;
        }
    }

    private async loadSupport(): Promise<void> {
        try {
            this.support.set(await window.electron!.getEmbeddedMpvSupport());
        } catch (error) {
            this.support.set({
                supported: false,
                platform: window.electron?.platform ?? 'unknown',
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private handleStalledTracking(
        status: EmbeddedMpvSession['status'] | null
    ): void {
        if (status === 'loading') {
            if (this.stalledTimer === null) {
                this.stalledTimer = window.setTimeout(() => {
                    this.stalled.set(true);
                    this.stalledTimer = null;
                }, STALLED_TIMEOUT_MS);
            }
            return;
        }

        this.cancelStalledTimer();
        if (this.stalled()) {
            this.stalled.set(false);
        }
    }

    private cancelStalledTimer(): void {
        if (this.stalledTimer !== null) {
            clearTimeout(this.stalledTimer);
            this.stalledTimer = null;
        }
    }

    private createLoadingSession(
        playback: ResolvedPortalPlayback,
        volume: number
    ): EmbeddedMpvSession {
        const now = new Date().toISOString();
        return {
            id: 'embedded-mpv-starting',
            title: playback.title,
            streamUrl: playback.streamUrl,
            status: 'loading',
            positionSeconds: 0,
            durationSeconds: null,
            volume,
            audioTracks: [],
            selectedAudioTrackId: null,
            subtitleTracks: [],
            selectedSubtitleTrackId: null,
            playbackSpeed: 1,
            aspectOverride: 'no',
            recording: { active: false },
            startedAt: now,
            updatedAt: now,
        };
    }

    private createErrorSession(
        playback: ResolvedPortalPlayback,
        volume: number,
        error: unknown
    ): EmbeddedMpvSession {
        const now = new Date().toISOString();
        this.sessionId.set(null);
        return {
            id: 'embedded-mpv-error',
            title: playback.title,
            streamUrl: playback.streamUrl,
            status: 'error',
            positionSeconds: 0,
            durationSeconds: null,
            volume,
            audioTracks: [],
            selectedAudioTrackId: null,
            subtitleTracks: [],
            selectedSubtitleTrackId: null,
            playbackSpeed: 1,
            aspectOverride: 'no',
            recording: { active: false },
            startedAt: now,
            updatedAt: now,
            error: error instanceof Error ? error.message : String(error),
        };
    }

    private waitForStartupPaint(): Promise<void> {
        if (typeof requestAnimationFrame !== 'function') {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => resolve());
            });
        });
    }
}
