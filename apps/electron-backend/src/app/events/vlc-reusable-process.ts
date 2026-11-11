import { ChildProcess } from 'child_process';
import {
    ExternalPlayerSession,
    PlayerContentInfo,
    readExternalPlayerErrorCode,
} from '@iptvnator/shared/interfaces';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import {
    ExternalPlaybackSnapshot,
    externalPlayerSessions,
    sendPlaybackPositionUpdate,
    traceExternalPlayer,
} from './external-player-runtime';
import {
    buildVlcEnqueueCommands,
    sendVlcRcCommand,
    sendVlcRcCommands,
} from './vlc-rc';

export interface VlcReuseAttemptState {
    contentMutated: boolean;
    teardownUnconfirmed: boolean;
    closeRequested: boolean;
    requestedClose: Promise<void> | null;
}

interface VlcReuseOptions {
    session: ExternalPlayerSession;
    previousProcessSessionId: string | null;
    url: string;
    title: string;
    effectiveUserAgent?: string;
    effectiveReferer?: string;
    effectiveOrigin?: string;
    mergedHeaders: Record<string, string>;
    contentInfo?: PlayerContentInfo;
    startTime?: number;
    state: VlcReuseAttemptState;
    startPositionPolling: (
        port: number,
        contentInfo: PlayerContentInfo,
        sessionId: string,
        onSnapshot?: (snapshot: ExternalPlaybackSnapshot) => void,
        onStopped?: () => void
    ) => void;
    stopPositionPolling: (sessionId: string) => void;
}

/** Owns the one VLC child/RC port retained when instance reuse is enabled. */
export class VlcReusableProcess {
    private process: ChildProcess | null = null;
    private rcPort: number | null = null;
    private processSessionId: string | null = null;
    private readonly processSessionIds = new WeakMap<ChildProcess, string>();
    private reuseOrder = 0;
    private dispatchedReuse = 0;

    currentSessionId(): string | null {
        return this.processSessionId;
    }

    sessionIdFor(process: ChildProcess, fallback: string): string {
        return this.processSessionIds.get(process) ?? fallback;
    }

    owns(process: ChildProcess, sessionId: string): boolean {
        return this.processSessionIds.get(process) === sessionId;
    }

    track(process: ChildProcess, rcPort: number, sessionId: string): void {
        this.process = process;
        this.rcPort = rcPort;
        this.processSessionId = sessionId;
        this.processSessionIds.set(process, sessionId);
    }

    clear(process: ChildProcess): boolean {
        if (this.process !== process) return false;
        this.process = null;
        this.rcPort = null;
        this.processSessionId = null;
        return true;
    }

