import { signal } from '@angular/core';
import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import { handoffMpvAudio } from '../embedded-mpv-player/embedded-mpv-audio-handoff';
import type { EmbeddedMpvPlayerComponent } from '../embedded-mpv-player/embedded-mpv-player.component';
import type { CompanionSlot, MultiviewSlot } from './second-stream-open-stream';

interface AudioSession {
    id: string;
    current: () => boolean;
}

/** Owns the sound selection and serializes commands against captured session IDs. */
export class SecondStreamAudio {
    readonly slot = signal<MultiviewSlot>(1);
    readonly volume = signal(1);
    readonly busy = signal(false);
    readonly error = signal(false);
    private pending?: Promise<boolean>;
    private acknowledged?: EmbeddedMpvSession | null;
    private observed = false;
    private observedSessionId?: string;

    constructor(
        private readonly playerAt: (
            slot: MultiviewSlot
        ) => EmbeddedMpvPlayerComponent | undefined,
        private readonly playable: (slot: MultiviewSlot) => boolean,
        private readonly alive: () => boolean
    ) {}

    observeVolume(): void {
        const player = this.playerAt(this.slot());
        const snapshot = player?.session();
        if (
            snapshot &&
            snapshot !== this.acknowledged &&
            snapshot.id === player?.controller.sessionId() &&
            snapshot.status !== 'closed'
        ) {
            if (snapshot.status === 'playing' || snapshot.status === 'paused')
                this.observedSessionId = snapshot.id;
            // A new helper's loading snapshot can contain its default gain.
            if (this.observedSessionId === snapshot.id) {
                this.observed = true;
                this.volume.set(snapshot.volume);
                return;
            }
        }
        if (!this.observed && player) this.volume.set(player.volume());
    }

    move(
        to: MultiviewSlot,
        allowed: () => boolean = () => true
    ): Promise<boolean> {
        if (this.pending || this.slot() === to) return Promise.resolve(false);
        const from = this.slot();
        const outgoing = this.capture(from);
        const incoming = this.capture(to);
        if (!outgoing || !incoming) return Promise.resolve(false);
        this.observeVolume();
        this.busy.set(true);
        this.error.set(false);
        const pending = this.transfer(
            from,
            to,
            outgoing,
            incoming,
            allowed
        ).finally(() => {
            this.pending = undefined;
            this.busy.set(false);
        });
        this.pending = pending;
        return pending;
    }

    private async transfer(
        from: MultiviewSlot,
        to: MultiviewSlot,
        outgoing: AudioSession,
        incoming: AudioSession,
        allowed: () => boolean
    ): Promise<boolean> {
        const validOutgoing = () =>
            this.alive() && outgoing.current() && this.playable(from);
        const canContinue = () =>
            validOutgoing() &&
            incoming.current() &&
            this.playable(to) &&
            allowed();
        let muted = false;
        let unmuted = false;
        try {
            await handoffMpvAudio(
                {
                    setEmbeddedMpvVolume: async (id, value) => {
                        const result =
                            await window.electron.setEmbeddedMpvVolume(
                                id,
                                value
                            );
                        if (id === outgoing.id) muted = true;
                        else unmuted = true;
                        return result;
                    },
                },
                outgoing.id,
                incoming.id,
                this.volume(),
                canContinue
            );
            if (canContinue()) {
                this.acknowledged = this.playerAt(to)?.session();
                this.observedSessionId = incoming.id;
                this.slot.set(to);
                return true;
            }
        } catch {
            if (canContinue()) this.error.set(true);
        }
        // A relock or exit can arrive while the incoming unmute is already in flight.
        if (unmuted && !(await this.write(incoming.id, 0))) {
            this.acknowledged = this.playerAt(from)?.session();
            this.volume.set(0);
            return false;
        }
        if (muted) {
            if (validOutgoing()) await this.write(outgoing.id, this.volume());
            this.acknowledged = this.playerAt(from)?.session();
        }
        return false;
    }

    async retire(slots: ReadonlySet<CompanionSlot>): Promise<void> {
        if (this.pending) await this.pending;
        const from = this.slot();
        if (from === 1 || !slots.has(from) || !this.alive()) return;
        this.observeVolume();
        const outgoing = this.capture(from);
        const primary = this.capture(1);
        // Keep the primary silent if the closed stream's mute cannot be confirmed.
        const muted = outgoing && (await this.write(outgoing.id, 0));
        if (!this.alive()) return;
        const restored =
            muted &&
            primary?.current() &&
            this.playable(1) &&
            (await this.write(primary.id, this.volume()));
        this.acknowledged = this.playerAt(1)?.session();
        this.observedSessionId = restored ? primary?.id : undefined;
        this.observed = true;
        if (!restored) {
            this.error.set(true);
            this.volume.set(0);
        }
        this.slot.set(1);
    }

    private async write(id: string, volume: number): Promise<boolean> {
        try {
            await window.electron.setEmbeddedMpvVolume(id, volume);
            return true;
        } catch {
            if (this.alive()) this.error.set(true);
            return false;
        }
    }

    private capture(slot: MultiviewSlot): AudioSession | undefined {
        const player = this.playerAt(slot);
        const id = player?.controller.sessionId();
        const playback = player?.playback();
        if (!player || !id) return;
        return {
            id,
            current: () =>
                this.playerAt(slot) === player &&
                player.playback() === playback &&
                player.controller.sessionId() === id,
        };
    }
}
