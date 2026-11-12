import { ChildProcess } from 'child_process';
import {
    ExternalPlayerSession,
    PlayerContentInfo,
    readExternalPlayerErrorCode,
} from '@iptvnator/shared/interfaces';
import {
    externalPlayerProcessTeardownGate,
    hasExited,
} from './external-player-process';
import {
    ExternalPlaybackSnapshot,
    externalPlayerSessions,
    sendPlaybackPositionUpdate,
    traceExternalPlayer,
} from './external-player-runtime';
import {
    buildVlcEnqueueCommands,
    markVlcOpened,
    sendVlcRcCommand,
    sendVlcRcCommands,
    type VlcRcAddress,
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
        port: VlcRcAddress,
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
    private rcPort: VlcRcAddress | null = null;
    private processSessionId: string | null = null;
    private readonly processSessionIds = new WeakMap<ChildProcess, string>();
    private readonly recoveringChildren = new WeakSet<ChildProcess>();
    private reuseOrder = 0;
    private dispatchedReuse = 0;
    private stopGeneration = 0;
    private readonly storedStops = new WeakMap<
        ChildProcess,
        Promise<void> | null
    >();

    hasPrivateControl(): boolean {
        return typeof this.rcPort === 'string';
    }

    watchStop(): () => boolean {
        const generation = this.stopGeneration;
        return () => generation !== this.stopGeneration;
    }

    replacementCloser(
        privateControl: boolean
    ): (() => Promise<void>) | undefined {
        const { process, processSessionId, rcPort } = this;
        const compatible =
            rcPort && (!privateControl || this.hasPrivateControl());
        if (!process || !processSessionId || compatible) return undefined;
        return async () => {
            if (externalPlayerSessions.getSession(processSessionId)?.canClose)
                await externalPlayerSessions.closeSession(
                    processSessionId,
                    true
                );
            // VLC can stop its media and close the session without exiting.
            if (!hasExited(process)) {
                this.recoveringChildren.add(process);
                await externalPlayerProcessTeardownGate.terminate(process);
            }
            this.clear(process);
        };
    }

    currentSessionId(): string | null {
        return this.processSessionId;
    }

    sessionIdFor(process: ChildProcess, fallback: string): string {
        return this.processSessionIds.get(process) ?? fallback;
    }

    owns(process: ChildProcess, sessionId: string): boolean {
        return this.processSessionIds.get(process) === sessionId;
    }

    isRecovering(process: ChildProcess): boolean {
        return this.recoveringChildren.has(process);
    }

    canPoll(process: ChildProcess, sessionId: string): boolean {
        return (
            this.owns(process, sessionId) &&
            !this.storedStops.has(process) &&
            !externalPlayerProcessTeardownGate.isStopping(process)
        );
    }

    track(
        process: ChildProcess,
        rcPort: VlcRcAddress,
        sessionId: string
    ): void {
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
        this.stopGeneration += 1;
        const process = this.process;
        if (!process || process.killed) return;
        externalPlayerSessions.requestClose(this.processSessionId);
        traceExternalPlayer(reason);
        const stopping = guardFutureLaunches
            ? externalPlayerProcessTeardownGate.terminate(process)
            : null;
        this.storedStops.set(process, stopping);
        if (stopping) void stopping.catch(() => undefined);
        else process.kill();
        this.clear(process);
        stopPositionPolling();
    }

    async tryReuse(
        options: VlcReuseOptions
    ): Promise<ExternalPlayerSession | null> {
        const { process: reusedProcess, rcPort: reusedRcPort } = this;
        if (!reusedProcess || reusedProcess.killed || !reusedRcPort)
            return null;

        const { session, state } = options;
        const cancelled = this.watchStop();
        let reusedProcessSessionId =
            this.processSessionIds.get(reusedProcess) ??
            options.previousProcessSessionId;
        const order = ++this.reuseOrder;
        const replaced = () =>
            this.process !== reusedProcess &&
            (session.launchId && !session.contentInfo
                ? externalPlayerSessions.isNewerLaunch(
                      this.processSessionId,
                      session
                  )
                : this.process !== null);
        const superseded = () =>
            state.contentMutated
                ? !this.owns(reusedProcess, session.id)
                : order < this.dispatchedReuse || replaced();
        const lostChild = () =>
            hasExited(reusedProcess) ||
            (!state.contentMutated && this.process !== reusedProcess);
        const retire = () => {
            const snapshot = externalPlayerSessions.getSession(session.id);
            return snapshot?.status === 'error'
                ? snapshot
                : (externalPlayerSessions.markClosed(session.id) ?? session);
        };
        let closeRequested = false;
        let retryableClose: Promise<void> | null = null;
        let launchClose: Promise<void> | null = null;
        let fallbackTeardown: Promise<void> | undefined;
        let ownsFailedTeardown = false;
        const settleCancelled = async () => {
            const stopped = this.storedStops.has(reusedProcess);
            if (!stopped && !this.owns(reusedProcess, session.id))
                return retire();
            try {
                await (this.storedStops.get(reusedProcess) ??
                    externalPlayerProcessTeardownGate.terminate(reusedProcess, {
                        sendTerminationSignal: !stopped,
                    }));
            } catch (error) {
                ownsFailedTeardown = true;
                return (
                    externalPlayerSessions.markError(
                        session.id,
                        error instanceof Error ? error.message : String(error),
                        { canClose: true }
                    ) ?? session
                );
            }
            return retire();
        };

        const ownsReusedProcess = () =>
            ownsFailedTeardown ||
            this.processSessionIds.get(reusedProcess) === session.id ||
            externalPlayerSessions.getActiveSessionId() === session.id;
        const closeReusedProcess = async () => {
            if (hasExited(reusedProcess)) return;
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
                !ownsFailedTeardown &&
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
                const closeAttempt = fallbackTeardown ?? closeReusedProcess();
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
                (index) => {
                    if (
                        closeRequested ||
                        cancelled() ||
                        superseded() ||
                        lostChild()
                    )
                        return false;
                    // Both clear and add change playback.
                    if (index < 2)
                        externalPlayerProcessTeardownGate.assertLaunchAllowed();
                    return true;
                }
            );
            if (closeRequested) return await finishRequestedClose();
            if (cancelled()) return await settleCancelled();
            if (superseded()) return retire();
            if (lostChild()) return state.contentMutated ? retire() : null;
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
            return (
                markVlcOpened(
                    session.id,
                    () =>
                        this.canPoll(reusedProcess, session.id)
                            ? reusedRcPort
                            : 0,
                    options,
                    true
                ) ?? session
            );
        } catch (error) {
            const current = externalPlayerSessions.getSession(session.id);
            if (current?.status === 'closed') return current;
            if (closeRequested) return await finishRequestedClose();
            if (cancelled()) return await settleCancelled();
            if (superseded()) return retire();
            if (lostChild()) return state.contentMutated ? retire() : null;
            if (readExternalPlayerErrorCode(error) === 'previous-closing') {
                const owner = this.processSessionIds.get(reusedProcess);
                if (state.contentMutated) state.teardownUnconfirmed = true;
                else if (
                    owner &&
                    !externalPlayerProcessTeardownGate.isStopping(reusedProcess)
                )
                    externalPlayerSessions.restoreActiveSession(
                        owner,
                        session.id
                    );
                throw error;
            }
            console.error(
                'Failed to reuse existing VLC, spawning fresh:',
                error
            );

            if (state.contentMutated)
                this.recoveringChildren.add(reusedProcess);
            try {
                fallbackTeardown =
                    externalPlayerProcessTeardownGate.terminate(reusedProcess);
                await fallbackTeardown;
            } catch (teardownError) {
                state.teardownUnconfirmed = true;
                throw teardownError;
            } finally {
                fallbackTeardown = undefined;
                this.recoveringChildren.delete(reusedProcess);
            }
            this.clear(reusedProcess);
            options.stopPositionPolling(
                state.contentMutated
                    ? session.id
                    : (reusedProcessSessionId ?? session.id)
            );
            if (closeRequested) return await finishRequestedClose();
            if (cancelled()) return await settleCancelled();
            return null;
        }
    }
}
