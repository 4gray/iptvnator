import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { LocalTimeshiftHttpServer } from './local-timeshift-http-server';
import type { StartLocalTimeshiftSessionRequest } from './local-timeshift.types';

export interface StartingLocalTimeshiftOperation {
    abortController: AbortController;
    done: Promise<void>;
    finish(): void;
}

export interface ActiveLocalTimeshiftSession {
    id: string;
    ownerId: string;
    directory: string;
    maxDurationSeconds: number;
    startedAt: string;
    http: LocalTimeshiftHttpServer;
    process?: ChildProcess;
    processEnded: boolean;
    processFailure: Promise<Error>;
    resolveProcessFailure(error: Error): void;
    ready: boolean;
    stopping: boolean;
    cleanupPromise?: Promise<void>;
}

export function createStartingTimeshiftOperation(): StartingLocalTimeshiftOperation {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => (finish = resolve));
    return { abortController: new AbortController(), done, finish };
}

export function assertLocalTimeshiftCanStart(
    request: StartLocalTimeshiftSessionRequest,
    ownerAlreadyActive: boolean
): void {
    if (!request.ownerId.trim()) throw new Error('Timeshift owner is required');
    if (!request.sourceUrl.trim())
        throw new Error('Timeshift source is required');
    if (ownerAlreadyActive) {
        throw new Error('Local timeshift is already active for this owner');
    }
}

export function createActiveTimeshiftSession(
    request: StartLocalTimeshiftSessionRequest,
    directory: string,
    http: LocalTimeshiftHttpServer
): ActiveLocalTimeshiftSession {
    let resolveProcessFailure!: (error: Error) => void;
    const processFailure = new Promise<Error>(
        (resolve) => (resolveProcessFailure = resolve)
    );
    return {
        id: randomUUID(),
        ownerId: request.ownerId,
        directory,
        maxDurationSeconds: Math.ceil(request.maxDurationMinutes * 60),
        startedAt: new Date().toISOString(),
        http,
        processEnded: false,
        processFailure,
        resolveProcessFailure,
        ready: false,
        stopping: false,
    };
}

export function sanitizeLocalTimeshiftStartError(error: unknown): Error {
    if (
        error instanceof Error &&
        (error.message.startsWith('Local timeshift') ||
            error.message.startsWith('FFmpeg') ||
            error.message.startsWith('Invalid local timeshift'))
    ) {
        return error;
    }
    return new Error('Could not start local timeshift');
}
