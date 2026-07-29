import { sql, type SQL } from 'drizzle-orm';
import {
    normalizeTitleKeys,
    titleYearsCompatible,
    type VodSourceCandidateRow,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';
import { caseInsensitiveGlobPattern } from './title-token-glob';

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
    /**
     * One stream id inside that playlist to keep anyway.
     *
     * A pin can point at another copy of the film in the playlist the user is
     * currently on. Excluding the playlist wholesale would drop the pinned row
     * from the list, and the explicit preference would be silently ignored.
     */
    keepContentId?: number | null;
}

/**
 * A year written in brackets — "Dune (1984)", the commonest catalog form.
 *
 * `normalizeTitleKeys` strips bracketed segments wholesale, because they
 * usually hold quality and language tags. A year written that way therefore
 * survives in neither key, and both Dunes normalize to exactly "dune" — which
 * the exact tier accepts without ever consulting the year, so failover could
 * switch the user to the other film entirely.
 */
function bracketedYear(title: string): number | null {
    const match = title.match(/[([{]\s*(19\d{2}|20\d{2})\s*[)\]}]/);
    return match ? Number(match[1]) : null;
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
 * The playlist the user is already on, removed IN SQL.
 *
 * Filtering it out afterwards is not enough: a playlist that lists the film in
 * a dozen categories would spend the whole row budget on rows that are then
 * all discarded, and the alternatives it was supposed to make room for would
 * never be read at all.
 */
function excludePlaylistClause(
    excludePlaylistId: string | null | undefined,
    keepContentId: number | null | undefined
): SQL {
    if (!excludePlaylistId) {
        return sql``;
    }

    return typeof keepContentId === 'number'
        ? sql`AND (cat.playlist_id <> ${excludePlaylistId} OR c.xtream_id = ${keepContentId})`
        : sql`AND cat.playlist_id <> ${excludePlaylistId}`;
}

/**
 * The trigram tokenizer cannot index tokens shorter than three characters, so
 * a title like "Up", "It" or "Us" produces an empty MATCH expression. Those are
 * real movies, and silently returning nothing for them means the chip never
 * appears. This fallback scans instead — slower, and only reachable for the
 * handful of titles FTS structurally cannot serve.
 *
 * The predicate is a WORD-boundary match, not a substring one: `LIKE '%it%'`
 * matches "Titanic" and "The Italian Job", so noise could crowd out the real
 * "It" entirely. Padding both sides lets one GLOB pattern cover the start,
 * middle and end of the title at once.
 *
 * And it takes NO row limit, unlike the FTS path. FTS ranks by relevance, so
 * a window keeps the best rows; a scan can only order by title, so a window
 * silently decides which valid sources the user is allowed to see. It is also
 * a false economy — the GLOB cannot use an index, so SQLite reads every row
 * either way and a `LIMIT` saves only transfer. What bounds this instead is
 * the predicate: reaching here means the movie's whole title is one or two
 * characters, and only films carrying that exact word come back. Rows arrive
 * shortest-title-first because a match is the title plus decoration
 * ("IT (2017) 1080p").
 *
 * Still a necessary-not-sufficient filter — `normalizeTitleKeys` below is what
 * confirms a match.
 */
/**
 * One token's presence test.
 *
 * SQLite's `LOWER()` is ASCII-only — `LOWER('Он')` is `'Он'` — so a Cyrillic or
 * Greek token cannot be folded by SQL, and matching "он" against a stored "Он"
 * simply failed: the film stayed invisible in the Sources chip.
 *
 * GLOB character classes are NOT ASCII-only, though; they compare UTF-8 code
 * points. So the non-ASCII branch folds the case in JavaScript, where Unicode
 * case mapping is real, and hands SQLite one `[lowerUpper]` class per
 * character. The two substring tests stay alongside it, because the class is
 * built from the RAW token and cannot match a title whose diacritics differ
 * ("Ça" vs a stored "Ca"), which the folded-token test does cover.
 *
 * ASCII tokens keep the word-boundary GLOB, which is what stops "it" matching
 * "Titanic". The non-ASCII branch has no word boundary — `[^a-z0-9]` would
 * treat any Cyrillic letter as a separator — so it is looser, and the
 * normalized confirmation afterwards is what makes that safe: a looser filter
 * here costs transfer, never a wrong match.
 */
function tokenPredicate(token: string, rawToken: string): SQL {
    // Decided from the RAW token, not the normalized one. Normalization folds
    // diacritics, so "Ça" arrives here as "ca" — which looks like plain ASCII
    // while the stored title still reads "Ça", and SQLite folds neither the
    // cedilla nor the case. Branching on the folded form sent that title down
    // the GLOB path and filtered it out before the confirmation ever ran.
    //
    // Normalized ASCII tokens hold letters and digits only, so nothing here
    // is a GLOB metacharacter.
    if (/^[\x20-\x7e]*$/.test(rawToken) && /^[a-z0-9]+$/.test(token)) {
        return sql`' ' || LOWER(c.title) || ' ' GLOB ${`*[^a-z0-9]${token}[^a-z0-9]*`}`;
    }

    const substring = sql`(instr(LOWER(c.title), ${token}) > 0 OR instr(c.title, ${rawToken}) > 0)`;
    const anyCase = caseInsensitiveGlobPattern(rawToken);
    // `null` means the token holds a GLOB metacharacter or a case mapping that
    // changes length, and the substring tests alone are the honest answer.
    return anyCase ? sql`(c.title GLOB ${anyCase} OR ${substring})` : substring;
}

function scanCandidateQuery(
    base: string,
    rawTitle: string,
    excludePlaylist: SQL
) {
    // EVERY token has to appear, not just the first. This path is reached
    // whenever no token survives FTS's minimum length, which includes
    // multiword titles like "I Am" — matching on "i" alone would return most
    // of the catalog and hand it all to the TypeScript pass to throw away.
    const tokens = base.split(' ').filter(Boolean);
    // Paired by NORMALIZED form, not by position: normalization drops whole
    // words ("FR: Ça" -> "ca"), so a positional pairing hands "ca" the raw
    // token "FR:" and picks the wrong branch for it.
    const rawByBase = new Map<string, string>();
    for (const raw of rawTitle.split(/\s+/).filter(Boolean)) {
        const normalized = normalizeTitleKeys(raw).base;
        if (normalized && !rawByBase.has(normalized)) {
            rawByBase.set(normalized, raw);
        }
    }

    const wordMatches = sql.join(
        tokens.map((token) =>
            tokenPredicate(token, rawByBase.get(token) ?? token)
        ),
        sql` AND `
    );
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
        AND ${wordMatches}
        ${excludePlaylist}
        ORDER BY LENGTH(c.title), c.title
    `;
}

/**
 * The relevance-ranked path, and the only one still taking a window.
 *
 * One playlist can list a film in dozens of categories, and those rows are
 * identically ranked — enough of them would fill the window before another
 * playlist was ever read. The TypeScript pass collapses them afterwards,
 * which cannot recover what the query never returned, so the collapse has to
 * happen first: one row per `(playlist_id, xtream_id)`, then the limit.
 */
function ftsCandidateQuery(matchQuery: string, excludePlaylist: SQL) {
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
        ${excludePlaylist}
        GROUP BY cat.playlist_id, c.xtream_id
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

    // The year the caller knows, falling back to a release tag on the title
    // in either of the two forms providers write it.
    const wantedYear =
        request.year ?? wanted.trailingYear ?? bracketedYear(rawTitle);

    // Search on the year-stripped form so a portal that tags the year and one
    // that does not still find each other; the year gate below re-tightens it.
    const matchQuery = buildFtsMatchQuery(wanted.base);

    const excludePlaylist = excludePlaylistClause(
        request.excludePlaylistId,
        request.keepContentId
    );

    let rows: TitleSourceRow[];
    try {
        rows = matchQuery
            ? ((await db.all(
                  ftsCandidateQuery(matchQuery, excludePlaylist)
              )) as TitleSourceRow[])
            : ((await db.all(
                  scanCandidateQuery(wanted.base, rawTitle, excludePlaylist)
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
        // SQL already excluded these; this keeps the guarantee a property of
        // the function rather than of one WHERE clause — minus the one copy
        // the caller asked to keep.
        if (
            request.excludePlaylistId &&
            row.playlist_id === request.excludePlaylistId &&
            row.xtream_id !== request.keepContentId
        ) {
            continue;
        }

        const rowKeys = normalizeTitleKeys(row.title);
        const rowBracketedYear = bracketedYear(row.title);
        const rowYear = rowKeys.trailingYear ?? rowBracketedYear;
        // Two films share a title far too often for this to be optional, and
        // it applies to BOTH tiers: "Dune (1984)" normalizes to exactly the
        // same string as "Dune", so an exact match says nothing about which
        // film it is. When each side states a year and they disagree, it is
        // not the same movie. An unknown year still never blocks.
        const yearsAgree = titleYearsCompatible(rowYear, wantedYear);
        // The exact tier reads only the BRACKETED year, though. Reaching it
        // means both titles are the same string, so any trailing four digits
        // belong to both — and comparing a number that is part of the NAME
        // against a release year from metadata rejects the very copy it was
        // meant to confirm: "Blade Runner 2049" against a stated 2017 vanishes
        // the moment enrichment lands. Brackets are never part of a name, so
        // that form still decides.
        const exactYearsAgree = titleYearsCompatible(
            rowBracketedYear,
            wantedYear
        );
        const exactMatch =
            rowKeys.exact !== '' &&
            rowKeys.exact === wanted.exact &&
            exactYearsAgree;
        const baseMatch =
            !exactMatch && rowKeys.base === wanted.base && yearsAgree;

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
            year: rowYear,
        });
    }

    return matches;
}
