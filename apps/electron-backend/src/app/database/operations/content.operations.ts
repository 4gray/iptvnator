import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    checkpointOperation,
    chunkValues,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';

function escapeLikePattern(term: string): string {
    return term.replace(/[%_\\]/g, '\\$&');
}

function buildLikePatterns(term: string): string[] {
    const variants = new Set<string>();
    const titleCase =
        term.length > 0
            ? term.charAt(0).toLocaleUpperCase() +
              term.slice(1).toLocaleLowerCase()
            : term;

    variants.add(term);
    variants.add(term.toLocaleLowerCase());
    variants.add(term.toLocaleUpperCase());
    variants.add(titleCase);

    return [...variants].map((value) => `%${escapeLikePattern(value)}%`);
}

export type GlobalRecentlyAddedKind = 'all' | 'vod' | 'series';

function getRecentlyAddedContentTypes(
    kind: GlobalRecentlyAddedKind
): Array<'movie' | 'series'> {
    if (kind === 'vod') {
        return ['movie'];
    }

    if (kind === 'series') {
        return ['series'];
    }

    return ['movie', 'series'];
}

function selectContentFields() {
    return {
        id: schema.content.id,
        category_id: schema.content.categoryId,
        title: schema.content.title,
        rating: schema.content.rating,
        added: schema.content.added,
        poster_url: schema.content.posterUrl,
        epg_channel_id: schema.content.epgChannelId,
        tv_archive: schema.content.tvArchive,
        tv_archive_duration: schema.content.tvArchiveDuration,
        direct_source: schema.content.directSource,
        xtream_id: schema.content.xtreamId,
        type: schema.content.type,
    };
}

export async function hasContent(
    db: AppDatabase,
    playlistId: string,
    type: 'live' | 'movie' | 'series'
): Promise<boolean> {
    const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.content.type, type)
            )
        );

    return result[0].count > 0;
}

export async function getContent(
    db: AppDatabase,
    playlistId: string,
    type: 'live' | 'movie' | 'series'
) {
    const baseQuery = db
        .select(selectContentFields())
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.content.type, type)
            )
        );

    return type === 'live'
        ? baseQuery.orderBy(asc(schema.content.id))
        : baseQuery.orderBy(desc(schema.content.added));
}

export type RecentlyAddedPlaylistType =
    | 'xtream'
    | 'stalker'
    | 'm3u-file'
    | 'm3u-text'
    | 'm3u-url';

export async function getGlobalRecentlyAdded(
    db: AppDatabase,
    kind: GlobalRecentlyAddedKind = 'all',
    limit = 200,
    playlistType?: RecentlyAddedPlaylistType
) {
    const contentTypes = getRecentlyAddedContentTypes(kind);
    const normalizedLimit = Number.isFinite(limit)
        ? Math.min(Math.max(Math.trunc(limit), 1), 200)
        : 200;

    const whereConditions = [
        inArray(schema.content.type, contentTypes),
        eq(schema.categories.hidden, false),
        sql`${schema.content.added} <> ''`,
    ];

    if (playlistType) {
        whereConditions.push(eq(schema.playlists.type, playlistType));
    }

    // Sort by `added` directly. Xtream stores Unix-epoch timestamps as
    // 10-digit numeric strings (since 2001-09-09), so lexicographic sort
    // is equivalent to numeric sort. Wrapping the column in CAST(... AS
    // INTEGER) — as we used to — blocks SQLite from using
    // idx_content_type_added and forces a full table scan + sort on the
    // entire content table (often 100k+ rows) on every dashboard load.
    return db
        .select({
            ...selectContentFields(),
            added_at: schema.content.added,
            playlist_id: schema.playlists.id,
            playlist_name: schema.playlists.name,
        })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .innerJoin(
            schema.playlists,
            eq(schema.categories.playlistId, schema.playlists.id)
        )
        .where(and(...whereConditions))
        .orderBy(desc(schema.content.added))
        .limit(normalizedLimit);
}

