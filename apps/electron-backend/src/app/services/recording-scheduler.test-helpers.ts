import type {
    PersistedRecordingItem,
    PersistedRecordingUpdate,
    RecordingStatus,
    ScheduleRecordingRequest,
} from '@iptvnator/shared/interfaces';
import type { RecordingRepository } from './recording-repository';

export const RECORDING_TEST_NOW = new Date('2026-07-14T12:00:00.000Z');

export function recordingTestRequest(
    overrides: Partial<ScheduleRecordingRequest> = {}
): ScheduleRecordingRequest {
    return {
        playlistId: 'playlist-1',
        sourceType: 'xtream',
        channelId: 'channel-1',
        channelName: 'News',
        title: 'Evening News',
        scheduledStartAt: '2026-07-14T12:01:00.000Z',
        scheduledEndAt: '2026-07-14T12:02:00.000Z',
        playback: {
            streamUrl: 'https://example.com/live/news.m3u8',
            title: 'News',
        },
        ...overrides,
    };
}

export function recordingTestItem(
    id: string,
    status: RecordingStatus,
    overrides: Partial<PersistedRecordingItem> = {}
): PersistedRecordingItem {
    const scheduled = recordingTestRequest();
    return {
        id,
        playlistId: scheduled.playlistId,
        sourceType: scheduled.sourceType,
        channelId: scheduled.channelId,
        channelName: scheduled.channelName,
        title: scheduled.title,
        streamUrl: scheduled.playback.streamUrl,
        scheduledStartAt: scheduled.scheduledStartAt,
        scheduledEndAt: scheduled.scheduledEndAt,
        paddingBeforeSeconds: 0,
        paddingAfterSeconds: 0,
        status,
        ...overrides,
    };
}

export class MemoryRecordingRepository implements RecordingRepository {
    readonly records = new Map<string, PersistedRecordingItem>();

    constructor(initial: PersistedRecordingItem[] = []) {
        initial.forEach((recording) =>
            this.records.set(recording.id, recording)
        );
    }

    async create(
        id: string,
        scheduled: ScheduleRecordingRequest
    ): Promise<PersistedRecordingItem> {
        const recording: PersistedRecordingItem = {
            id,
            playlistId: scheduled.playlistId,
            sourceType: scheduled.sourceType,
            channelId: scheduled.channelId,
            channelName: scheduled.channelName,
            title: scheduled.title,
            description: scheduled.description,
            streamUrl: scheduled.playback.streamUrl,
            requestHeaders: scheduled.playback.headers,
            posterUrl: scheduled.posterUrl,
            epgProgramId: scheduled.epgProgramId,
            epgChannelId: scheduled.epgChannelId,
            scheduledStartAt: scheduled.scheduledStartAt,
            scheduledEndAt: scheduled.scheduledEndAt,
            paddingBeforeSeconds: scheduled.paddingBeforeSeconds ?? 0,
            paddingAfterSeconds: scheduled.paddingAfterSeconds ?? 0,
            status: 'scheduled',
        };
        this.records.set(id, recording);
        return recording;
    }

    async get(id: string): Promise<PersistedRecordingItem | null> {
        return this.records.get(id) ?? null;
    }

    async list(
        statuses?: RecordingStatus[]
    ): Promise<PersistedRecordingItem[]> {
        const recordings = [...this.records.values()];
        return statuses
            ? recordings.filter((recording) =>
                  statuses.includes(recording.status)
              )
            : recordings;
    }

    async update(
        id: string,
        update: PersistedRecordingUpdate
    ): Promise<PersistedRecordingItem | null> {
        const recording = this.records.get(id);
        if (!recording) return null;
        const updated = { ...recording, ...update };
        this.records.set(id, updated);
        return updated;
    }

    async delete(id: string): Promise<{ success: boolean }> {
        return { success: this.records.delete(id) };
    }
}
