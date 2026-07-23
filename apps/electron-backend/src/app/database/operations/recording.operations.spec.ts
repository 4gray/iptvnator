import {
    createDbMock,
    mockDrizzle,
    mockDrizzleOrmModule,
    resetDrizzleMocks,
} from './operations.test-helpers';

jest.mock('drizzle-orm', () => mockDrizzleOrmModule());

import * as schema from '@iptvnator/shared/database/schema';
import type { ScheduleRecordingRequest } from '@iptvnator/shared/interfaces';
import {
    createRecording,
    listRecordings,
    updateRecording,
} from './recording.operations';

const request: ScheduleRecordingRequest = {
    playlistId: 'playlist-1',
    sourceType: 'xtream',
    channelId: '42',
    channelName: 'News',
    title: 'Evening News',
    scheduledStartAt: '2026-07-14T18:00:00.000Z',
    scheduledEndAt: '2026-07-14T19:00:00.000Z',
    playback: {
        streamUrl: 'https://example.com/live/42.m3u8',
        title: 'News',
        headers: { 'User-Agent': 'Explicit Agent', Accept: 'video/*' },
        userAgent: 'Fallback Agent',
        referer: 'https://example.com/player',
        origin: 'https://example.com',
    },
};

const row = {
    id: 'recording-1',
    playlistId: request.playlistId,
    sourceType: request.sourceType,
    channelId: request.channelId,
    channelName: request.channelName,
    title: request.title,
    description: null,
    streamUrl: request.playback.streamUrl,
    requestHeaders: JSON.stringify({ Accept: 'video/*' }),
    recordingDirectory: null,
    posterUrl: null,
    epgProgramId: null,
    epgChannelId: null,
    scheduledStartAt: request.scheduledStartAt,
    scheduledEndAt: request.scheduledEndAt,
    paddingBeforeSeconds: 0,
    paddingAfterSeconds: 0,
    status: 'scheduled' as const,
    fileName: null,
    filePath: null,
    bytesRecorded: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: null,
    updatedAt: null,
};

describe('recording.operations', () => {
    beforeEach(resetDrizzleMocks);

    it('persists the playback snapshot and merges explicit headers safely', async () => {
        const { db, insert, insertValues } = createDbMock([[row]]);

        await createRecording(db, row.id, request);

        expect(insert).toHaveBeenCalledWith(schema.recordings);
        expect(insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                id: row.id,
                playlistId: request.playlistId,
                streamUrl: request.playback.streamUrl,
                requestHeaders: JSON.stringify({
                    'User-Agent': 'Explicit Agent',
                    Accept: 'video/*',
                    Referer: 'https://example.com/player',
                    Origin: 'https://example.com',
                }),
                status: 'scheduled',
            })
        );
    });

    it('deduplicates fallback headers case-insensitively', async () => {
        const { db, insertValues } = createDbMock([[row]]);

        await createRecording(db, row.id, {
            ...request,
            playback: {
                ...request.playback,
                headers: {
                    'user-agent': 'Explicit lower-case agent',
                    REFERER: 'https://example.com/explicit',
                },
            },
        });

        expect(insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                requestHeaders: JSON.stringify({
                    'user-agent': 'Explicit lower-case agent',
                    REFERER: 'https://example.com/explicit',
                    Origin: 'https://example.com',
                }),
            })
        );
    });

    it('rejects control characters in persisted request headers', async () => {
        const { db } = createDbMock([[row]]);

        await expect(
            createRecording(db, row.id, {
                ...request,
                playback: {
                    ...request.playback,
                    headers: { Authorization: 'Bearer secret\r\ninjected' },
                },
            })
        ).rejects.toThrow('Invalid recording HTTP header');
    });

    it('parses valid header JSON and ignores malformed header JSON', async () => {
        const malformed = { ...row, id: 'recording-2', requestHeaders: '{' };
        const { db } = createDbMock([[row, malformed]]);

        await expect(listRecordings(db)).resolves.toEqual([
            expect.objectContaining({ requestHeaders: { Accept: 'video/*' } }),
            expect.objectContaining({
                id: 'recording-2',
                requestHeaders: null,
            }),
        ]);
    });

    it('filters active rows by status and orders newest first', async () => {
        const { db } = createDbMock([[row]]);

        await listRecordings(db, ['scheduled', 'recording']);

        expect(mockDrizzle.inArray).toHaveBeenCalledWith(
            schema.recordings.status,
            ['scheduled', 'recording']
        );
        expect(mockDrizzle.desc).toHaveBeenCalledWith(
            schema.recordings.scheduledStartAt
        );
    });

    it('stamps updates with the database clock', async () => {
        const { db, update, updateSet } = createDbMock([[row]]);

        await updateRecording(db, row.id, { status: 'recording' });

        expect(update).toHaveBeenCalledWith(schema.recordings);
        expect(updateSet).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'recording',
                updatedAt: expect.objectContaining({ kind: 'sql' }),
            })
        );
        expect(mockDrizzle.sql).toHaveBeenCalledWith(['CURRENT_TIMESTAMP']);
    });

    it('serializes updated request headers for the SQLite text column', async () => {
        const { db, updateSet } = createDbMock([[row]]);

        await updateRecording(db, row.id, {
            requestHeaders: { Authorization: 'Bearer secret' },
        });

        expect(updateSet).toHaveBeenCalledWith(
            expect.objectContaining({
                requestHeaders: JSON.stringify({
                    Authorization: 'Bearer secret',
                }),
            })
        );
    });
});
