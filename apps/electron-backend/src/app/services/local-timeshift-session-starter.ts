import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { buildLocalTimeshiftFfmpegArgs } from './local-timeshift-ffmpeg';
import {
    throwIfTimeshiftAborted,
    waitForPlayableTimeshiftPlaylist,
} from './local-timeshift-playlist';
import {
    observeLocalTimeshiftProcess,
    waitForLocalTimeshiftProcessSpawn,
} from './local-timeshift-process';
import {
    createActiveTimeshiftSession,
    type ActiveLocalTimeshiftSession,
} from './local-timeshift-state';
import type {
    CreateTimeshiftHttpServer,
    LocalTimeshiftSessionSnapshot,
    SpawnTimeshiftProcess,
    StartLocalTimeshiftSessionRequest,
} from './local-timeshift.types';

export interface LocalTimeshiftSessionStarterDeps {
    ffmpegCommand: string;
    spawnProcess: SpawnTimeshiftProcess;
    createHttpServer: CreateTimeshiftHttpServer;
    defaultBufferDirectory: () => string;
    startTimeoutMs: number;
    pollIntervalMs: number;
    registerSession(session: ActiveLocalTimeshiftSession): void;
    onUnexpectedExit(session: ActiveLocalTimeshiftSession, error: Error): void;
    toSnapshot(
        session: ActiveLocalTimeshiftSession
    ): Promise<LocalTimeshiftSessionSnapshot>;
}

/**
 * Owns the start orchestration of a single timeshift session: workspace and
 * loopback-server setup, FFmpeg spawn, waiting for a playable playlist, and
 * the initial snapshot. On failure the partially created `directory`/`session`
 * remain exposed so the owning service can clean them up.
 */
export class LocalTimeshiftSessionStarter {
    directory?: string;
    session?: ActiveLocalTimeshiftSession;

    constructor(private readonly deps: LocalTimeshiftSessionStarterDeps) {}

    async start(
        request: StartLocalTimeshiftSessionRequest,
        signal: AbortSignal
    ): Promise<LocalTimeshiftSessionSnapshot> {
        const root =
            request.bufferDirectory ?? this.deps.defaultBufferDirectory();
        await mkdir(root, { recursive: true });
        throwIfTimeshiftAborted(signal);
        this.directory = await mkdtemp(join(root, 'session-'));
        const token = randomBytes(24).toString('base64url');
        const http = await this.deps.createHttpServer(this.directory, token);
        const session = createActiveTimeshiftSession(
            request,
            this.directory,
            http
        );
        this.session = session;
        this.deps.registerSession(session);
        throwIfTimeshiftAborted(signal);

        const args = buildLocalTimeshiftFfmpegArgs({
            sourceUrl: request.sourceUrl,
            requestHeaders: request.requestHeaders,
            maxDurationMinutes: request.maxDurationMinutes,
            outputDirectory: this.directory,
        });
        const child = this.deps.spawnProcess(this.deps.ffmpegCommand, args, {
            shell: false,
            detached: false,
            stdio: 'ignore',
            windowsHide: true,
        });
        session.process = child;
        observeLocalTimeshiftProcess(session, child, (error) => {
            this.deps.onUnexpectedExit(session, error);
        });
        await waitForLocalTimeshiftProcessSpawn(child, session.processFailure);
        await waitForPlayableTimeshiftPlaylist(
            session,
            signal,
            this.deps.startTimeoutMs,
            this.deps.pollIntervalMs
        );
        throwIfTimeshiftAborted(signal);
        const snapshot = await this.deps.toSnapshot(session);
        if (session.processEnded) throw await session.processFailure;
        throwIfTimeshiftAborted(signal);
        session.ready = true;
        return snapshot;
    }
}
