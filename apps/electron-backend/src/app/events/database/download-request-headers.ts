import { XTREAM_CLIENT_USER_AGENT } from '@iptvnator/shared/interfaces';
import { eq } from 'drizzle-orm';
import * as schema from '../../database/schema';
import type { DownloadsDatabase } from './download-task';

const STORED_HEADER_ALLOWLIST = ['User-Agent', 'Origin', 'Referer'] as const;

export function parseStoredHeaders(
    value: string | null | undefined
): Record<string, string> | undefined {
    if (!value) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return undefined;
        }

        // Re-apply the write-time allowlist so a tampered or imported
        // database row cannot smuggle arbitrary headers into requests.
        const entries = parsed as Record<string, unknown>;
        const headers = STORED_HEADER_ALLOWLIST.reduce<Record<string, string>>(
            (acc, key) => {
                const headerValue = entries[key];
                if (typeof headerValue === 'string') {
                    acc[key] = headerValue;
                }
                return acc;
            },
            {}
        );
        return Object.keys(headers).length > 0 ? headers : undefined;
    } catch {
        return undefined;
    }
}

export async function resolveStoredDownloadHeaders(
    db: DownloadsDatabase,
    item: { playlistId: string; requestHeaders: string | null | undefined }
): Promise<Record<string, string> | undefined> {
    const headers = parseStoredHeaders(item.requestHeaders);
    if (headers?.['User-Agent']?.trim()) {
        return headers;
    }

    const playlists = await db
        .select({ type: schema.playlists.type })
        .from(schema.playlists)
        .where(eq(schema.playlists.id, item.playlistId))
        .limit(1);
    if (playlists[0]?.type !== 'xtream') {
        return headers;
    }

    return {
        ...headers,
        'User-Agent': XTREAM_CLIENT_USER_AGENT,
    };
}
