import { sql } from 'drizzle-orm';
import {
    normalizeTitleKeys,
    titleYearsCompatible,
    type VodSourceCandidateRow,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

/**
 * VOD multi-source discovery: find the SAME movie in the user's other
 * playlists.
 *
 * Deliberately not built on `buildTitleMatchIndex()` — that helper keeps one
 * match per title key because the Similar rail only needs "does this exist
 * somewhere". Here every copy in every playlist is a distinct, selectable
 * source, so all of them are returned.
 *
 * Scope is Xtream-only: Stalker items never reach the `content` table (they
 * would need a live authenticated portal search), and M3U playlists are stored
 * as a JSON blob whose search path forces `content_type: 'live'`.
 */

const CANDIDATE_LIMIT = 60;

/** A row as it comes back from SQLite, before match confirmation. */
interface TitleSourceRow {
    content_id: number;
    title: string;
    xtream_id: number;
    poster_url: string | null;
    category_xtream_id: number;
    playlist_id: string;
    playlist_name: string;
}

export interface FindTitleSourcesRequest {
    title: string;
    /** Known release year of the movie being viewed, when available. */
    year?: number | null;
    /** The playlist the user is already on — never returned as an alternative. */
    excludePlaylistId?: string | null;
}

function buildFtsMatchQuery(normalizedTitle: string): string {
    const tokens = normalizedTitle
        .split(' ')
        // The trigram tokenizer cannot match tokens shorter than 3 chars
        .filter((token) => token.length >= 3)
        .map((token) => `"${token.replace(/"/g, '""')}"`);
    return tokens.join(' AND ');
}

/**
 * The trigram tokenizer cannot index tokens shorter than three characters, so
 * a title like "Up", "It" or "Us" produces an empty MATCH expression. Those are
 * real movies, and silently returning nothing for them means the chip never
 * appears. This fallback scans instead — slower, but bounded by the same limit
 * and only reachable for the handful of titles FTS structurally cannot serve.
 */
function scanCandidateQuery(base: string) {
    const like = `%${base.replace(/[\\%_]/g, '\\$&')}%`;
    return sql`
        SELECT
            c.id AS content_id,
            c.title AS title,
            c.xtream_id AS xtream_id,
            c.poster_url AS poster_url,
            cat.xtream_id AS category_xtream_id,
            cat.playlist_id AS playlist_id,
            p.name AS playlist_name
        FROM content AS c
        INNER JOIN categories AS cat ON c.category_id = cat.id
        INNER JOIN playlists AS p ON cat.playlist_id = p.id
        WHERE c.type = 'movie'
        AND cat.hidden = 0
        AND p.type = 'xtream'
        AND LOWER(c.title) LIKE ${like} ESCAPE '\\'
        ORDER BY c.title
        LIMIT ${CANDIDATE_LIMIT}
    `;
}

function ftsCandidateQuery(matchQuery: string) {
    return sql`
        SELECT
            c.id AS content_id,
            c.title AS title,
            c.xtream_id AS xtream_id,
            c.poster_url AS poster_url,
            cat.xtream_id AS category_xtream_id,
            cat.playlist_id AS playlist_id,
            p.name AS playlist_name
        FROM content_title_fts
        INNER JOIN content AS c ON c.id = content_title_fts.rowid
        INNER JOIN categories AS cat ON c.category_id = cat.id
        INNER JOIN playlists AS p ON cat.playlist_id = p.id
        WHERE content_title_fts MATCH ${matchQuery}
        AND c.type = 'movie'
        AND cat.hidden = 0
        AND p.type = 'xtream'
        ORDER BY rank, c.title
        LIMIT ${CANDIDATE_LIMIT}
    `;
}

export async function findTitleSources(
    db: AppDatabase,
    request: FindTitleSourcesRequest
): Promise<VodSourceCandidateRow[]> {
    const rawTitle = request?.title;
    if (typeof rawTitle !== 'string' || rawTitle.trim() === '') {
        return [];
    }

    const wanted = normalizeTitleKeys(rawTitle);
    if (!wanted.base) {
        return [];
    }

    // The year the caller knows, falling back to a release tag on the title.
    const wantedYear = request.year ?? wanted.trailingYear ?? null;

    // Search on the year-stripped form so a portal that tags the year and one
    // that does not still find each other; the year gate below re-tightens it.
    const matchQuery = buildFtsMatchQuery(wanted.base);

    let rows: TitleSourceRow[];
    try {
        rows = matchQuery
            ? ((await db.all(
                  ftsCandidateQuery(matchQuery)
              )) as TitleSourceRow[])
            : ((await db.all(
                  scanCandidateQuery(wanted.base)
              )) as TitleSourceRow[]);
    } catch {
        // Malformed FTS query for exotic titles — no sources, not a crash
        return [];
    }

    const matches: VodSourceCandidateRow[] = [];
    // One playlist can list the same film in several categories; the user
    // thinks of that as one source.
    const seen = new Set<string>();

    for (const row of rows) {
        if (
            request.excludePlaylistId &&
            row.playlist_id === request.excludePlaylistId
        ) {
            continue;
        }

        const rowKeys = normalizeTitleKeys(row.title);
        const exactMatch =
            rowKeys.exact !== '' && rowKeys.exact === wanted.exact;
        const baseMatch =
            !exactMatch &&
            rowKeys.base === wanted.base &&
            // A year-stripped match is only trustworthy when the two sides do
            // not actively disagree about the year ("Dune" 1984 vs 2021).
            titleYearsCompatible(rowKeys.trailingYear, wantedYear);

        if (!exactMatch && !baseMatch) {
            continue;
        }

        const dedupeKey = `${row.playlist_id}:${row.xtream_id}`;
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);

        matches.push({
            playlistId: row.playlist_id,
            playlistName: row.playlist_name,
            categoryId: row.category_xtream_id,
            xtreamId: row.xtream_id,
            title: row.title,
            posterUrl: row.poster_url,
            matchConfidence: exactMatch ? 'exact' : 'fuzzy',
            year: rowKeys.trailingYear,
        });
    }

    return matches;
}
