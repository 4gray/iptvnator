import {
    DestroyRef,
    Injectable,
    computed,
    inject,
    signal,
} from '@angular/core';
import {
    LocalTimeshiftSession,
    LocalTimeshiftSettings,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';

export type LocalTimeshiftCoordinatorStatus =
    | 'idle'
    | 'starting'
    | 'ready'
    | 'unavailable'
    | 'error';

@Injectable()
export class LocalTimeshiftCoordinator {
    private readonly destroyRef = inject(DestroyRef);
    private readonly sourcePlayback = signal<ResolvedPortalPlayback | null>(
        null
    );
    private readonly activeSession = signal<LocalTimeshiftSession | null>(null);
    private generation = 0;
    private configurationKey = '';
    private supportPromise: ReturnType<
        NonNullable<typeof window.electron>['getLocalTimeshiftSupport']
    > | null = null;

    readonly status = signal<LocalTimeshiftCoordinatorStatus>('idle');
    readonly error = signal<string | null>(null);
    readonly playback = signal<ResolvedPortalPlayback | null>(null);
    readonly isStarting = computed(() => this.status() === 'starting');
    readonly isActive = computed(
        () => this.status() === 'ready' && this.activeSession() !== null
    );

    constructor() {
        const unsubscribe = window.electron?.onLocalTimeshiftSessionUpdate?.(
            (session) => {
                if (session.id !== this.activeSession()?.id) {
                    return;
                }
                this.activeSession.set(session);
                if (session.status === 'error') {
                    this.status.set('error');
                    this.error.set(session.error ?? 'Local Timeshift failed');
                    this.playback.set(this.sourcePlayback());
                }
            }
        );

        this.destroyRef.onDestroy(() => {
            this.generation += 1;
            unsubscribe?.();
            void this.stopActiveSession();
        });
    }

    configure(
        playback: ResolvedPortalPlayback,
        settings: LocalTimeshiftSettings,
        eligible: boolean
    ): void {
        const key = JSON.stringify([
            playback.streamUrl,
            playback.headers,
            playback.userAgent,
            playback.referer,
            playback.origin,
            playback.isLive,
            settings.enabled,
            settings.maxDurationMinutes,
            settings.bufferDirectory,
            eligible,
        ]);
        if (key === this.configurationKey) {
            return;
        }

        this.configurationKey = key;
        this.sourcePlayback.set(playback);
        const generation = ++this.generation;
        const shouldStart =
            eligible && settings.enabled && playback.isLive === true;

        if (!shouldStart || !this.hasCompleteBridge()) {
            void this.stopActiveSession();
            this.status.set(
                settings.enabled && playback.isLive === true
                    ? 'unavailable'
                    : 'idle'
            );
            this.error.set(null);
            this.playback.set(playback);
            return;
        }

        this.status.set('starting');
        this.error.set(null);
        this.playback.set(null);
        void this.start(playback, settings, generation);
    }

    private async start(
        playback: ResolvedPortalPlayback,
        settings: LocalTimeshiftSettings,
        generation: number
    ): Promise<void> {
        try {
            const bridge = window.electron;
            if (!bridge) {
                throw new Error('Electron bridge is unavailable');
            }
            if (!this.supportPromise) {
                const probe = bridge.getLocalTimeshiftSupport();
                this.supportPromise = probe;
                // Do not cache transient probe failures forever; the next
                // start attempt should probe again.
                probe.catch(() => {
                    if (this.supportPromise === probe) {
                        this.supportPromise = null;
                    }
                });
            }
            // Run the support probe concurrently with stopping the previous
            // session; both must finish before a new start is sent.
            const supportPromise = this.supportPromise;
            await this.stopActiveSession();
            const support = await supportPromise;
            if (!support.supported) {
                if (generation === this.generation) {
                    this.status.set('unavailable');
                    this.error.set(support.reason ?? null);
                    this.playback.set(playback);
                }
                return;
            }

            // A newer configure() may have superseded this start while the
            // previous stop or the support probe was awaited. Sending a stale
            // start would register this renderer as the session owner on the
            // main process and make the newer start fail with an
            // "already active for this owner" error.
            if (generation !== this.generation) {
                return;
            }

            const session = await bridge.startLocalTimeshift({
                playback,
                maxDurationMinutes: settings.maxDurationMinutes,
                bufferDirectory: settings.bufferDirectory || undefined,
            });
            if (generation !== this.generation) {
                await bridge.stopLocalTimeshift(session.id).catch(() => null);
                return;
            }

            this.activeSession.set(session);
            this.status.set('ready');
            this.playback.set({
                ...playback,
                streamUrl: session.playbackUrl,
                headers: undefined,
                userAgent: undefined,
                referer: undefined,
                origin: undefined,
            });
        } catch (error) {
            if (generation !== this.generation) {
                return;
            }
            this.status.set('error');
            this.error.set(
                error instanceof Error ? error.message : String(error)
            );
            this.playback.set(playback);
        }
    }

    private async stopActiveSession(): Promise<void> {
        const session = this.activeSession();
        this.activeSession.set(null);
        if (!window.electron?.stopLocalTimeshift) {
            return;
        }
        // Calling stop without an id also aborts a renderer-owned session that
        // is still waiting for FFmpeg to produce its first playlist. This
        // keeps rapid channel changes from racing two starts for one owner.
        await window.electron.stopLocalTimeshift(session?.id).catch(() => null);
    }

    private hasCompleteBridge(): boolean {
        return Boolean(window.electron);
    }
}
