import { and, inArray, or, sql } from 'drizzle-orm';
import { playlists } from '@iptvnator/shared/database/schema';
import type { AppDatabase } from '../database.types';
import {
    buildCompoundLikePatterns,
    buildLikePatterns,
    buildM3uPayloadCompoundPatterns,
    buildM3uPayloadTextFieldPatterns,
    getSearchWordPlans,
    isShortSearchTokenGroup,
} from './content-search.util';

const M3U_PLAYLIST_TYPES = ['m3u-file', 'm3u-text', 'm3u-url'] as const;

export interface M3uPlaylistSearchRow {
    id: string;
    name: string;
    payload: string | null;
}

/**
 * The fast prefilter searches the raw payload with fewer LIKE patterns. Both
 * modes keep the token and compound-word alternatives and leave field matching
 * and ranking to the channel scorer.
 */
function buildM3uPayloadSearchConditions(searchTerm: string, broad: boolean) {
    let groupIndex = 0;

    return getSearchWordPlans(searchTerm)
        .map((plan) => {
            const tokenArm = and(
                ...plan.tokenGroups.map((tokens) => {
                    const mode =
                        groupIndex === 0 && isShortSearchTokenGroup(tokens)
                            ? 'prefix'
                            : 'contains';
                    groupIndex += 1;
                    const patterns = tokens.flatMap((token) =>
                        broad
                            ? buildLikePatterns(token, 'contains')
                            : buildM3uPayloadTextFieldPatterns(token, mode)
                    );
                    return or(
                        ...patterns.map(
                            (pattern) =>
                                sql`${playlists.payload} LIKE ${pattern} ESCAPE '\\'`
                        )
                    );
                })
            );
            if (plan.compound === null) {
                return tokenArm;
            }

            const compoundPatterns = broad
                ? buildCompoundLikePatterns(plan.compound)
                : buildM3uPayloadCompoundPatterns(plan.compound);
            const compoundConditions = compoundPatterns.map(
                (pattern) =>
                    sql`${playlists.payload} LIKE ${pattern} ESCAPE '\\'`
            );
            return or(tokenArm, ...compoundConditions);
        })
        .filter((condition) => condition !== undefined);
}

/**
 * SQL only finds candidate playlists. A full batch may consist of matches in
 * URL or other metadata, so the caller scores channels before deciding to stop.
 */
export async function* scanM3uSearchCandidates(
    db: AppDatabase,
    searchTerm: string,
    batchSize: number
): AsyncGenerator<M3uPlaylistSearchRow[]> {
    const broad = process.env['IPTVNATOR_DISABLE_M3U_BROAD_PREFILTER'] !== '1';
    const conditions = [
        inArray(playlists.type, [...M3U_PLAYLIST_TYPES]),
        sql`${playlists.payload} IS NOT NULL`,
        ...buildM3uPayloadSearchConditions(searchTerm, broad),
    ];
    let after: M3uPlaylistSearchRow | undefined;
    while (true) {
        const rows: M3uPlaylistSearchRow[] = await db
            .select({
                id: playlists.id,
                name: playlists.name,
                payload: playlists.payload,
            })
            .from(playlists)
            .where(
                and(
                    ...conditions,
                    after
                        ? sql`(${playlists.name}, ${playlists.id}) > (${after.name}, ${after.id})`
                        : undefined
                )
            )
            .orderBy(playlists.name, playlists.id)
            .limit(batchSize);

        yield rows;
        if (rows.length < batchSize) {
            return;
        }
        after = rows.at(-1);
    }
}
