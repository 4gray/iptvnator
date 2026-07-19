import { Signal, WritableSignal } from '@angular/core';
import { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';

type ElectronBridge = Window['electron'];

/**
 * Context the {@link EmbeddedMpvCommandRunner} reads/writes. The controller owns
 * the signals; the runner only delegates IPC and reconciles the returned
 * snapshot back into `session`.
 */
export interface EmbeddedMpvCommandContext {
    readonly sessionId: Signal<string | null>;
    readonly session: WritableSignal<EmbeddedMpvSession | null>;
}

/**
 * Thin IPC delegators for embedded-MPV transport/track/recording commands.
 * Split out of the controller so each stays a one-liner around `guardIpc`,
 * which swallows races where the session was torn down mid-call (the next
 * broadcast snapshot resyncs state).
 */
export class EmbeddedMpvCommandRunner {
    constructor(private readonly ctx: EmbeddedMpvCommandContext) {}

    async togglePaused(): Promise<void> {
        const id = this.ctx.sessionId();
        const session = this.ctx.session();
        const electron = this.bridge();
        if (!id || !session || !electron?.setEmbeddedMpvPaused) {
            return;
        }
        await this.run(id, () =>
            electron.setEmbeddedMpvPaused(id, session.status !== 'paused')
        );
    }

    async seekBy(deltaSeconds: number): Promise<boolean> {
        const id = this.ctx.sessionId();
        const session = this.ctx.session();
        const electron = this.bridge();
        if (!id || !session || !electron?.seekEmbeddedMpv) {
            return false;
        }
        const next = Math.max(0, session.positionSeconds + deltaSeconds);
        await this.run(id, () => electron.seekEmbeddedMpv(id, next));
        return true;
    }

    async seekTo(seconds: number): Promise<void> {
        const id = this.ctx.sessionId();
        const electron = this.bridge();
        if (!id || !electron?.seekEmbeddedMpv) {
            return;
        }
        await this.run(id, () => electron.seekEmbeddedMpv(id, seconds));
    }

    async applyVolume(value: number): Promise<void> {
        const id = this.ctx.sessionId();
        const electron = this.bridge();
        if (!id || !electron?.setEmbeddedMpvVolume) {
            return;
        }
        await this.run(id, () => electron.setEmbeddedMpvVolume(id, value));
    }

    async setAudioTrack(trackId: number): Promise<void> {
        const id = this.ctx.sessionId();
        const electron = this.bridge();
        if (!id || !electron?.setEmbeddedMpvAudioTrack) {
            return;
        }
        await this.run(id, () =>
            electron.setEmbeddedMpvAudioTrack(id, trackId)
        );
    }

    async setSubtitleTrack(trackId: number): Promise<void> {
        const id = this.ctx.sessionId();
        const electron = this.bridge();
        if (!id || !electron?.setEmbeddedMpvSubtitleTrack) {
            return;
        }
        const setSubtitleTrack = electron.setEmbeddedMpvSubtitleTrack;
        await this.run(id, () => setSubtitleTrack(id, trackId));
    }

    async setSpeed(speed: number): Promise<void> {
        const id = this.ctx.sessionId();
        const electron = this.bridge();
        if (!id || !electron?.setEmbeddedMpvSpeed) {
            return;
        }
        const setSpeed = electron.setEmbeddedMpvSpeed;
        await this.run(id, () => setSpeed(id, speed));
    }

    async setAspect(aspect: string): Promise<void> {
        const id = this.ctx.sessionId();
        const electron = this.bridge();
        if (!id || !electron?.setEmbeddedMpvAspect) {
            return;
        }
        const setAspect = electron.setEmbeddedMpvAspect;
        await this.run(id, () => setAspect(id, aspect));
    }

    async startRecording(
        directory: string | undefined,
        title: string
    ): Promise<EmbeddedMpvSession['recording'] | null> {
        const id = this.ctx.sessionId();
        const electron = this.bridge();
        if (!id || !electron?.startEmbeddedMpvRecording) {
            return null;
        }

        const startEmbeddedMpvRecording = electron.startEmbeddedMpvRecording;
        const resolvedDirectory =
            directory?.trim() ||
            (await electron.getEmbeddedMpvDefaultRecordingFolder?.());
        if (this.ctx.sessionId() !== id) {
            return null;
        }
        const updated = await this.run(id, () =>
            startEmbeddedMpvRecording(id, {
                directory: resolvedDirectory,
                title,
            })
        );
        return updated?.recording ?? null;
    }

    async stopRecording(): Promise<EmbeddedMpvSession['recording'] | null> {
        const id = this.ctx.sessionId();
        const electron = this.bridge();
        if (!id || !electron?.stopEmbeddedMpvRecording) {
            return null;
        }
        const stopEmbeddedMpvRecording = electron.stopEmbeddedMpvRecording;
        const updated = await this.run(id, () => stopEmbeddedMpvRecording(id));
        return updated?.recording ?? null;
    }

    /**
     * Run an IPC call, reconcile the returned snapshot into `session`, and
     * return it (or null when the call was swallowed). Errors are intentionally
     * swallowed: the session may have been torn down or an addon-side throw may
     * have raced the IPC — the next snapshot resyncs state.
     */
    private async run(
        expectedSessionId: string,
        call: () => Promise<EmbeddedMpvSession | null>
    ): Promise<EmbeddedMpvSession | null> {
        const sessionBeforeCall = this.ctx.session();
        const updated = await this.guardIpc(call);
        if (
            !updated ||
            this.ctx.sessionId() !== expectedSessionId ||
            updated.id !== expectedSessionId
        ) {
            return null;
        }
        const current = this.ctx.session();
        if (
            current?.id === expectedSessionId &&
            this.shouldKeepCurrentSnapshot(current, updated, sessionBeforeCall)
        ) {
            return current;
        }
        this.ctx.session.set(updated);
        return updated;
    }

    /**
     * Session broadcasts and invoke replies can cross in flight. Preserve a
     * broadcast observed during this command when it is newer than the reply;
     * for equal timestamps, renderer arrival order breaks the tie.
     */
    private shouldKeepCurrentSnapshot(
        current: EmbeddedMpvSession,
        candidate: EmbeddedMpvSession,
        sessionBeforeCall: EmbeddedMpvSession | null
    ): boolean {
        const currentUpdatedAt = Date.parse(current.updatedAt);
        const candidateUpdatedAt = Date.parse(candidate.updatedAt);
        if (
            !Number.isFinite(currentUpdatedAt) ||
            !Number.isFinite(candidateUpdatedAt)
        ) {
            return false;
        }
        return (
            currentUpdatedAt > candidateUpdatedAt ||
            (currentUpdatedAt === candidateUpdatedAt &&
                current !== sessionBeforeCall)
        );
    }

    private async guardIpc<T>(call: () => Promise<T>): Promise<T | null> {
        try {
            return await call();
        } catch {
            return null;
        }
    }

    private bridge(): ElectronBridge | undefined {
        return window.electron;
    }
}
