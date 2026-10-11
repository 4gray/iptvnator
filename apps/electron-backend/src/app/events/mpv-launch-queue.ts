import {
    ExternalPlayerSession,
    readExternalPlayerErrorCode,
} from '@iptvnator/shared/interfaces';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import { externalPlayerSessions } from './external-player-runtime';

/** What a launch knows about its place in the queue when it starts. */
export interface QueuedMpvLaunch {
    /** Whether this launch waited behind another one. */
    queued: boolean;
    /**
     * Whether Stop or shutdown cancelled this launch while it waited, or a
     * newer launch is queued behind it.
     */
    cancelled: () => boolean;
    /** This launch's own queued Stop, if one was requested. */
    pendingStop: () => Promise<void> | null;
    /** Called once the launch really starts acting on a player. */
    markInFlight: () => void;
    /** The last launch that started before this one runs. */
    lastStartedSessionId: () => string | null;
}

/**
 * Runs MPV launches one at a time. A reused launch waits for mpv's replies
 * (bounded per command) and a failed one for its teardown and fallback
 * spawn, so overlapping launches would act on the same child. Queued, each
 * launch starts from the player the previous one left behind, and only the
 * newest queued launch runs. An idle queue starts a launch synchronously.
 *
 * Until a queued launch starts, its Stop cancels it and every launch queued
 * before it. Stop on the newest one also closes, through their own closers,
 * the in-flight launch and the session owning the stored player, so the
 * exact-child, retry and settle rules of those closers apply.
 */
export class MpvLaunchQueue {
    private pending: Promise<unknown> | null = null;
    private latest = 0;
    private cancelledThrough = 0;
    private inFlightSessionId: string | null = null;
    // The last launch that actually started. With reuse off its detached
    // child is not stored, so it is the only handle on that player once the
    // launch settled with an unconfirmed teardown.
    private lastStartedSessionId: string | null = null;

    constructor(private readonly storedOwnerSessionId: () => string | null) {}

    /** Cancels every launch queued so far, for app shutdown. */
    cancelAll(): void {
        this.cancelledThrough = this.latest;
    }

    enqueue(
        session: ExternalPlayerSession,
        launch: (queue: QueuedMpvLaunch) => Promise<ExternalPlayerSession>
    ): Promise<ExternalPlayerSession> {
        const previous = this.pending;
        const number = ++this.latest;
        let stop: Promise<void> | null = null;
        // Fixed at the first Stop, so a retry never reaches a newer player.
        let stopTargets: string[] | null = null;
        if (previous) {
            externalPlayerSessions.attachCloser(session.id, () => {
                this.cancelledThrough = Math.max(this.cancelledThrough, number);
                // A late Stop for an older queued launch only cancels it.
                stopTargets ??=
                    number === this.latest ? this.stopTargets(session.id) : [];
                stop = Promise.all(
                    stopTargets.map((id) =>
                        externalPlayerSessions.closeSession(id)
                    )
                ).then(() => undefined);
                return stop;
            });
        }
        const queue: QueuedMpvLaunch = {
            queued: previous !== null,
            cancelled: () =>
                number <= this.cancelledThrough || number !== this.latest,
            pendingStop: () => stop,
            markInFlight: () => {
                this.inFlightSessionId = session.id;
                this.lastStartedSessionId = session.id;
            },
            lastStartedSessionId: () => this.lastStartedSessionId,
        };
        const run = () => launch(queue);
        // The queue is released before the caller sees the result, so a
        // launch made right after this one settles starts synchronously.
        let settled: Promise<unknown> | null = null;
        const result = (previous ? previous.then(run) : run()).finally(() => {
            if (this.inFlightSessionId === session.id) {
                this.inFlightSessionId = null;
            }
            if (this.pending === settled) this.pending = null;
        });
        settled = result.catch(() => undefined);
        this.pending = settled;
        return result;
    }

    private stopTargets(sessionId: string): string[] {
        const targets: string[] = [];
        for (const id of [
            this.inFlightSessionId,
            this.storedOwnerSessionId(),
            this.lastStartedSessionId,
        ]) {
            // Only a session with its own closer can confirm its teardown;
            // closing one without would just mark it closed.
            if (
                id &&
                id !== sessionId &&
                !targets.includes(id) &&
                externalPlayerSessions.getSession(id)?.canClose
            ) {
                targets.push(id);
            }
        }
        return targets;
    }
}

/**
 * Settles a queued launch that will not start. When its own Stop is still
 * closing the in-flight player, the outcome waits for it: a Stop that
 * cannot confirm the exit leaves a closable error, so Stop can be retried.
 */
export async function settleCancelledQueuedLaunch(
    session: ExternalPlayerSession,
    pendingStop: Promise<void> | null
): Promise<ExternalPlayerSession> {
    if (pendingStop) {
        try {
            await pendingStop;
        } catch (error) {
            return (
                externalPlayerSessions.markError(
                    session.id,
                    error instanceof Error ? error.message : String(error),
                    { canClose: true }
                ) ?? session
            );
        }
    }
    return externalPlayerSessions.markClosed(session.id) ?? session;
}

/**
 * A queued launch starts after an earlier one may have left a child whose
 * exit is unconfirmed. Then the dock goes back to the session that still
 * owns that child; failing that, this session keeps its queued closer so
 * Stop can still reach the child.
 */
export function assertQueuedLaunchAllowed(
    session: ExternalPlayerSession,
    restoreCandidates: Array<string | null>
): void {
    try {
        externalPlayerProcessTeardownGate.assertLaunchAllowed();
    } catch (error) {
        let restored: ExternalPlayerSession | null = null;
        for (const id of restoreCandidates) {
            if (!id || id === session.id) continue;
            restored = externalPlayerSessions.restoreActiveSession(
                id,
                session.id
            );
            if (restored) break;
        }
        externalPlayerSessions.markError(
            session.id,
            error instanceof Error ? error.message : String(error),
            {
                code: readExternalPlayerErrorCode(error) ?? undefined,
                canClose: !restored,
            }
        );
        throw error;
    }
}
