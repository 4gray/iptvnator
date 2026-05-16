import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import * as schema from 'database-schema';
import {
    repairMojibakeText,
    type MediaStreamMetadata,
} from 'shared-interfaces';
import type { AppDatabase } from '../database.types';
import {
    checkpointOperation,
    chunkValues,
    type OperationControl,
    reportOperationProgress,
} from './operation-control';

const SEARCH_STOP_WORDS = new Set([
    'a',
    'al',
    'alla',
    'an',
    'and',
    'dei',
    'del',
    'della',
    'di',
    'e',
    'gli',
    'i',
    'il',
    'la',
    'le',
    'lo',
    'of',
    'the',
    'un',
    'una',
    'uno',
]);

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

function normalizeSearchText(term: string): string {
    return term
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/['’`]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLocaleLowerCase();
}

function buildSearchTokens(term: string): string[] {
    const rawTokens = normalizeSearchText(term).split(/\s+/).filter(Boolean);
    const meaningfulTokens = rawTokens.filter(
        (token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token)
    );

    return meaningfulTokens.length ? meaningfulTokens : rawTokens;
}

function titleMatchesSearchTokens(title: string | null, tokens: string[]) {
    const normalizedTitle = normalizeSearchText(title ?? '');
    return tokens.every((token) => normalizedTitle.includes(token));
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
        category_hidden: schema.categories.hidden,
        category_name: schema.categories.name,
        title: schema.content.title,
        rating: schema.content.rating,
        added: schema.content.added,
        poster_url: schema.content.posterUrl,
        epg_channel_id: schema.content.epgChannelId,
        tv_archive: schema.content.tvArchive,
        tv_archive_duration: schema.content.tvArchiveDuration,
        direct_source: schema.content.directSource,
        mediaMetadataRaw: schema.content.mediaMetadata,
        mediaMetadataUpdatedAt: schema.content.mediaMetadataUpdatedAt,
        xtream_id: schema.content.xtreamId,
        type: schema.content.type,
    };
}

type ContentRowWithRawMediaMetadata = {
    mediaMetadataRaw?: string | null;
    [key: string]: unknown;
};

type ContentRowWithParsedMediaMetadata<
    T extends ContentRowWithRawMediaMetadata,
> = Omit<T, 'mediaMetadataRaw'> & {
    audioLanguages?: string[];
    mediaMetadata?: MediaStreamMetadata;
    subtitleLanguages?: string[];
};

function parseMediaMetadata(
    value: string | null | undefined
): MediaStreamMetadata | undefined {
    if (!value) {
        return undefined;
    }

    try {
        const metadata = JSON.parse(value) as Partial<MediaStreamMetadata>;
        if (
            !metadata ||
            typeof metadata !== 'object' ||
            !Array.isArray(metadata.audioLanguages) ||
            !Array.isArray(metadata.audioCodecs) ||
            !Array.isArray(metadata.subtitleLanguages) ||
            !Array.isArray(metadata.subtitleCodecs)
        ) {
            return undefined;
        }

        return {
            available: Boolean(metadata.available),
            qualityLabel:
                typeof metadata.qualityLabel === 'string'
                    ? metadata.qualityLabel
                    : undefined,
            qualityLabels: Array.isArray(metadata.qualityLabels)
                ? metadata.qualityLabels.filter(
                      (item): item is string => typeof item === 'string'
                  )
                : undefined,
            width:
                typeof metadata.width === 'number' ? metadata.width : undefined,
            widths: Array.isArray(metadata.widths)
                ? metadata.widths.filter(
                      (item): item is number => typeof item === 'number'
                  )
                : undefined,
            height:
                typeof metadata.height === 'number'
                    ? metadata.height
                    : undefined,
            heights: Array.isArray(metadata.heights)
                ? metadata.heights.filter(
                      (item): item is number => typeof item === 'number'
                  )
                : undefined,
            videoCodec:
                typeof metadata.videoCodec === 'string'
                    ? metadata.videoCodec
                    : undefined,
            videoCodecs: Array.isArray(metadata.videoCodecs)
                ? metadata.videoCodecs.filter(
                      (item): item is string => typeof item === 'string'
                  )
                : undefined,
            audioLanguages: metadata.audioLanguages.filter(
                (item): item is string => typeof item === 'string'
            ),
            audioCodecs: metadata.audioCodecs.filter(
                (item): item is string => typeof item === 'string'
            ),
            subtitleLanguages: metadata.subtitleLanguages.filter(
                (item): item is string => typeof item === 'string'
            ),
            subtitleCodecs: metadata.subtitleCodecs.filter(
                (item): item is string => typeof item === 'string'
            ),
            source:
                metadata.source === 'xtream' ||
                metadata.source === 'ffprobe' ||
                metadata.source === 'derived'
                    ? metadata.source
                    : undefined,
            reason:
                typeof metadata.reason === 'string'
                    ? metadata.reason
                    : undefined,
        };
    } catch {
        return undefined;
    }
}