type XtreamContentValue = {
    categoryId: number;
    title: string;
    rating: string;
    added: string;
    posterUrl: string;
    epgChannelId?: string | null;
    tvArchive?: number | null;
    tvArchiveDuration?: number | null;
    directSource?: string | null;
    xtreamId: number;
    type: 'live' | 'movie' | 'series';
};

type XtreamContentSource = Record<string, unknown> & {
    category_id?: string | number;
    rating?: string | number;
    rating_imdb?: string;
    last_modified?: string;
    added?: string;
    stream_icon?: string;
        poster?: string;
        cover?: string;
        name?: string;
        title?: string;
        epg_channel_id?: string;
        tv_archive?: string | number;
        tv_archive_duration?: string | number;
        direct_source?: string;
        series_id?: string | number;
        stream_id?: string | number;
};

function toXtreamContentValue(
    stream: Record<string, unknown>,
    type: 'live' | 'movie' | 'series',
    categoryMap: Map<number, number>
): XtreamContentValue | null {
    const source = stream as XtreamContentSource;
    const streamCategoryId =
        type === 'series'
            ? parseInt(String(source.category_id || '0'))
            : parseInt(String(source.category_id));

    const categoryId = categoryMap.get(streamCategoryId);
    if (!categoryId) {
        return null;
    }

    const title =
        type === 'series'
            ? source.title ||
              source.name ||
              `Unknown Series ${source.series_id ?? ''}`.trim()
            : source.name ||
              source.title ||
              `Unknown Stream ${source.stream_id ?? ''}`.trim();

    return {
        categoryId,
        title,
        rating: String(source.rating || source.rating_imdb || ''),
        added:
            type === 'series'
                ? String(source.last_modified || '')
                : String(source.added || ''),
        posterUrl: String(
            source.stream_icon || source.poster || source.cover || ''
        ),
        epgChannelId:
            type === 'live'
                ? String(source.epg_channel_id ?? '').trim() || null
                : null,
        tvArchive:
            type === 'live'
                ? Number.parseInt(String(source.tv_archive ?? '0'), 10) || 0
                : null,
        tvArchiveDuration:
            type === 'live'
                ? Number.parseInt(
                      String(source.tv_archive_duration ?? '0'),
                      10
                  ) || 0
                : null,
        directSource:
            type === 'live'
                ? String(source.direct_source ?? '').trim() || null
                : null,
        xtreamId:
            type === 'series'
                ? parseInt(String(source.series_id || '0'))
                : parseInt(String(source.stream_id || '0')),
        type,
    };
}

export async function saveContent(
    db: AppDatabase,
    playlistId: string,
    streams: Array<Record<string, unknown>>,
    type: 'live' | 'movie' | 'series',
    control?: OperationControl
): Promise<{ success: boolean; count: number }> {
    const dbType =
        type === 'series' ? 'series' : type === 'movie' ? 'movies' : 'live';

    const existingContent = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, dbType),
                eq(schema.content.type, type)
            )
        );

    if ((existingContent[0]?.count ?? 0) > 0) {
        return { success: true, count: existingContent[0].count };
    }

    const categories = await db
        .select({
            id: schema.categories.id,
            xtreamId: schema.categories.xtreamId,
        })
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, dbType)
            )
        );

    const categoryMap = new Map(categories.map((category) => [
        category.xtreamId,
        category.id,
    ]));

    const values = streams
        .map((stream) => toXtreamContentValue(stream, type, categoryMap))
        .filter((value): value is XtreamContentValue => value !== null);

    const total = values.length;
    const chunkSize = 100;
    let totalInserted = 0;

    for (let index = 0; index < values.length; index += chunkSize) {
        await checkpointOperation(control);
        const chunk = values.slice(index, index + chunkSize);
        await db.transaction((tx) => {
            tx
                .insert(schema.content)
                .values(chunk)
                .onConflictDoNothing({
                    target: [
                        schema.content.categoryId,
                        schema.content.type,
                        schema.content.xtreamId,
                    ],
                })
                .run();
        });
        totalInserted += chunk.length;
        await reportOperationProgress(control, {
            phase: 'saving-content',
            current: totalInserted,
            total,
            increment: chunk.length,
        });
    }

    return { success: true, count: totalInserted };
}