    stopStored(
        reason: string,
        stopPositionPolling: () => void,
        guardFutureLaunches = false
    ): void {
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
        options: VlcReuseOptions
    ): Promise<ExternalPlayerSession | null> {
        const reusedProcess = this.process;
        const reusedRcPort = this.rcPort;
        if (!reusedProcess || reusedProcess.killed || !reusedRcPort)
            return null;

        traceExternalPlayer('reuse existing vlc instance', {
            rcPort: reusedRcPort,
        });
        const { session, state } = options;
        let reusedProcessSessionId =
            this.processSessionIds.get(reusedProcess) ??
            options.previousProcessSessionId;
        const order = ++this.reuseOrder;
        const superseded = () =>
            order < this.dispatchedReuse ||
            (this.process !== null && this.process !== reusedProcess);
        const lostChild = () => this.process !== reusedProcess;
        const retire = () => {
            const snapshot = externalPlayerSessions.getSession(session.id);
            return snapshot?.status === 'error'
                ? snapshot
                : (externalPlayerSessions.markClosed(session.id) ?? session);
        };
        let closeRequested = false;
        let retryableClose: Promise<void> | null = null;
        let launchClose: Promise<void> | null = null;

        const ownsReusedProcess = () =>
            this.processSessionIds.get(reusedProcess) === session.id ||
            externalPlayerSessions.getActiveSessionId() === session.id;
        const closeReusedProcess = async () => {
            externalPlayerProcessTeardownGate.beginTeardown(reusedProcess);
            try {
                await sendVlcRcCommand(reusedRcPort, 'quit');
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

        externalPlayerSessions.attachCloser(session.id, (exact) => {
            closeRequested = true;
            state.closeRequested = true;
            const owner = this.processSessionIds.get(reusedProcess);
            if (
                exact &&
                !launchClose &&
                owner !== session.id &&
                (!state.contentMutated || superseded())
            ) {
                if (owner)
                    externalPlayerSessions.restoreActiveSession(
                        owner,
                        session.id
                    );
                return;
            }
            if (!ownsReusedProcess()) return;
            if (!retryableClose) {
                const closeAttempt = closeReusedProcess();
                retryableClose = closeAttempt;
                launchClose ??= closeAttempt;
                void closeAttempt.catch((error) => {
                    if (retryableClose === closeAttempt) retryableClose = null;
                    state.teardownUnconfirmed = true;
                    externalPlayerSessions.markError(
                        session.id,
                        error instanceof Error ? error.message : String(error),
                        { canClose: true }
                    );
                });
            }
            state.requestedClose = retryableClose;
            return retryableClose;
        });

        try {
            await sendVlcRcCommands(
                reusedRcPort,
                buildVlcEnqueueCommands({
                    url: options.url,
                    title: options.title,
                    userAgent: options.effectiveUserAgent,
                    referer: options.effectiveReferer,
                    origin: options.effectiveOrigin,
                    headers: options.mergedHeaders,
                    startTime: options.startTime,
                }),
                (_command, index) => {
                    if (index !== 0) return;
                    state.contentMutated = true;
                    this.dispatchedReuse = order;
                    reusedProcessSessionId =
                        this.processSessionIds.get(reusedProcess) ??
                        reusedProcessSessionId;
                    this.processSessionId = session.id;
                    this.processSessionIds.set(reusedProcess, session.id);
                    if (reusedProcessSessionId) {
                        externalPlayerSessions.markClosed(
                            reusedProcessSessionId
                        );
                        options.stopPositionPolling(reusedProcessSessionId);
                    }
                },
                () => {
                    if (closeRequested || superseded() || lostChild())
                        return false;
                    if (!state.contentMutated)
                        externalPlayerProcessTeardownGate.assertLaunchAllowed();
                    return true;
                }
            );
            if (closeRequested) return await finishRequestedClose();
            if (superseded()) return retire();
            if (lostChild()) return state.contentMutated ? retire() : null;
            traceExternalPlayer('loaded new url in existing vlc instance');

            let lastSnapshot: ExternalPlaybackSnapshot | null = null;
            if (options.contentInfo) {
                options.startPositionPolling(
                    reusedRcPort,
                    options.contentInfo,
                    session.id,
                    (snapshot) => {
                        lastSnapshot = snapshot;
                    },
                    () => {
                        if (
                            lastSnapshot &&
                            externalPlayerSessions.getSession(session.id)
                                ?.status !== 'closed'
                        ) {
                            sendPlaybackPositionUpdate(
                                session.id,
                                options.contentInfo as PlayerContentInfo,
                                lastSnapshot
                            );
                        }
                        externalPlayerSessions.markClosed(session.id);
                    }
                );
            }
            return externalPlayerSessions.markOpened(session.id) ?? session;
        } catch (error) {
            const current = externalPlayerSessions.getSession(session.id);
            if (current?.status === 'closed') return current;
            if (closeRequested) return await finishRequestedClose();
            if (superseded()) return retire();
            if (lostChild()) return state.contentMutated ? retire() : null;
            if (readExternalPlayerErrorCode(error) === 'previous-closing')
                throw error;
            console.error(
                'Failed to reuse existing VLC, spawning fresh:',
                error
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
            options.stopPositionPolling(
                state.contentMutated
                    ? session.id
                    : (reusedProcessSessionId ?? session.id)
            );
            if (closeRequested) return await finishRequestedClose();
            return null;
        }
    }
}
