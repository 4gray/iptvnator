import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFfmpegCommand } from './local-timeshift-ffmpeg';
import { createLocalTimeshiftHttpServer } from './local-timeshift-http-server';
import { readTimeshiftBufferMetrics } from './local-timeshift-playlist';
import { terminateLocalTimeshiftProcess } from './local-timeshift-process';
import { LocalTimeshiftSessionStarter } from './local-timeshift-session-starter';
import {
    assertLocalTimeshiftCanStart,
    createStartingTimeshiftOperation,
    sanitizeLocalTimeshiftStartError,
    type ActiveLocalTimeshiftSession,
    type StartingLocalTimeshiftOperation,
} from './local-timeshift-state';
import type {
    LocalTimeshiftFailureHandler,
    LocalTimeshiftServiceOptions,
    LocalTimeshiftSessionSnapshot,
    LocalTimeshiftSupport,
    StartLocalTimeshiftSessionRequest,
} from './local-timeshift.types';

export type { LocalTimeshiftServiceOptions } from './local-timeshift.types';

const DEFAULT_START_TIMEOUT_MS = 15_000;
// The sliding buffer is discarded on stop, so a long graceful FFmpeg flush has
// no value; a short SIGTERM window keeps channel zapping snappy before the
// SIGKILL fallback in terminateLocalTimeshiftProcess kicks in.
const DEFAULT_STOP_TIMEOUT_MS = 500;
const CANCELED_START_STOP_TIMEOUT_MS = 0;
const DEFAULT_POLL_INTERVAL_MS = 100;

export class LocalTimeshiftService {
    private readonly sessions = new Map<string, ActiveLocalTimeshiftSession>();
    private readonly sessionIdsByOwner = new Map<string, string>();
    private readonly startsByOwner = new Map<
        string,
        StartingLocalTimeshiftOperation
    >();
    private readonly resolveFfmpeg: () => string | undefined;
    private readonly spawnProcess: NonNullable<
        LocalTimeshiftServiceOptions['spawnProcess']
    >;
    private readonly terminateProcess: NonNullable<
        LocalTimeshiftServiceOptions['terminateProcess']
    >;
    private readonly createHttpServer: NonNullable<
        LocalTimeshiftServiceOptions['createHttpServer']
    >;
    private readonly defaultBufferDirectory: () => string;
    private readonly startTimeoutMs: number;
    private readonly stopTimeoutMs: number;
    private readonly pollIntervalMs: number;
    private ffmpegCommand?: string;
    private ffmpegResolved = false;
    private failureHandler?: LocalTimeshiftFailureHandler;

    constructor(options: LocalTimeshiftServiceOptions = {}) {
        this.resolveFfmpeg = options.resolveFfmpeg ?? resolveFfmpegCommand;
        this.spawnProcess = options.spawnProcess ?? spawn;
        this.terminateProcess =
            options.terminateProcess ?? terminateLocalTimeshiftProcess;
        this.createHttpServer =
            options.createHttpServer ?? createLocalTimeshiftHttpServer;
        this.defaultBufferDirectory =
            options.defaultBufferDirectory ??
            (() => join(tmpdir(), 'iptvnator-timeshift'));
        this.startTimeoutMs =
            options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
        this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
        this.pollIntervalMs =
            options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.failureHandler = options.failureHandler;
    }

    getSupport(): LocalTimeshiftSupport {
        if (!this.ffmpegResolved) {
            this.ffmpegCommand = this.resolveFfmpeg();
            this.ffmpegResolved = true;
        }
        return this.ffmpegCommand
            ? { supported: true, engine: 'ffmpeg' }
            : {
                  supported: false,
                  reason: 'FFmpeg is not available for local timeshift',
              };
    }

    setFailureHandler(handler: LocalTimeshiftFailureHandler): void {
        this.failureHandler = handler;
    }

    async start(
        request: StartLocalTimeshiftSessionRequest
    ): Promise<LocalTimeshiftSessionSnapshot> {
        assertLocalTimeshiftCanStart(
            request,
            this.sessionIdsByOwner.has(request.ownerId) ||
                this.startsByOwner.has(request.ownerId)
        );
        const support = this.getSupport();
        if (!support.supported || !this.ffmpegCommand) {
            throw new Error(support.reason);
        }

        const operation = createStartingTimeshiftOperation();
        this.startsByOwner.set(request.ownerId, operation);
        const starter = new LocalTimeshiftSessionStarter({
            ffmpegCommand: this.ffmpegCommand,
            spawnProcess: this.spawnProcess,
            createHttpServer: this.createHttpServer,
            defaultBufferDirectory: this.defaultBufferDirectory,
            startTimeoutMs: this.startTimeoutMs,
            pollIntervalMs: this.pollIntervalMs,
            registerSession: (session) => {
                this.sessions.set(session.id, session);
                this.sessionIdsByOwner.set(session.ownerId, session.id);
            },
            onUnexpectedExit: (session, error) => {
                void this.handleUnexpectedExit(session, error);
            },
            toSnapshot: (session) => this.toSnapshot(session),
        });
        try {
            return await starter.start(
                request,
                operation.abortController.signal
            );
        } catch (error) {
            if (starter.session) {
                await this.cleanupSession(
                    starter.session,
                    true,
                    operation.abortController.signal.aborted
                        ? CANCELED_START_STOP_TIMEOUT_MS
                        : this.stopTimeoutMs
                );
            } else if (starter.directory) {
                await rm(starter.directory, { recursive: true, force: true });
            }
            throw sanitizeLocalTimeshiftStartError(error);
        } finally {
            this.startsByOwner.delete(request.ownerId);
            operation.finish();
        }
    }

