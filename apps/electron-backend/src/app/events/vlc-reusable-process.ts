import { ChildProcess } from 'child_process';
import {
    ExternalPlayerSession,
    PlayerContentInfo,
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
    stopPositionPolling: () => void;
}

/** Owns the one VLC child/RC port retained when instance reuse is enabled. */
export class VlcReusableProcess {
    private process: ChildProcess | null = null;
    private rcPort: number | null = null;
    private processSessionId: string | null = null;
    private readonly processSessionIds = new WeakMap<ChildProcess, string>();

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
        const reusedProcessSessionId =
            this.processSessionIds.get(reusedProcess) ??
            options.previousProcessSessionId;
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

        externalPlayerSessions.attachCloser(session.id, () => {
            closeRequested = true;
            state.closeRequested = true;
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
                    this.processSessionId = session.id;
                    this.processSessionIds.set(reusedProcess, session.id);
                    options.stopPositionPolling();
                },
                () => !closeRequested
            );
            if (closeRequested) return await finishRequestedClose();
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
            } else {
                options.stopPositionPolling();
            }
            return externalPlayerSessions.markOpened(session.id) ?? session;
        } catch (error) {
            const current = externalPlayerSessions.getSession(session.id);
            if (current?.status === 'closed') return current;
            if (closeRequested) return await finishRequestedClose();
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
            options.stopPositionPolling();
            if (closeRequested) return await finishRequestedClose();
            return null;
        }
    }
}
