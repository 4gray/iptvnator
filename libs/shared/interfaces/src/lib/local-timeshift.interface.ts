import { ResolvedPortalPlayback } from './portal-playback.interface';

export type LocalTimeshiftSessionStatus =
    | 'starting'
    | 'ready'
    | 'error'
    | 'closed';

export interface LocalTimeshiftSupport {
    supported: boolean;
    engine?: 'ffmpeg';
    reason?: string;
}

export interface StartLocalTimeshiftRequest {
    playback: ResolvedPortalPlayback;
    maxDurationMinutes: number;
    bufferDirectory?: string;
}

/**
 * Renderer-safe snapshot of a local Timeshift session. Source credentials and
 * filesystem paths intentionally stay in the Electron main process.
 */
export interface LocalTimeshiftSession {
    id: string;
    playbackUrl: string;
    status: LocalTimeshiftSessionStatus;
    maxDurationSeconds: number;
    bufferedDurationSeconds: number;
    bytesUsed: number;
    startedAt: string;
    updatedAt: string;
    error?: string;
}
