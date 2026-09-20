/**
 * Runs the search helpers' output through a real SQLite instance with the
 * same trigram FTS tokenizer the content index uses, so the case-folding
 * contract is checked against SQLite's own LIKE/GLOB/MATCH semantics rather
 * than against a string assertion (issue #609). Each SQL arm of the global
 * and per-playlist search is reproduced from the same pattern builders the
 * operations consume; the AND/OR composition mirrors `content.operations.ts`.
 */
import Database from 'better-sqlite3';
import {
    buildCompoundLikePatterns,
    buildContentTitleFtsMatchQuery,
    buildGlobPrefixPatterns,
    buildLikePatterns,
    buildM3uPayloadTextFieldPatterns,
    getCompoundSearchWords,
    getSqlSearchTokenGroups,
    isShortSearchTokenGroup,
    scoreSearchTextMatch,
    shouldUseContentTitleFts,
    shouldUseContentTitlePrefixIndex,
} from './content-search.util';

const TITLES = [
    'İnşaat Kanalı',
    'inşaat dünyası',
    'İşte Benim Stilim',
    'Ünlü Şef',
    'Çanakkale',
    'Şan Ve Şeref',
    'Первый канал HD',
    'ПЕРВЫЙ КАНАЛ',
    'Ёлки 1914',
    'Йога для всех',
    'Матч ТВ',
    'Ελλάδα Σήμερα',
    'Amélie',
    'US: iş-tv',
];

type Arm = 'fts' | 'glob' | 'like' | 'm3u' | 'compound' | 'score';

function likeClauses(
    column: string,
    groups: string[][],
    build: (token: string, mode: 'contains' | 'prefix') => string[]
): { where: string; params: string[] } {
    const clauses: string[] = [];
    const params: string[] = [];
    groups.forEach((tokens, index) => {
        const mode =
            index === 0 && isShortSearchTokenGroup(tokens)
                ? 'prefix'
                : 'contains';
        const patterns = tokens.flatMap((token) => build(token, mode));
        clauses.push(
            `(${patterns.map(() => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`
        );
        params.push(...patterns);
    });
    return { where: clauses.join(' AND '), params };
}

