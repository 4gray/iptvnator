import { and, asc, eq, sql } from 'drizzle-orm';
import * as schema from '@iptvnator/shared/database/schema';
import {
    normalizeContentMetadataPatch,
    type ContentMetadataPatch,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { selectContentFields } from './content-fields';

/** Typed lookup prefers a fully confirming duplicate; legacy calls retain their old semantics. */
export async function getContentByXtreamId(
    db: AppDatabase,
    xtreamId: number,
    playlistId: string,
    contentType?: 'live' | 'movie' | 'series',
    identity?: ContentMetadataPatch
) {
    const conditions = [
        eq(schema.content.xtreamId, xtreamId),
        eq(schema.categories.playlistId, playlistId),
    ];
    if (contentType) conditions.push(eq(schema.content.type, contentType));
    const patch = identity ? normalizeContentMetadataPatch(identity) : null;
    if (patch?.tmdbId != null)
        conditions.push(
            sql`(${schema.content.tmdbId} IS NULL OR ${schema.content.tmdbId} = ${patch.tmdbId})`
        );
    if (patch?.releaseYear != null)
        conditions.push(
            sql`(${schema.content.releaseYear} IS NULL OR ${schema.content.releaseYear} = ${patch.releaseYear})`
        );
    const query = db
        .select(selectContentFields())
        .from(schema.content)
        .innerJoin(
            schema.categories,
            eq(schema.content.categoryId, schema.categories.id)
        )
        .where(and(...conditions));
    if (patch?.tmdbId != null || patch?.releaseYear != null) {
        const confirmed = and(
            patch.tmdbId != null
                ? eq(schema.content.tmdbId, patch.tmdbId)
                : sql`1`,
            patch.releaseYear != null
                ? eq(schema.content.releaseYear, patch.releaseYear)
                : sql`1`
        );
        return (
            (
                await query
                    .orderBy(sql`${confirmed} DESC`, asc(schema.content.id))
                    .limit(1)
            )[0] ?? null
        );
    }
    return (await query.limit(1))[0] ?? null;
}
