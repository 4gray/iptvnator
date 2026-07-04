import { sql } from 'drizzle-orm';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

/**
 * Batched cross-playlist title matching for the actor page's "All portals"
 * scope. For every requested title one trigram-FTS lookup runs against
 * `content_title_fts`. Confirmation is two-tier, mirroring the renderer's
 * portal-scoped matching: the query (a canonical TMDB title) must equal
 * either the candidate's exact normalized title, or its year-stripped form
 * — in which case the stripped year tag is returned so the renderer can
 * reject year-incompatible matches.
 */

const MAX_TITLES_PER_REQUEST = 200;
const PER_TITLE_CANDIDATE_LIMIT = 24;

interface TitleMatchRow {
    title: string;
    xtream_id: number;
    type: 'movie' | 'series';
    category_xtream_id: number;
    playlist_id: string;
    playlist_name: string;
}

function buildFtsMatchQuery(normalizedTitle: string): string {
    const tokens = normalizedTitle
        .split(' ')
        // The trigram tokenizer cannot match tokens shorter than 3 chars
        .filter((token) => token.length >= 3)
        .map((token) => `"${token.replace(/"/g, '""')}"`);
    return tokens.join(' AND ');
}

export async function matchTitles(
    db: AppDatabase,
    titles: string[]
): Promise<CatalogTitleMatch[]> {
    const uniqueTitles = [
        ...new Set(
            (titles ?? []).filter(
                (title) => typeof title === 'string' && title.trim() !== ''
            )
        ),
    ].slice(0, MAX_TITLES_PER_REQUEST);

    const matches: CatalogTitleMatch[] = [];

    for (const queryTitle of uniqueTitles) {
        // TMDB titles are canonical — a trailing year is part of the title
        const wanted = normalizeTitleKeys(queryTitle).exact;
        const matchQuery = buildFtsMatchQuery(wanted);
        if (!wanted || !matchQuery) {
            continue;
        }

        let rows: TitleMatchRow[];
        try {
            rows = (await db.all(sql`
                SELECT
                    c.title AS title,
                    c.xtream_id AS xtream_id,
                    c.type AS type,
                    cat.xtream_id AS category_xtream_id,
                    cat.playlist_id AS playlist_id,
                    p.name AS playlist_name
                FROM content_title_fts
                INNER JOIN content AS c ON c.id = content_title_fts.rowid
                INNER JOIN categories AS cat ON c.category_id = cat.id
                INNER JOIN playlists AS p ON cat.playlist_id = p.id
                WHERE content_title_fts MATCH ${matchQuery}
                AND c.type IN ('movie', 'series')
                AND cat.hidden = 0
                ORDER BY rank, c.title
                LIMIT ${PER_TITLE_CANDIDATE_LIMIT}
            `)) as TitleMatchRow[];
        } catch {
            // Malformed FTS query for exotic titles — skip, don't fail the batch
            continue;
        }

        for (const row of rows) {
            const rowKeys = normalizeTitleKeys(row.title);
            const exactMatch = rowKeys.exact === wanted;
            const baseMatch =
                !exactMatch &&
                rowKeys.base !== rowKeys.exact &&
                rowKeys.base === wanted;
            if (!exactMatch && !baseMatch) {
                continue;
            }
            matches.push({
                queryTitle,
                playlistId: row.playlist_id,
                playlistName: row.playlist_name,
                categoryId: row.category_xtream_id,
                xtreamId: row.xtream_id,
                type: row.type,
                trailingYear: exactMatch ? null : rowKeys.trailingYear,
            });
        }
    }

    return matches;
}
