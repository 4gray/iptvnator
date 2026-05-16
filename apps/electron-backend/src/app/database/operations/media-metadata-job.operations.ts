import { eq } from 'drizzle-orm';
import * as schema from 'database-schema';
import type {
    MediaStreamMetadata,
    SourceVpnRequestContext,
} from 'shared-interfaces';
import type { AppDatabase } from '../database.types';

export type MediaMetadataJobContentType = 'live' | 'movie' | 'episode';

export interface PersistedMediaMetadataJob {
    jobKey: string;
    playlistId: string;
    contentType: MediaMetadataJobContentType;
    xtreamId: number;
    seriesXtreamId?: number | null;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    url: string;
    headers?: Record<string, string>;
    staticMetadata?: MediaStreamMetadata | null;
    sourceVpn?: SourceVpnRequestContext;
    runAfterWindowClose: boolean;
}

export interface PersistedMediaMetadataSeriesDiscoveryJob {
    jobKey: string;
    playlistId: string;
    serverUrl: string;
    username: string;
    password: string;
    seriesXtreamId: number;
    headers?: Record<string, string>;
    sourceVpn?: SourceVpnRequestContext;
    runAfterWindowClose: boolean;
}

function parseJson<T>(value: string | null | undefined): T | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function serializeJson(value: unknown): string | null {
    return value === undefined || value === null ? null : JSON.stringify(value);
}

function mapRow(
    row: typeof schema.mediaMetadataJobs.$inferSelect
): PersistedMediaMetadataJob {
    return {
        jobKey: row.jobKey,
        playlistId: row.playlistId,
        contentType: row.contentType,
        xtreamId: row.xtreamId,
        seriesXtreamId: row.seriesXtreamId,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        url: row.url,
        headers: parseJson<Record<string, string>>(row.headers ?? null),
        staticMetadata:
            parseJson<MediaStreamMetadata>(row.staticMetadata ?? null) ?? null,
        sourceVpn: parseJson<SourceVpnRequestContext>(row.sourceVpn ?? null),
        runAfterWindowClose: Boolean(row.runAfterWindowClose),
    };
}

function mapSeriesDiscoveryRow(
    row: typeof schema.mediaMetadataSeriesDiscoveryJobs.$inferSelect
): PersistedMediaMetadataSeriesDiscoveryJob {
    return {
        jobKey: row.jobKey,
        playlistId: row.playlistId,
        serverUrl: row.serverUrl,
        username: row.username,
        password: row.password,
        seriesXtreamId: row.seriesXtreamId,
        headers: parseJson<Record<string, string>>(row.headers ?? null),
        sourceVpn: parseJson<SourceVpnRequestContext>(row.sourceVpn ?? null),
        runAfterWindowClose: Boolean(row.runAfterWindowClose),
    };
}

export async function upsertMediaMetadataJobs(
    db: AppDatabase,
    jobs: readonly PersistedMediaMetadataJob[]
): Promise<{ success: boolean; count: number }> {
    if (jobs.length === 0) {
        return { success: true, count: 0 };
    }

    const now = Date.now();
    await db.transaction((tx) => {
        for (const job of jobs) {
            const row = {
                jobKey: job.jobKey,
                playlistId: job.playlistId,
                contentType: job.contentType,
                xtreamId: job.xtreamId,
                seriesXtreamId: job.seriesXtreamId ?? null,
                seasonNumber: job.seasonNumber ?? null,
                episodeNumber: job.episodeNumber ?? null,
                url: job.url,
                headers: serializeJson(job.headers),
                staticMetadata: serializeJson(job.staticMetadata),
                sourceVpn: serializeJson(job.sourceVpn),
                runAfterWindowClose: job.runAfterWindowClose,
                createdAt: now,
                updatedAt: now,
            };

            tx.insert(schema.mediaMetadataJobs)
                .values(row)
                .onConflictDoUpdate({
                    target: schema.mediaMetadataJobs.jobKey,
                    set: {
                        playlistId: row.playlistId,
                        contentType: row.contentType,
                        xtreamId: row.xtreamId,
                        seriesXtreamId: row.seriesXtreamId,
                        seasonNumber: row.seasonNumber,
                        episodeNumber: row.episodeNumber,
                        url: row.url,
                        headers: row.headers,
                        staticMetadata: row.staticMetadata,
                        sourceVpn: row.sourceVpn,
                        runAfterWindowClose: job.runAfterWindowClose,
                        updatedAt: now,
                    },
                })
                .run();
        }
    });

    return { success: true, count: jobs.length };
}