describe('content-search.util against SQLite', () => {
    let db: Database.Database;

    beforeAll(() => {
        db = new Database(':memory:');
        db.exec(`
            CREATE TABLE c(title TEXT);
            CREATE VIRTUAL TABLE f USING fts5(
                title, content='c', content_rowid='rowid',
                tokenize='trigram remove_diacritics 1'
            );
            CREATE TABLE p(title TEXT, payload TEXT);
        `);
        const insert = db.prepare('INSERT INTO c(title) VALUES (?)');
        const insertPayload = db.prepare(
            'INSERT INTO p(title, payload) VALUES (?, ?)'
        );
        for (const title of TITLES) {
            insert.run(title);
            insertPayload.run(
                title,
                JSON.stringify({ items: [{ name: title, title }] })
            );
        }
        db.exec(`INSERT INTO f(f) VALUES ('rebuild')`);
    });

    afterAll(() => {
        db.close();
    });

    function titles(sql: string, params: string[]): string[] {
        return db
            .prepare(sql)
            .all(...params)
            .map((row) => (row as { title: string }).title)
            .sort();
    }

    function run(query: string): Partial<Record<Arm, string[]>> {
        const out: Partial<Record<Arm, string[]>> = {};
        const groups = getSqlSearchTokenGroups(query);

        if (shouldUseContentTitlePrefixIndex(query)) {
            const patterns = groups[0].flatMap((token) =>
                buildGlobPrefixPatterns(token)
            );
            out.glob = titles(
                `SELECT title FROM c WHERE ${patterns
                    .map(() => 'title GLOB ?')
                    .join(' OR ')}`,
                patterns
            );
        } else if (shouldUseContentTitleFts(query)) {
            out.fts = titles(
                `SELECT c.title FROM f INNER JOIN c ON c.rowid = f.rowid WHERE f MATCH ?`,
                [buildContentTitleFtsMatchQuery(query)]
            );
        }

        const like = likeClauses('title', groups, buildLikePatterns);
        out.like = titles(
            `SELECT title FROM c WHERE ${like.where}`,
            like.params
        );

        const m3u = likeClauses(
            'payload',
            groups,
            buildM3uPayloadTextFieldPatterns
        );
        out.m3u = titles(`SELECT title FROM p WHERE ${m3u.where}`, m3u.params);

        // The compound arm of the prefix path: a punctuation-joined word is
        // looked up as an intact substring, because the prefix index only
        // sees titles starting with the short first token (issue #1161).
        const compoundWords = getCompoundSearchWords(query);
        if (compoundWords.length > 0) {
            const patterns = compoundWords.flatMap((word) =>
                buildCompoundLikePatterns(word)
            );
            out.compound = titles(
                `SELECT title FROM c WHERE ${patterns
                    .map(() => `title LIKE ? ESCAPE '\\'`)
                    .join(' OR ')}`,
                patterns
            );
        }

        out.score = TITLES.filter(
            (title) => scoreSearchTextMatch(title, query) !== null
        ).sort();
        return out;
    }

    it.each([
        ['İnş', 'inş', ['İnşaat Kanalı', 'inşaat dünyası']],
        ['İşt', 'işt', ['İşte Benim Stilim']],
        ['İş', 'iş', ['İşte Benim Stilim']],
        ['Ünl', 'ünl', ['Ünlü Şef']],
        ['Çan', 'çan', ['Çanakkale']],
        ['Şan', 'şan', ['Şan Ve Şeref']],
    ])(
        'finds the same Turkish titles for %s and %s in every SQL arm',
        (upper, lower, expected) => {
            const upperResult = run(upper);
            const lowerResult = run(lower);

            expect(lowerResult).toEqual(upperResult);
            for (const arm of Object.keys(lowerResult) as Arm[]) {
                expect(lowerResult[arm]).toEqual([...expected].sort());
            }
        }
    );

    it.each([
        ['Первый', 'первый', ['Первый канал HD', 'ПЕРВЫЙ КАНАЛ']],
        ['ПЕРВ', 'перв', ['Первый канал HD', 'ПЕРВЫЙ КАНАЛ']],
        ['Ёлки', 'ёлки', ['Ёлки 1914']],
        ['Йога', 'йога', ['Йога для всех']],
        ['Ма', 'ма', ['Матч ТВ']],
        ['ΕΛΛ', 'ελλ', ['Ελλάδα Σήμερα']],
    ])(
        'keeps Cyrillic and Greek case pairs %s / %s equal and complete',
        (upper, lower, expected) => {
            const upperResult = run(upper);
            const lowerResult = run(lower);

            expect(lowerResult).toEqual(upperResult);
            for (const arm of Object.keys(lowerResult) as Arm[]) {
                expect(lowerResult[arm]).toEqual([...expected].sort());
            }
        }
    );

    it('reaches a lower-case compound title from the dotted capital İ spelling', () => {
        // "İş-TV" lower-cases to "i" + U+0307, which is not how the stored
        // "US: iş-tv" is spelled, and its short first token keeps the token
        // arm prefix-anchored — so the compound arm has to carry the
        // mark-free lower-case form.
        expect(run('İş-TV').compound).toEqual(['US: iş-tv']);
        expect(run('iş-tv').compound).toEqual(['US: iş-tv']);
        expect(run('İş-TV')).toEqual(run('iş-tv'));
    });

    it('matches a decomposed query against the precomposed stored title', () => {
        // The query normalizer composes first, so "Ame" + U+0301 + "lie"
        // produces the same tokens as the precomposed spelling.
        expect(run('Ame\u0301lie').like).toEqual(run('Amélie').like);
        expect(run('Ame\u0301lie').score).toEqual(['Amélie']);
    });

    it('keeps the diacritic-stripped fallback for Latin accents', () => {
        expect(run('Amélie').fts).toEqual(['Amélie']);
        expect(run('amelie').fts).toEqual(['Amélie']);
        expect(run('amelie').score).toEqual(['Amélie']);
    });
});
