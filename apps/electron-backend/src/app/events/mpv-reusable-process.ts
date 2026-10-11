import { ChildProcess } from 'child_process';
import {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { joinMpvHeaderFields } from '../util/mpv-string-list.util';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import {
    externalPlayerSessions,
    traceExternalPlayer,
} from './external-player-runtime';
import { sendMpvCommand } from './mpv-ipc-command';

/**
 * The per-file start of a reuse load: the requested offset, else zero. A
 * `seek` right after `loadfile` runs before the file is loaded and mpv
 * rejects it, so the offset travels with the load itself and no seek is
 * sent on the reuse path.
 */
function reuseStartSeconds(startTime: number | undefined): number {
    return typeof startTime === 'number' &&
        Number.isFinite(startTime) &&
        startTime >= 0
        ? startTime
        : 0;
}

function hasExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

export interface MpvReuseAttemptState {
    contentMutated: boolean;
    teardownUnconfirmed: boolean;
}

interface MpvReuseOptions {
    session: ExternalPlayerSession;
    previousProcessSessionId: string | null;
    url: string;
    title: string;
    effectiveUserAgent?: string;
    effectiveReferer?: string;
    headerFields: string[];
    contentInfo?: PlayerContentInfo;
    startTime?: number;
    state: MpvReuseAttemptState;
    startPositionPolling: (
        socketPath: string,
        contentInfo: PlayerContentInfo,
        sessionId: string
    ) => void;
    stopPositionPolling: () => void;
}

/** Owns the one MPV child/socket retained when instance reuse is enabled. */
export class MpvReusableProcess {
    private process: ChildProcess | null = null;
    private socketPath: string | null = null;
    private processSessionId: string | null = null;
    private readonly processSessionIds = new WeakMap<ChildProcess, string>();
    // Bumped whenever the stored player is stopped (reuse disabled or app
    // quitting). Launches run one at a time, so the only thing that can
    // overtake an in-flight reuse attempt is that stop, which cancels it.
    private stopGeneration = 0;

    currentSessionId(): string | null {
        return this.processSessionId;
    }

    /**
     * The session that owns the stored child right now. A failed reuse
     * attempt hands the child back to its previous owner while it tears it
     * down, so this reads the per-child mapping, not the last recorded id.
     */
    storedOwnerSessionId(): string | null {
        if (!this.process) return null;
        return (
            this.processSessionIds.get(this.process) ?? this.processSessionId
        );
    }

    sessionIdFor(process: ChildProcess, fallback: string): string {
        return this.processSessionIds.get(process) ?? fallback;
    }

    owns(process: ChildProcess, sessionId: string): boolean {
        return this.processSessionIds.get(process) === sessionId;
    }

    track(process: ChildProcess, socketPath: string, sessionId: string): void {
        this.process = process;
        this.socketPath = socketPath;
        this.processSessionId = sessionId;
        this.processSessionIds.set(process, sessionId);
    }

    clear(process: ChildProcess): boolean {
        if (this.process !== process) return false;
        this.process = null;
        this.socketPath = null;
        this.processSessionId = null;
        return true;
    }

    stopStored(
        reason: string,
        stopPositionPolling: () => void,
        guardFutureLaunches = false
    ): void {
        // A launch still waiting for mpv's reply must not fall back to a
        // fresh, again-reusable player once reuse is disabled or the app
        // quits: cancel it so it settles its own session instead.
        this.stopGeneration += 1;
        const process = this.process;
        if (!process || process.killed) return;
        traceExternalPlayer(reason);
        if (guardFutureLaunches) {
            externalPlayerProcessTeardownGate.terminateInBackground(process);
        } else {
            process.kill();
        }
        this.clear(process);
        stopPositionPolling();
    }

    async tryReuse(
        options: MpvReuseOptions
    ): Promise<ExternalPlayerSession | null> {
        const reusedProcess = this.process;
        const reusedSocketPath = this.socketPath;
        if (!reusedProcess || reusedProcess.killed || !reusedSocketPath) {
            return null;
        }

        traceExternalPlayer('reuse existing mpv instance');
        const { session, state } = options;
        const generation = this.stopGeneration;
        const cancelled = () => generation !== this.stopGeneration;
        // The stored-player stop is already tearing the child down; settle
        // only once its exit is confirmed, else stay a closable error so Stop
        // can retry while the teardown gate blocks further launches.
        const settleCancelled = async () => {
            traceExternalPlayer('mpv reuse cancelled by a stored-player stop');
            try {
                await externalPlayerProcessTeardownGate.terminate(
                    reusedProcess
                );
            } catch (error) {
                state.teardownUnconfirmed = true;
                return (
                    externalPlayerSessions.markError(
                        session.id,
                        error instanceof Error ? error.message : String(error),
                        { canClose: true }
                    ) ?? session
                );
            }
            return externalPlayerSessions.markClosed(session.id) ?? session;
        };
        const reusedProcessSessionId =
            this.processSessionIds.get(reusedProcess) ??
            options.previousProcessSessionId;
        let closeRequested = false;
        let retryableClose: Promise<void> | null = null;
        let launchClose: Promise<void> | null = null;

        // Launches run one at a time, so nothing else acts on this child while
        // this attempt is in flight: its Stop always reaches the child then,
        // whoever the per-child mapping names (the previous owner before
        // loadfile or during a failed attempt's teardown, possibly closed
        // already). Once the attempt settles, ownership decides as before.
        let attemptInFlight = true;
        // A Stop of this session that could not confirm the exit keeps the
        // right to retry that exact child after the attempt settles.
        let ownsFailedTeardown = false;
        const ownsReusedProcess = () =>
            attemptInFlight ||
            ownsFailedTeardown ||
            this.processSessionIds.get(reusedProcess) === session.id ||
            externalPlayerSessions.getActiveSessionId() === session.id;
        const closeReusedProcess = async () => {
            externalPlayerProcessTeardownGate.beginTeardown(reusedProcess);
            try {
                await sendMpvCommand(reusedSocketPath, 'quit', []);
            } catch {
                await externalPlayerProcessTeardownGate.terminate(
                    reusedProcess
                );
                return;
            }
            await externalPlayerProcessTeardownGate.terminate(reusedProcess, {
                sendTerminationSignal: false,
            });
        };
        const finishRequestedClose = async () => {
            if (launchClose) {
                try {
                    await launchClose;
                } catch (error) {
                    state.teardownUnconfirmed = true;
                    throw error;
                }
            }
            return externalPlayerSessions.markClosed(session.id) ?? session;
        };

        externalPlayerSessions.attachCloser(session.id, () => {
            closeRequested = true;
            if (!ownsReusedProcess()) return;
            if (!retryableClose) {
                const closeAttempt = closeReusedProcess();
                retryableClose = closeAttempt;
                launchClose ??= closeAttempt;
                void closeAttempt.catch((error) => {
                    if (retryableClose === closeAttempt) retryableClose = null;
                    ownsFailedTeardown = true;
                    state.teardownUnconfirmed = true;
                    externalPlayerSessions.markError(
                        session.id,
                        error instanceof Error ? error.message : String(error),
                        { canClose: true }
                    );
                });
            }
            return retryableClose;
        });

        // Once `loadfile` reaches the socket the player content may have
        // changed, whatever mpv replies, so the attempted session owns the
        // child from the write onwards: an exit or a stale Stop for the
        // previous session during the reply wait then lands on the right
        // session instead of terminating the new playback, and the previous
        // session's position poll can no longer read the new stream's
        // position under the old content.
        const onContentDispatched = () => {
            state.contentMutated = true;
            this.processSessionId = session.id;
            this.processSessionIds.set(reusedProcess, session.id);
            options.stopPositionPolling();
        };

        try {
            await this.applyReuseCommands(
                options,
                reusedSocketPath,
                () => !closeRequested && !cancelled(),
                onContentDispatched
            );
            if (closeRequested) return await finishRequestedClose();
            if (cancelled()) return await settleCancelled();
            if (hasExited(reusedProcess)) {
                // The child exited while its reply was in flight; its exit
                // handler has already settled the session that owned it.
                return externalPlayerSessions.getSession(session.id) ?? session;
            }

            if (options.contentInfo) {
                options.startPositionPolling(
                    reusedSocketPath,
                    options.contentInfo,
                    session.id
                );
            } else {
                options.stopPositionPolling();
            }
            return externalPlayerSessions.markOpened(session.id) ?? session;
        } catch (error) {
            const current = externalPlayerSessions.getSession(session.id);
            if (current?.status === 'closed') return current;
            if (closeRequested) return await finishRequestedClose();
            if (cancelled()) return await settleCancelled();
            if (current?.status === 'error' && hasExited(reusedProcess)) {
                // The child died while its reply was in flight and its exit
                // handler already reported the failure; a fresh launch under
                // this terminal session could never be shown as opened.
                return current;
            }
            console.error(
                'Failed to send command to existing MPV:',
                redactSensitiveData(error)
            );

            if (state.contentMutated) {
                if (reusedProcessSessionId) {
                    this.processSessionIds.set(
                        reusedProcess,
                        reusedProcessSessionId
                    );
                } else {
                    this.processSessionIds.delete(reusedProcess);
                }
            }
            try {
                await externalPlayerProcessTeardownGate.terminate(
                    reusedProcess
                );
            } catch (teardownError) {
                if (state.contentMutated) {
                    this.processSessionIds.set(reusedProcess, session.id);
                }
                state.teardownUnconfirmed = true;
                throw teardownError;
            }
            this.clear(reusedProcess);
            options.stopPositionPolling();
            if (closeRequested) return await finishRequestedClose();
            // Reuse may have been disabled, or the app may be quitting,
            // while the teardown above waited for the child to exit.
            if (cancelled()) return await settleCancelled();
            return null;
        } finally {
            attemptInFlight = false;
        }
    }

    private async applyReuseCommands(
        options: MpvReuseOptions,
        socketPath: string,
        shouldDispatch: () => boolean,
        onContentDispatched: () => void
    ): Promise<void> {
        if (options.effectiveUserAgent) {
            const dispatched = await sendMpvCommand(
                socketPath,
                'set_property',
                ['user-agent', options.effectiveUserAgent],
                { shouldDispatch }
            );
            if (!dispatched) return;
        }
        if (options.effectiveReferer) {
            const dispatched = await sendMpvCommand(
                socketPath,
                'set_property',
                ['referrer', options.effectiveReferer],
                { shouldDispatch }
            );
            if (!dispatched) return;
        }
        if (options.headerFields.length > 0) {
            const dispatched = await sendMpvCommand(
                socketPath,
                'set_property',
                [
                    'http-header-fields',
                    joinMpvHeaderFields(options.headerFields),
                ],
                { shouldDispatch }
            );
            if (!dispatched) return;
        }
        if (!shouldDispatch()) return;
        // The reused process was launched with a global `--start=<resume>`,
        // which mpv applies to every later file too. A per-file `start`
        // (0 when nothing is resumed) keeps each load at its own offset.
        const fileOptions = [`start=${reuseStartSeconds(options.startTime)}`];
        if (options.title) {
            fileOptions.push(`force-media-title=${options.title}`);
        }
        const loadFileArgs: Array<string | number> = [
            options.url,
            'replace',
            -1,
            fileOptions.join(','),
        ];
        const reply = await sendMpvCommand(
            socketPath,
            'loadfile',
            loadFileArgs,
            { shouldDispatch, onDispatched: onContentDispatched }
        );
        if (!reply) return;
        traceExternalPlayer('loaded new url in existing mpv instance');
    }
}