export async function getPendingMediaMetadataJobs(
    db: AppDatabase
): Promise<PersistedMediaMetadataJob[]> {
    const rows = await db.select().from(schema.mediaMetadataJobs);
    return rows.map((row) => mapRow(row));
}

export async function upsertMediaMetadataSeriesDiscoveryJobs(
    db: AppDatabase,
    jobs: readonly PersistedMediaMetadataSeriesDiscoveryJob[]
): Promise<{ success: boolean; count: number }> {
    if (jobs.length === 0) {
        return { success: true, count: 0 };
    }

    const now = Date.now();
    await db.transaction((tx) => {
        for (const job of jobs) {
            const row = {
                jobKey: job.jobKey,
                playlistId: job.playlistId,
                serverUrl: job.serverUrl,
                username: job.username,
                password: job.password,
                seriesXtreamId: job.seriesXtreamId,
                headers: serializeJson(job.headers),
                sourceVpn: serializeJson(job.sourceVpn),
                runAfterWindowClose: job.runAfterWindowClose,
                createdAt: now,
                updatedAt: now,
            };

            tx.insert(schema.mediaMetadataSeriesDiscoveryJobs)
                .values(row)
                .onConflictDoUpdate({
                    target: schema.mediaMetadataSeriesDiscoveryJobs.jobKey,
                    set: {
                        playlistId: row.playlistId,
                        serverUrl: row.serverUrl,
                        username: row.username,
                        password: row.password,
                        seriesXtreamId: row.seriesXtreamId,
                        headers: row.headers,
                        sourceVpn: row.sourceVpn,
                        runAfterWindowClose: row.runAfterWindowClose,
                        updatedAt: now,
                    },
                })
                .run();
        }
    });

    return { success: true, count: jobs.length };
}

export async function getPendingMediaMetadataSeriesDiscoveryJobs(
    db: AppDatabase
): Promise<PersistedMediaMetadataSeriesDiscoveryJob[]> {
    const rows = await db.select().from(schema.mediaMetadataSeriesDiscoveryJobs);
    return rows.map((row) => mapSeriesDiscoveryRow(row));
}

export async function deleteMediaMetadataJob(
    db: AppDatabase,
    jobKey: string
): Promise<{ success: boolean }> {
    if (!jobKey) {
        return { success: false };
    }

    await db
        .delete(schema.mediaMetadataJobs)
        .where(eq(schema.mediaMetadataJobs.jobKey, jobKey))
        .run();

    return { success: true };
}

export async function deleteMediaMetadataSeriesDiscoveryJob(
    db: AppDatabase,
    jobKey: string
): Promise<{ success: boolean }> {
    if (!jobKey) {
        return { success: false };
    }

    await db
        .delete(schema.mediaMetadataSeriesDiscoveryJobs)
        .where(eq(schema.mediaMetadataSeriesDiscoveryJobs.jobKey, jobKey))
        .run();

    return { success: true };
}

export async function clearMediaMetadataJobs(
    db: AppDatabase
): Promise<{ success: boolean }> {
    await db.delete(schema.mediaMetadataJobs).run();
    await db.delete(schema.mediaMetadataSeriesDiscoveryJobs).run();
    return { success: true };
}