function attachParsedMediaMetadata<T extends ContentRowWithRawMediaMetadata>(
    row: T
): ContentRowWithParsedMediaMetadata<T> {
    const { mediaMetadataRaw, ...rest } = normalizeContentTextFields(row);
    const mediaMetadata = parseMediaMetadata(mediaMetadataRaw);
    if (!mediaMetadata) {
        return rest as ContentRowWithParsedMediaMetadata<T>;
    }

    return {
        ...rest,
        mediaMetadata,
        audioLanguages: mediaMetadata.audioLanguages,
        subtitleLanguages: mediaMetadata.subtitleLanguages,
    } as ContentRowWithParsedMediaMetadata<T>;
}

function normalizeContentTextFields<T extends ContentRowWithRawMediaMetadata>(
    row: T
): T {
    const normalized = { ...row } as Record<string, unknown>;
    for (const key of ['title', 'category_name', 'playlist_name']) {
        if (typeof normalized[key] === 'string') {
            normalized[key] = repairMojibakeText(normalized[key]);
        }
    }

    return normalized as T;
}

function attachParsedMediaMetadataToRows<
    T extends ContentRowWithRawMediaMetadata,
>(rows: T[]): Array<ContentRowWithParsedMediaMetadata<T>> {
    return rows.map((row) => attachParsedMediaMetadata(row));
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

    const rows = await (type === 'live'
        ? baseQuery.orderBy(asc(schema.content.id))
        : baseQuery.orderBy(desc(schema.content.added)));

    return attachParsedMediaMetadataToRows(rows);
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
    const rows = await db
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

    return attachParsedMediaMetadataToRows(rows);
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

type ExistingXtreamContentRow = XtreamContentValue & {
    id: number;
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
        title: repairMojibakeText(String(title)),
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

function buildContentIdentityKey(categoryId: number, xtreamId: number): string {
    return `${categoryId}:${xtreamId}`;
}

function nullableString(value: string | null | undefined): string | null {
    return value ?? null;
}

function nullableNumber(value: number | null | undefined): number | null {
    return value ?? null;
}

function hasCatalogFieldChanges(
    existing: ExistingXtreamContentRow,
    next: XtreamContentValue
): boolean {
    return (
        existing.title !== next.title ||
        nullableString(existing.rating) !== nullableString(next.rating) ||
        nullableString(existing.added) !== nullableString(next.added) ||
        nullableString(existing.posterUrl) !==
            nullableString(next.posterUrl) ||
        nullableString(existing.epgChannelId) !==
            nullableString(next.epgChannelId) ||
        nullableNumber(existing.tvArchive) !== nullableNumber(next.tvArchive) ||
        nullableNumber(existing.tvArchiveDuration) !==
            nullableNumber(next.tvArchiveDuration) ||
        nullableString(existing.directSource) !==
            nullableString(next.directSource)
    );
}

function getContentCatalogUpdate(value: XtreamContentValue) {
    return {
        title: value.title,
        rating: value.rating,
        added: value.added,
        posterUrl: value.posterUrl,
        epgChannelId: value.epgChannelId ?? null,
        tvArchive: value.tvArchive ?? null,
        tvArchiveDuration: value.tvArchiveDuration ?? null,
        directSource: value.directSource ?? null,
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

    const categoryMap = new Map(
        categories.map((category) => [category.xtreamId, category.id])
    );

    const values = streams
        .map((stream) => toXtreamContentValue(stream, type, categoryMap))
        .filter((value): value is XtreamContentValue => value !== null);

    const existingContent = (await db
        .select({
            id: schema.content.id,
            categoryId: schema.content.categoryId,
            title: schema.content.title,
            rating: schema.content.rating,
            added: schema.content.added,
            posterUrl: schema.content.posterUrl,
            epgChannelId: schema.content.epgChannelId,
            tvArchive: schema.content.tvArchive,
            tvArchiveDuration: schema.content.tvArchiveDuration,
            directSource: schema.content.directSource,
            xtreamId: schema.content.xtreamId,
            type: schema.content.type,
        })
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
        )) as ExistingXtreamContentRow[];

    if (values.length === 0) {
        return { success: true, count: existingContent.length };
    }

    const existingByKey = new Map(
        existingContent.map((row) => [
            buildContentIdentityKey(row.categoryId, row.xtreamId),
            row,
        ])
    );
    const incomingKeys = new Set(
        values.map((value) =>
            buildContentIdentityKey(value.categoryId, value.xtreamId)
        )
    );
    const staleContentRows = existingContent.filter(
        (row) =>
            !incomingKeys.has(
                buildContentIdentityKey(row.categoryId, row.xtreamId)
            )
    );
    const staleContentIds = staleContentRows.map((row) => row.id);
    const staleXtreamIds = staleContentRows.map((row) => row.xtreamId);

    const total = values.length;
    const chunkSize = 100;
    let totalProcessed = 0;

    for (let index = 0; index < values.length; index += chunkSize) {
        await checkpointOperation(control);
        const chunk = values.slice(index, index + chunkSize);
        const rowsToInsert: XtreamContentValue[] = [];
        const rowsToUpdate: Array<XtreamContentValue & { id: number }> = [];

        for (const row of chunk) {
            const existing = existingByKey.get(
                buildContentIdentityKey(row.categoryId, row.xtreamId)
            );
            if (!existing) {
                rowsToInsert.push(row);
                continue;
            }

            if (hasCatalogFieldChanges(existing, row)) {
                rowsToUpdate.push({ ...row, id: existing.id });
            }
        }

        await db.transaction((tx) => {
            if (rowsToInsert.length > 0) {
                tx.insert(schema.content)
                    .values(rowsToInsert)
                    .onConflictDoNothing({
                        target: [
                            schema.content.categoryId,
                            schema.content.type,
                            schema.content.xtreamId,
                        ],
                    })
                    .run();
            }

            for (const row of rowsToUpdate) {
                tx.update(schema.content)
                    .set(getContentCatalogUpdate(row))
                    .where(eq(schema.content.id, row.id))
                    .run();
            }
        });
        totalProcessed += chunk.length;
        await reportOperationProgress(control, {
            phase: 'saving-content',
            current: totalProcessed,
            total,
            increment: chunk.length,
        });
    }

    for (const chunk of chunkValues(staleContentIds, 100)) {
        await checkpointOperation(control);
        await db.transaction((tx) => {
            tx.delete(schema.content)
                .where(inArray(schema.content.id, chunk))
                .run();
        });
    }

    for (const chunk of chunkValues(staleXtreamIds, 100)) {
        await checkpointOperation(control);
        await db.transaction((tx) => {
            if (type === 'series') {
                tx.delete(schema.episodeMediaMetadata)
                    .where(
                        and(
                            eq(
                                schema.episodeMediaMetadata.playlistId,
                                playlistId
                            ),
                            inArray(
                                schema.episodeMediaMetadata.seriesXtreamId,
                                chunk
                            )
                        )
                    )
                    .run();
                tx.delete(schema.mediaMetadataSeriesDiscoveryJobs)
                    .where(
                        and(
                            eq(
                                schema.mediaMetadataSeriesDiscoveryJobs.playlistId,
                                playlistId
                            ),
                            inArray(
                                schema.mediaMetadataSeriesDiscoveryJobs
                                    .seriesXtreamId,
                                chunk
                            )
                        )
                    )
                    .run();
                tx.delete(schema.mediaMetadataJobs)
                    .where(
                        and(
                            eq(
                                schema.mediaMetadataJobs.playlistId,
                                playlistId
                            ),
                            eq(schema.mediaMetadataJobs.contentType, 'episode'),
                            inArray(
                                schema.mediaMetadataJobs.seriesXtreamId,
                                chunk
                            )
                        )
                    )
                    .run();
                return;
            }

            tx.delete(schema.mediaMetadataJobs)
                .where(
                    and(
                        eq(schema.mediaMetadataJobs.playlistId, playlistId),
                        eq(schema.mediaMetadataJobs.contentType, type),
                        inArray(schema.mediaMetadataJobs.xtreamId, chunk)
                    )
                )
                .run();
        });
    }

    return { success: true, count: values.length };
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
            tx.delete(schema.content)
                .where(inArray(schema.content.id, chunk))
                .run();
        });
    }

    for (const chunk of chunkValues(categoryIds, 100)) {
        await db.transaction((tx) => {
            tx.delete(schema.categories)
                .where(inArray(schema.categories.id, chunk))
                .run();
        });
    }

    if (type === 'series') {
        await db
            .delete(schema.episodeMediaMetadata)
            .where(eq(schema.episodeMediaMetadata.playlistId, playlistId))
            .run();
        await db
            .delete(schema.mediaMetadataJobs)
            .where(
                and(
                    eq(schema.mediaMetadataJobs.playlistId, playlistId),
                    eq(schema.mediaMetadataJobs.contentType, 'episode')
                )
            )
            .run();
        await db
            .delete(schema.mediaMetadataSeriesDiscoveryJobs)
            .where(
                eq(
                    schema.mediaMetadataSeriesDiscoveryJobs.playlistId,
                    playlistId
                )
            )
            .run();
    } else {
        await db
            .delete(schema.mediaMetadataJobs)
            .where(
                and(
                    eq(schema.mediaMetadataJobs.playlistId, playlistId),
                    eq(
                        schema.mediaMetadataJobs.contentType,
                        type === 'movie' ? 'movie' : 'live'
                    )
                )
            )
            .run();
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

    return result[0] ? attachParsedMediaMetadata(result[0]) : null;
}

