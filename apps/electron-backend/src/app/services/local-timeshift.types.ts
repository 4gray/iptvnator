import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { LocalTimeshiftHttpServer } from './local-timeshift-http-server';

export type LocalTimeshiftStatus = 'ready';

export interface StartLocalTimeshiftSessionRequest {
    ownerId: string;
    sourceUrl: string;
    requestHeaders?: Record<string, string>;
    maxDurationMinutes: number;
    bufferDirectory?: string;
}

/**
 * Renderer-safe session data. Input credentials and all filesystem paths stay
 * in the Electron main process.
 */
export interface LocalTimeshiftSessionSnapshot {
    id: string;
    playbackUrl: string;
    status: LocalTimeshiftStatus;
    maxDurationSeconds: number;
    bufferedDurationSeconds: number;
    bytesUsed: number;
    startedAt: string;
    updatedAt: string;
}

export interface LocalTimeshiftSupport {
    supported: boolean;
    engine?: 'ffmpeg';
    reason?: string;
}

export interface LocalTimeshiftFailure {
    sessionId: string;
    ownerId: string;
    error: Error;
}

export type LocalTimeshiftFailureHandler = (
    failure: LocalTimeshiftFailure
) => void;

export type SpawnTimeshiftProcess = (
    command: string,
    args: readonly string[],
    options: SpawnOptions
) => ChildProcess;

export type TerminateTimeshiftProcess = (
    child: ChildProcess,
    gracefulTimeoutMs: number
) => Promise<void>;

export type CreateTimeshiftHttpServer = (
    directory: string,
    token: string
) => Promise<LocalTimeshiftHttpServer>;

export interface LocalTimeshiftServiceOptions {
    resolveFfmpeg?: () => string | undefined;
    spawnProcess?: SpawnTimeshiftProcess;
    terminateProcess?: TerminateTimeshiftProcess;
    createHttpServer?: CreateTimeshiftHttpServer;
    defaultBufferDirectory?: () => string;
    startTimeoutMs?: number;
    stopTimeoutMs?: number;
    pollIntervalMs?: number;
    failureHandler?: LocalTimeshiftFailureHandler;
}
