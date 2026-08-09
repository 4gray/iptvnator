import { ChildProcess } from 'child_process';
import { createConnection } from 'net';
import {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { joinMpvHeaderFields } from '../util/mpv-string-list.util';
import { externalPlayerProcessTeardownGate } from './external-player-process';
import {
    externalPlayerSessions,
    traceExternalPlayer,
} from './external-player-runtime';

const MPV_IPC_COMMAND_TIMEOUT_MS = 2_000;

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

function sendMpvCommand(
    socketPath: string,
    command: string,
    args: Array<string | number>,
    shouldDispatch?: () => boolean
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const client = createConnection(socketPath);
        const request = JSON.stringify({ command: [command, ...args] }) + '\n';
        let settled = false;
        let timeoutHandle: NodeJS.Timeout | null = null;
        const complete = (error?: Error, dispatched = true) => {
            if (settled) return;
            settled = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (!dispatched && !client.destroyed) client.destroy();
            if (error) {
                reject(error);
            } else {
                resolve(dispatched);
            }
        };

        client.on('connect', () => {
            if (shouldDispatch && !shouldDispatch()) {
                complete(undefined, false);
                return;
            }
            traceExternalPlayer('mpv ipc command', {
                command,
                argsCount: args.length,
            });
            try {
                client.write(request);
                client.end();
                complete();
            } catch (error) {
                complete(
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        });
        client.on('error', (error) => complete(error));
        timeoutHandle = setTimeout(() => {
            complete(new Error('MPV IPC command timed out'));
            client.destroy();
        }, MPV_IPC_COMMAND_TIMEOUT_MS);
        timeoutHandle.unref();
    });
}

/** Owns the one MPV child/socket retained when instance reuse is enabled. */
export class MpvReusableProcess {
    private process: ChildProcess | null = null;
    private socketPath: string | null = null;
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

        try {
            await this.applyReuseCommands(
                options,
                reusedSocketPath,
                () => !closeRequested
            );
            if (closeRequested) return await finishRequestedClose();

            state.contentMutated = true;
            this.processSessionId = session.id;
            this.processSessionIds.set(reusedProcess, session.id);
            options.stopPositionPolling();

            if (options.startTime) {
                await sendMpvCommand(
                    reusedSocketPath,
                    'seek',
                    [String(options.startTime), 'absolute'],
                    () => !closeRequested
                );
            }
            if (closeRequested) return await finishRequestedClose();

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
            console.error('Failed to send command to existing MPV:', error);

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

    private async applyReuseCommands(
        options: MpvReuseOptions,
        socketPath: string,
        shouldDispatch: () => boolean
    ): Promise<void> {
        if (options.effectiveUserAgent) {
            const dispatched = await sendMpvCommand(
                socketPath,
                'set_property',
                ['user-agent', options.effectiveUserAgent],
                shouldDispatch
            );
            if (!dispatched) return;
        }
        if (options.effectiveReferer) {
            const dispatched = await sendMpvCommand(
                socketPath,
                'set_property',
                ['referrer', options.effectiveReferer],
                shouldDispatch
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
                shouldDispatch
            );
            if (!dispatched) return;
        }
        if (!shouldDispatch()) return;
        const loadFileArgs: Array<string | number> = [options.url, 'replace'];
        if (options.title) {
            loadFileArgs.push(-1, `force-media-title=${options.title}`);
        }
        const dispatched = await sendMpvCommand(
            socketPath,
            'loadfile',
            loadFileArgs,
            shouldDispatch
        );
        if (!dispatched) return;
        traceExternalPlayer('loaded new url in existing mpv instance');
    }
}
