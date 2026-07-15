import { desc, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type {
    PersistedRecordingItem,
    PersistedRecordingUpdate,
    RecordingStatus,
    ScheduleRecordingRequest,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { buildRecordingRequestHeaders } from '../../services/recording-http-headers';

function serializeRequestHeaders(
    request: ScheduleRecordingRequest
): string | null {
    const headers = buildRecordingRequestHeaders(request);
    return Object.keys(headers).length > 0 ? JSON.stringify(headers) : null;
}

function parseRequestHeaders(
    value: string | null
): Record<string, string> | null {
    if (!value) {
        return null;
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return Object.fromEntries(
            Object.entries(parsed).filter(
                (entry): entry is [string, string] =>
                    typeof entry[1] === 'string'
            )
        );
    } catch {
        return null;
    }
}

function toRecordingItem(
    row: typeof schema.recordings.$inferSelect
): PersistedRecordingItem {
    return {
        ...row,
        requestHeaders: parseRequestHeaders(row.requestHeaders),
    };
}

export async function createRecording(
    db: AppDatabase,
    id: string,
    request: ScheduleRecordingRequest
): Promise<PersistedRecordingItem> {
    await db.insert(schema.recordings).values({
        id,
        playlistId: request.playlistId,
        sourceType: request.sourceType,
        channelId: request.channelId,
        channelName: request.channelName,
        title: request.title,
        description: request.description,
        streamUrl: request.playback.streamUrl,
        requestHeaders: serializeRequestHeaders(request),
        posterUrl: request.posterUrl ?? request.playback.thumbnail,
        epgProgramId: request.epgProgramId,
        epgChannelId: request.epgChannelId,
        scheduledStartAt: request.scheduledStartAt,
        scheduledEndAt: request.scheduledEndAt,
        paddingBeforeSeconds: request.paddingBeforeSeconds ?? 0,
        paddingAfterSeconds: request.paddingAfterSeconds ?? 0,
        status: 'scheduled',
    });

    const recording = await getRecording(db, id);
    if (!recording) {
        throw new Error(`Recording "${id}" was not persisted`);
    }
    return recording;
}

export async function getRecording(
    db: AppDatabase,
    id: string
): Promise<PersistedRecordingItem | null> {
    const rows = await db
        .select()
        .from(schema.recordings)
        .where(eq(schema.recordings.id, id))
        .limit(1);
    return rows[0] ? toRecordingItem(rows[0]) : null;
}

export async function listRecordings(
    db: AppDatabase,
    statuses?: RecordingStatus[]
): Promise<PersistedRecordingItem[]> {
    const query = db.select().from(schema.recordings);
    const rows = statuses?.length
        ? await query
              .where(inArray(schema.recordings.status, statuses))
              .orderBy(desc(schema.recordings.scheduledStartAt))
        : await query.orderBy(desc(schema.recordings.scheduledStartAt));
    return rows.map(toRecordingItem);
}

export async function updateRecording(
    db: AppDatabase,
    id: string,
    update: PersistedRecordingUpdate
): Promise<PersistedRecordingItem | null> {
    const { requestHeaders, ...columns } = update;
    await db
        .update(schema.recordings)
        .set({
            ...columns,
            ...(requestHeaders !== undefined
                ? {
                      requestHeaders:
                          requestHeaders === null
                              ? null
                              : JSON.stringify(requestHeaders),
                  }
                : {}),
            updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.recordings.id, id));
    return getRecording(db, id);
}

export async function deleteRecording(
    db: AppDatabase,
    id: string
): Promise<{ success: boolean }> {
    const result = await db
        .delete(schema.recordings)
        .where(eq(schema.recordings.id, id));
    return { success: result.changes > 0 };
}