export async function setContentMediaMetadata(
    db: AppDatabase,
    playlistId: string,
    contentType: 'live' | 'movie' | 'series',
    xtreamId: number,
    metadata: MediaStreamMetadata
): Promise<{ success: boolean; count: number }> {
    if (!Number.isFinite(xtreamId) || xtreamId <= 0) {
        return { success: false, count: 0 };
    }

    const rows = await db
        .select({ id: schema.content.id })
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(
            and(
                eq(schema.categories.playlistId, playlistId),
                eq(schema.content.type, contentType),
                eq(schema.content.xtreamId, xtreamId)
            )
        );

    const ids = rows.map((row) => row.id);
    if (!ids.length) {
        return { success: false, count: 0 };
    }

    await db
        .update(schema.content)
        .set({
            mediaMetadata: JSON.stringify(metadata),
            mediaMetadataUpdatedAt: Date.now(),
        })
        .where(inArray(schema.content.id, ids))
        .run();

    return { success: true, count: ids.length };
}

export async function clearContentMediaMetadata(
    db: AppDatabase
): Promise<{ success: boolean }> {
    await db
        .update(schema.content)
        .set({
            mediaMetadata: null,
            mediaMetadataUpdatedAt: null,
        })
        .run();

    return { success: true };
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

    const searchTokens = buildSearchTokens(searchTerm);
    if (!searchTokens.length) {
        return [];
    }

    const likeConditions = searchTokens.map((token) =>
        or(
            ...buildLikePatterns(token).map(
                (pattern) =>
                    sql`${schema.content.title} LIKE ${pattern} ESCAPE '\\'`
            )
        )
    );

    const conditions = [
        eq(schema.categories.playlistId, playlistId),
        inArray(
            schema.content.type,
            types as Array<'live' | 'movie' | 'series'>
        ),
        ...likeConditions,
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

    return attachParsedMediaMetadataToRows(candidates)
        .filter((item) => titleMatchesSearchTokens(item.title, searchTokens))
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

    const searchTokens = buildSearchTokens(searchTerm);
    if (!searchTokens.length) {
        return [];
    }

    const likeConditions = searchTokens.map((token) =>
        or(
            ...buildLikePatterns(token).map(
                (pattern) =>
                    sql`${schema.content.title} LIKE ${pattern} ESCAPE '\\'`
            )
        )
    );

    const conditions = [
        inArray(
            schema.content.type,
            types as Array<'live' | 'movie' | 'series'>
        ),
        ...likeConditions,
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

    return attachParsedMediaMetadataToRows(candidates)
        .filter((item) => titleMatchesSearchTokens(item.title, searchTokens))
        .slice(0, 50);
}