export async function clearXtreamImportCache(
    db: AppDatabase,
    playlistId: string,
    type: 'live' | 'movie' | 'series'
): Promise<{ success: boolean }> {
    const dbType =
        type === 'series' ? 'series' : type === 'movie' ? 'movies' : 'live';

    const categoryRows = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.categories.type, dbType)
            )
        );

    const categoryIds = categoryRows.map((category) => category.id);
    if (categoryIds.length === 0) {
        return { success: true };
    }

    const contentRows = await db
        .select({ id: schema.content.id })
        .from(schema.content)
        .where(inArray(schema.content.categoryId, categoryIds));

    for (const chunk of chunkValues(
        contentRows.map((row) => row.id),
        100
    )) {
        await db.transaction((tx) => {
            tx
                .delete(schema.content)
                .where(inArray(schema.content.id, chunk))
                .run();
        });
    }

    for (const chunk of chunkValues(categoryIds, 100)) {
        await db.transaction((tx) => {
            tx
                .delete(schema.categories)
                .where(inArray(schema.categories.id, chunk))
                .run();
        });
    }

    return { success: true };
}

export async function getContentByXtreamId(
    db: AppDatabase,
    xtreamId: number,
    playlistId: string,
    contentType?: 'live' | 'movie' | 'series'
) {
    const conditions = [
        eq(schema.content.xtreamId, xtreamId),
        eq(schema.categories.playlistId, playlistId),
    ];

    if (contentType) {
        conditions.push(eq(schema.content.type, contentType));
    }

    const result = await db
        .select(selectContentFields())
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(and(...conditions))
        .limit(1);

    return result[0] || null;
}

export async function searchContent(
    db: AppDatabase,
    playlistId: string,
    searchTerm: string,
    types: string[],
    excludeHidden = false
) {
    if (!types || types.length === 0) {
        return [];
    }

    const searchTermLower = searchTerm.toLocaleLowerCase();
    const likePatterns = buildLikePatterns(searchTerm);
    const likeConditions = likePatterns.map(
        (pattern) => sql`${schema.content.title} LIKE ${pattern} ESCAPE '\\'`
    );

    const conditions = [
        eq(schema.categories.playlistId, playlistId),
        inArray(schema.content.type, types as Array<'live' | 'movie' | 'series'>),
        or(...likeConditions),
    ];

    if (excludeHidden) {
        conditions.push(eq(schema.categories.hidden, false));
    }

    const candidates = await db
        .select(selectContentFields())
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(and(...conditions))
        .limit(200);

    return candidates
        .filter((item) =>
            item.title?.toLocaleLowerCase().includes(searchTermLower)
        )
        .slice(0, 50);
}

export async function globalSearch(
    db: AppDatabase,
    searchTerm: string,
    types: string[],
    excludeHidden = false
) {
    if (!types || types.length === 0) {
        return [];
    }

    const searchTermLower = searchTerm.toLocaleLowerCase();
    const likePatterns = buildLikePatterns(searchTerm);
    const likeConditions = likePatterns.map(
        (pattern) => sql`${schema.content.title} LIKE ${pattern} ESCAPE '\\'`
    );

    const conditions = [
        inArray(schema.content.type, types as Array<'live' | 'movie' | 'series'>),
        or(...likeConditions),
    ];

    if (excludeHidden) {
        conditions.push(eq(schema.categories.hidden, false));
    }

    const candidates = await db
        .select({
            ...selectContentFields(),
            playlist_id: schema.categories.playlistId,
            playlist_name: schema.playlists.name,
        })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .innerJoin(
            schema.playlists,
            eq(schema.categories.playlistId, schema.playlists.id)
        )
        .where(and(...conditions))
        .orderBy(schema.content.title)
        .limit(200);

    return candidates
        .filter((item) =>
            item.title?.toLocaleLowerCase().includes(searchTermLower)
        )
        .slice(0, 50);
}
