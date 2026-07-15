import { ResolvedPortalPlayback } from './portal-playback.interface';

export const RECORDING_STATUSES = [
    'scheduled',
    'recording',
    'completed',
    'failed',
    'canceled',
    'missed',
    'interrupted',
] as const;

export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

export type RecordingSourceType = 'xtream' | 'stalker' | 'm3u';

export interface RecordingItem {
    id: string;
    playlistId: string;
    sourceType: RecordingSourceType;
    channelId: string;
    channelName: string;
    title: string;
    description?: string | null;
    posterUrl?: string | null;
    epgProgramId?: number | null;
    epgChannelId?: string | null;
    scheduledStartAt: string;
    scheduledEndAt: string;
    paddingBeforeSeconds: number;
    paddingAfterSeconds: number;
    status: RecordingStatus;
    fileName?: string | null;
    fileAvailable?: boolean;
    bytesRecorded?: number | null;
    errorMessage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
}

/** Main-process-only recording data. Never return this shape to the renderer. */
export interface PersistedRecordingItem extends RecordingItem {
    filePath?: string | null;
    streamUrl: string | null;
    requestHeaders?: Record<string, string> | null;
    recordingDirectory?: string | null;
}

export interface ScheduleRecordingRequest {
    playlistId: string;
    sourceType: RecordingSourceType;
    channelId: string;
    channelName: string;
    title: string;
    description?: string;
    playback: ResolvedPortalPlayback;
    posterUrl?: string;
    epgProgramId?: number;
    epgChannelId?: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    paddingBeforeSeconds?: number;
    paddingAfterSeconds?: number;
}

export interface RecordingActionResult {
    success: boolean;
    error?: string;
}

export interface RecordingSupport {
    supported: boolean;
    reason?: string;
}

export type RecordingUpdate = Partial<
    Pick<
        RecordingItem,
        | 'status'
        | 'fileName'
        | 'bytesRecorded'
        | 'errorMessage'
        | 'startedAt'
        | 'completedAt'
    >
>;

export type PersistedRecordingUpdate = RecordingUpdate &
    Partial<
        Pick<
            PersistedRecordingItem,
            'streamUrl' | 'requestHeaders' | 'recordingDirectory' | 'filePath'
        >
    >;

export interface ScheduleRecordingResult extends RecordingActionResult {
    recording?: RecordingItem;
}

export function isTerminalRecordingStatus(status: RecordingStatus): boolean {
    return !['scheduled', 'recording'].includes(status);
}
