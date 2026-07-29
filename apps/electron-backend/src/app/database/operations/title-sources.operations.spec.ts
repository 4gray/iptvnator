import { findTitleSources } from './title-sources.operations';
import {
    compiledQuery,
    createDbMock,
    createFailingDbMock,
    duneRow,
} from './title-sources.spec-data';

describe('title-sources.operations', () => {
    describe('unusable queries', () => {
        it('returns nothing for a blank or non-string title', async () => {
            const { db, all } = createDbMock([duneRow]);

            await expect(findTitleSources(db, { title: '' })).resolves.toEqual(
                []
            );
            await expect(
                findTitleSources(db, { title: '   ' })
            ).resolves.toEqual([]);
            await expect(
                findTitleSources(db, {
                    title: null as unknown as string,
                })
            ).resolves.toEqual([]);
            expect(all).not.toHaveBeenCalled();
        });

        it('still searches when no token survives the trigram minimum', async () => {
            // "up" is two chars, so the trigram tokenizer cannot index it. That
            // is a real movie title, and it must not silently return nothing —
            // the query falls back to a scan instead of being discarded.
            const upRow = { ...duneRow, title: 'Up', xtream_id: 77 };
            const { db, all } = createDbMock([upRow]);

            const result = await findTitleSources(db, { title: 'Up' });

            expect(all).toHaveBeenCalledTimes(1);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual(
                expect.objectContaining({ xtreamId: 77, matchConfidence: 'exact' })
            );
        });

        it('scans on a word boundary, shortest first, and never truncates', async () => {
            // A substring scan for "It" matches "Titanic" and "The Italian
            // Job"; capped and sorted by title, those can push the real "It"
            // out of the result set and discovery reports no sources at all.
            // The scan therefore asks for the token as a WORD and orders by
            // title length (a match is the title plus decoration).
            const scan = createDbMock([]);
            await findTitleSources(scan.db, { title: 'It' });
            const scanQuery = compiledQuery(scan.all);

            expect(scanQuery.sql).toContain('GLOB ?');
            expect(scanQuery.sql).not.toContain('LIKE ?');
            expect(scanQuery.params).toContain('*[^a-z0-9]it[^a-z0-9]*');
            expect(scanQuery.sql).toContain('ORDER BY LENGTH(c.title)');
            // No window at all: unlike FTS this cannot rank, so a limit would
            // silently decide which valid sources the user may see — and the
            // GLOB reads every row regardless, so it would not even save work.
            expect(scanQuery.sql).not.toContain('LIMIT');

            const fts = createDbMock([]);
            await findTitleSources(fts.db, { title: 'Dune' });
            expect(compiledQuery(fts.all).sql).toContain('LIMIT');
        });

        it('can still find a short non-ASCII title', async () => {
            // SQLite's LOWER() and GLOB classes are ASCII-only, so folding
            // "Он" to "он" never happened and the film stayed invisible in
            // the Sources chip entirely.
            const scan = createDbMock([]);
            await findTitleSources(scan.db, { title: 'Он' });
            const scanQuery = compiledQuery(scan.all);

            expect(scanQuery.sql).toContain('instr');
            // Both the folded and the as-typed form, since neither alone
            // matches a title stored in the other case.
            expect(scanQuery.params).toContain('он');
            expect(scanQuery.params).toContain('Он');
        });

        it('does not treat a diacritic-folded token as ASCII', async () => {
            // "Ça" normalizes to "ca", which LOOKS like plain ASCII — but the
            // stored title still reads "Ça" and SQLite folds neither the
            // cedilla nor the case, so the GLOB branch filtered it out before
            // the confirmation could run.
            const scan = createDbMock([]);
            await findTitleSources(scan.db, { title: 'Ça' });
            const scanQuery = compiledQuery(scan.all);

            expect(scanQuery.sql).toContain('instr');
            expect(scanQuery.params).toContain('Ça');
        });

        it('pairs raw tokens by meaning, not by position', async () => {
            // Normalization drops whole words, so "FR: Ça" becomes just "ca".
            // Pairing positionally would hand "ca" the raw token "FR:" and
            // send it down the ASCII branch, where it cannot match "Ça".
            const scan = createDbMock([]);
            await findTitleSources(scan.db, { title: 'FR: Ça' });
            const scanQuery = compiledQuery(scan.all);

            expect(scanQuery.sql).toContain('instr');
            expect(scanQuery.params).toContain('Ça');
        });

        it('keeps the word boundary for ASCII tokens', async () => {
            // The looser substring test must not leak into the ASCII path,
            // where it would let "it" match "Titanic".
            const scan = createDbMock([]);
            await findTitleSources(scan.db, { title: 'It' });
            const scanQuery = compiledQuery(scan.all);

            expect(scanQuery.sql).toContain('GLOB ?');
            expect(scanQuery.sql).not.toContain('instr');
        });

        it('requires every token of an all-short multiword title', async () => {
            // "I Am" reaches the scan too — no token survives the trigram
            // minimum. Matching on the first token alone returns every catalog
            // row containing the word "i", which the TypeScript pass then
            // throws away: a full scan of a large catalog on the single DB
            // worker, just to open a detail page.
            const scan = createDbMock([]);
            await findTitleSources(scan.db, { title: 'I Am' });
            const scanQuery = compiledQuery(scan.all);

            expect(scanQuery.params).toContain('*[^a-z0-9]i[^a-z0-9]*');
            expect(scanQuery.params).toContain('*[^a-z0-9]am[^a-z0-9]*');
            expect(scanQuery.sql.match(/GLOB \?/g)).toHaveLength(2);
        });

        it('does not offer a scan hit whose title merely contains the query', async () => {
            // The scan is deliberately loose; the two-tier normalized check
            // afterwards is what keeps "Up" from matching "Upgrade".
            const { db } = createDbMock([
                { ...duneRow, title: 'Upgrade', xtream_id: 78 },
            ]);

            await expect(
                findTitleSources(db, { title: 'Up' })
            ).resolves.toEqual([]);
        });

        it('returns nothing instead of throwing when the FTS query fails', async () => {
            const { db, all } = createFailingDbMock();

            await expect(
                findTitleSources(db, { title: 'Weird "Title"' })
            ).resolves.toEqual([]);
            expect(all).toHaveBeenCalledTimes(1);
        });
    });
});