    async getSession(
        sessionId: string,
        ownerId: string
    ): Promise<LocalTimeshiftSessionSnapshot | undefined> {
        const session = this.ownedSession(sessionId, ownerId);
        return session ? this.toSnapshot(session) : undefined;
    }

    async stop(sessionId: string, ownerId: string): Promise<void> {
        const session = this.ownedSession(sessionId, ownerId);
        if (!session) throw new Error('Local timeshift session was not found');
        await this.cleanupSession(session, true);
    }

    async stopForOwner(ownerId: string): Promise<void> {
        const starting = this.startsByOwner.get(ownerId);
        if (starting) {
            starting.abortController.abort();
            await starting.done;
        }
        const sessionId = this.sessionIdsByOwner.get(ownerId);
        const session = sessionId ? this.sessions.get(sessionId) : undefined;
        if (session) {
            // Do not serialize channel zapping behind the previous session's
            // teardown: cleanupSession releases the owner slot synchronously,
            // so a replacement start can proceed while FFmpeg, the HTTP
            // server, and the buffer directory are removed in the background.
            this.cleanupSession(session, true).catch((error) => {
                console.error('Local timeshift teardown failed:', error);
            });
        }
    }

    async shutdown(): Promise<void> {
        for (const starting of this.startsByOwner.values()) {
            starting.abortController.abort();
        }
        await Promise.allSettled(
            [...this.startsByOwner.values()].map((operation) => operation.done)
        );
        await Promise.allSettled(
            [...this.sessions.values()].map((session) =>
                this.cleanupSession(session, true)
            )
        );
    }

    private ownedSession(
        sessionId: string,
        ownerId: string
    ): ActiveLocalTimeshiftSession | undefined {
        const session = this.sessions.get(sessionId);
        return session?.ownerId === ownerId ? session : undefined;
    }

    private async handleUnexpectedExit(
        session: ActiveLocalTimeshiftSession,
        error: Error
    ): Promise<void> {
        try {
            await this.cleanupSession(session, false);
        } finally {
            try {
                this.failureHandler?.({
                    sessionId: session.id,
                    ownerId: session.ownerId,
                    error,
                });
            } catch {
                // A consumer callback must not destabilize the main process.
            }
        }
    }

    private cleanupSession(
        session: ActiveLocalTimeshiftSession,
        terminateProcess: boolean,
        gracefulTimeoutMs = this.stopTimeoutMs
    ): Promise<void> {
        if (session.cleanupPromise) return session.cleanupPromise;
        session.stopping = true;
        // Free the owner slot before the asynchronous teardown so a
        // replacement session for the same owner is not blocked on it.
        if (this.sessionIdsByOwner.get(session.ownerId) === session.id) {
            this.sessionIdsByOwner.delete(session.ownerId);
        }
        session.cleanupPromise = this.performCleanup(
            session,
            terminateProcess,
            gracefulTimeoutMs
        );
        return session.cleanupPromise;
    }

    private async performCleanup(
        session: ActiveLocalTimeshiftSession,
        terminateProcess: boolean,
        gracefulTimeoutMs: number
    ): Promise<void> {
        let stopError: unknown;
        try {
            if (terminateProcess && session.process && !session.processEnded) {
                await this.terminateProcess(session.process, gracefulTimeoutMs);
            }
        } catch (error) {
            stopError = error;
        } finally {
            await Promise.allSettled([
                session.http.close(),
                rm(session.directory, { recursive: true, force: true }),
            ]);
            this.sessions.delete(session.id);
            if (this.sessionIdsByOwner.get(session.ownerId) === session.id) {
                this.sessionIdsByOwner.delete(session.ownerId);
            }
        }
        if (stopError) throw stopError;
    }

    private async toSnapshot(
        session: ActiveLocalTimeshiftSession
    ): Promise<LocalTimeshiftSessionSnapshot> {
        const metrics = await readTimeshiftBufferMetrics(session.directory);
        return {
            id: session.id,
            playbackUrl: session.http.playbackUrl,
            status: 'ready',
            maxDurationSeconds: session.maxDurationSeconds,
            ...metrics,
            startedAt: session.startedAt,
            updatedAt: new Date().toISOString(),
        };
    }
}
