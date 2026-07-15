import type {
    PersistedRecordingItem,
    PersistedRecordingUpdate,
    RecordingItem,
    ScheduleRecordingRequest,
    ScheduleRecordingResult,
} from '@iptvnator/shared/interfaces';
import { existsSync } from 'node:fs';

const MAX_PADDING_SECONDS = 60 * 60;
const ALLOWED_STREAM_PROTOCOLS = new Set([
    'http:',
    'https:',
    'rtmp:',
    'rtmps:',
    'rtsp:',
    'rtp:',
    'udp:',
]);
const ALLOWED_SOURCE_TYPES = new Set(['m3u', 'stalker', 'xtream']);

export function validateScheduleRecordingRequest(
    request: ScheduleRecordingRequest,
    nowMs: number
): string | null {
    if (
        !request.playlistId?.trim() ||
        !request.channelId?.trim() ||
        !request.channelName?.trim() ||
        !request.title?.trim() ||
        !request.playback?.title?.trim() ||
        !request.playback?.streamUrl?.trim()
    ) {
        return 'Playlist, channel, title, and stream URL are required';
    }
    if (!ALLOWED_SOURCE_TYPES.has(request.sourceType)) {
        return 'Recording source type is not supported';
    }
    if (!isAllowedStreamUrl(request.playback.streamUrl)) {
        return 'Recording stream URL must use a supported network protocol';
    }

    const start = Date.parse(request.scheduledStartAt);
    const end = Date.parse(request.scheduledEndAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return 'Recording end time must be after its start time';
    }

    const before = request.paddingBeforeSeconds ?? 0;
    const after = request.paddingAfterSeconds ?? 0;
    if (
        !Number.isInteger(before) ||
        !Number.isInteger(after) ||
        before < 0 ||
        after < 0 ||
        before > MAX_PADDING_SECONDS ||
        after > MAX_PADDING_SECONDS
    ) {
        return 'Recording padding must be between 0 and 3600 seconds';
    }
    if (end + after * 1000 <= nowMs) {
        return 'Recording window has already elapsed';
    }
    return null;
}

export function normalizeScheduleRecordingRequest(
    request: ScheduleRecordingRequest
): ScheduleRecordingRequest {
    return {
        ...request,
        playlistId: request.playlistId.trim(),
        channelId: request.channelId.trim(),
        channelName: request.channelName.trim(),
        title: request.title.trim(),
        scheduledStartAt: new Date(request.scheduledStartAt).toISOString(),
        scheduledEndAt: new Date(request.scheduledEndAt).toISOString(),
        paddingBeforeSeconds: request.paddingBeforeSeconds ?? 0,
        paddingAfterSeconds: request.paddingAfterSeconds ?? 0,
        playback: {
            ...request.playback,
            title: request.playback.title.trim(),
            streamUrl: request.playback.streamUrl.trim(),
        },
    };
}

export function recordingScheduleKey(
    request: ScheduleRecordingRequest
): string {
    return [
        'schedule',
        request.playlistId,
        request.channelId,
        request.scheduledStartAt,
        request.scheduledEndAt,
    ].join(':');
}

export function playlistUnavailableResult(): ScheduleRecordingResult {
    return {
        success: false,
        error: 'The playlist is being deleted or is no longer available',
    };
}

export function effectiveRecordingStart(
    recording: PersistedRecordingItem
): number {
    return (
        Date.parse(recording.scheduledStartAt) -
        recording.paddingBeforeSeconds * 1000
    );
}

export function effectiveRecordingEnd(
    recording: PersistedRecordingItem
): number {
    return (
        Date.parse(recording.scheduledEndAt) +
        recording.paddingAfterSeconds * 1000
    );
}

export function playbackSecretsCleared(): PersistedRecordingUpdate {
    return {
        streamUrl: null,
        requestHeaders: null,
        recordingDirectory: null,
    };
}

export function recordingErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function toPublicRecordingItem(
    recording: PersistedRecordingItem
): RecordingItem {
    return {
        id: recording.id,
        playlistId: recording.playlistId,
        sourceType: recording.sourceType,
        channelId: recording.channelId,
        channelName: recording.channelName,
        title: recording.title,
        description: recording.description,
        posterUrl: recording.posterUrl,
        epgProgramId: recording.epgProgramId,
        epgChannelId: recording.epgChannelId,
        scheduledStartAt: recording.scheduledStartAt,
        scheduledEndAt: recording.scheduledEndAt,
        paddingBeforeSeconds: recording.paddingBeforeSeconds,
        paddingAfterSeconds: recording.paddingAfterSeconds,
        status: recording.status,
        fileName: recording.fileName,
        fileAvailable: Boolean(
            recording.filePath && existsSync(recording.filePath)
        ),
        bytesRecorded: recording.bytesRecorded,
        errorMessage: recording.errorMessage,
        startedAt: recording.startedAt,
        completedAt: recording.completedAt,
        createdAt: recording.createdAt,
        updatedAt: recording.updatedAt,
    };
}

function isAllowedStreamUrl(value: string): boolean {
    try {
        return ALLOWED_STREAM_PROTOCOLS.has(
            new URL(value).protocol.toLowerCase()
        );
    } catch {
        return false;
    }
}
