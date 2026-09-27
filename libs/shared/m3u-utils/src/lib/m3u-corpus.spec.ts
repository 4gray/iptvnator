import {
    M3U_ENTRY_CORPUS,
    corpusEntriesOfDialect,
    corpusEntriesOfKind,
} from './m3u-entry-corpus.spec-data';
import {
    M3U_GROUP_CORPORA,
    M3U_GROUP_FOLD_EQUIVALENCES,
    groupCorpus,
} from './m3u-group-corpus.spec-data';

/**
 * The corpus is the specification the catalog derivation rules are measured
 * against, so it has to be trustworthy before any rule reads it. These tests
 * check the fixture against itself: that it stays leak-free, that every
 * expectation is well formed, and — the important one — that the expected
 * group trees satisfy the conservation invariant the derivation must also
 * satisfy. A fixture that quietly dropped or duplicated a title would make a
 * broken implementation look correct.
 *
 * They also pin the corpus's COVERAGE. Each dialect exists to exercise a
 * tier that the others cannot reach, so deleting one would silently retire a
 * whole branch of the rules; the coverage assertions fail instead.
 */

const ALLOWED_URL_PREFIX = 'http://provider.example/';

describe('M3U entry corpus', () => {
    it('is non-empty and free of duplicate names', () => {
        expect(M3U_ENTRY_CORPUS.length).toBeGreaterThan(0);

        const names = M3U_ENTRY_CORPUS.map((entry) => entry.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('leaks no real endpoint, host or credential', () => {
        for (const entry of M3U_ENTRY_CORPUS) {
            expect(entry.url.startsWith(ALLOWED_URL_PREFIX)).toBe(true);
            // Xtream shapes carry credentials in path position; the corpus
            // uses literal placeholders there and nothing else.
            expect(entry.url).not.toMatch(/[?&](username|password|token)=/i);
            expect(entry.url).not.toContain('@');
        }
    });

    it('describes every case', () => {
        for (const entry of M3U_ENTRY_CORPUS) {
            expect(entry.name.trim()).not.toBe('');
            expect(entry.group.trim()).not.toBe('');
            expect(entry.note.trim()).not.toBe('');
        }
    });

    it('carries an episode expectation exactly for episodes', () => {
        for (const entry of M3U_ENTRY_CORPUS) {
            if (entry.kind === 'episode') {
                expect(entry.episode).toBeDefined();
            } else {
                expect(entry.episode).toBeUndefined();
            }
        }
    });

    it('keeps every episode series title a prefix of its entry name', () => {
        // The parser removes the marker and everything after it, and does
        // NOT touch the leading language tag — that is a separate rule with
        // its own persisted consequences. So the series title is always a
        // literal prefix of the name, and an expectation that is not one is
        // a fixture bug rather than a parser requirement.
        for (const entry of corpusEntriesOfKind('episode')) {
            const episode = entry.episode;
            if (!episode) {
                throw new Error(`missing episode data for ${entry.name}`);
            }

            expect(episode.seriesTitle.trim()).not.toBe('');
            expect(entry.name.startsWith(episode.seriesTitle)).toBe(true);
            expect(episode.season).toBeGreaterThanOrEqual(1);
            expect(episode.episode).toBeGreaterThanOrEqual(1);
        }
    });

    it('states a non-empty tag that leads its entry name', () => {
        for (const entry of M3U_ENTRY_CORPUS) {
            if (entry.tag === null) {
                continue;
            }

            expect(entry.tag.trim()).toBe(entry.tag);
            expect(entry.tag).not.toBe('');
            // A tag occupies the leading position, but the wrapped form
            // ("|EN| CNN") opens with the separator itself, so the check
            // skips leading punctuation rather than requiring the name to
            // start with the tag outright.
            const leading = entry.name.replace(/^[^\p{L}\p{N}]+/u, '');
            expect(leading.startsWith(entry.tag)).toBe(true);
        }
    });

    describe('coverage', () => {
        it('represents both provider dialects', () => {
            expect(
                corpusEntriesOfDialect('xtream-tr-de').length
            ).toBeGreaterThan(0);
            expect(
                corpusEntriesOfDialect('international').length
            ).toBeGreaterThan(0);
        });

        it('represents every content kind', () => {
            for (const kind of ['live', 'movie', 'episode', 'radio'] as const) {
                expect(corpusEntriesOfKind(kind).length).toBeGreaterThan(0);
            }
        });

        it('keeps a live stream whose name carries an episode code', () => {
            // The single most dangerous false positive: promoting a working
            // channel out of the live layout.
            const trap = M3U_ENTRY_CORPUS.find(
                (entry) =>
                    entry.kind === 'live' && /s\d+\s*e\d+/i.test(entry.name)
            );
            expect(trap).toBeDefined();
        });

        it('keeps movies whose names carry weak episode words', () => {
            const weak = M3U_ENTRY_CORPUS.filter(
                (entry) =>
                    entry.kind === 'movie' &&
                    /(b[öo]l[üu]m|episode|season)/i.test(entry.name)
            );
            expect(weak.length).toBeGreaterThanOrEqual(3);
        });

        it('covers episodes served under a non-series path', () => {
            const promoted = M3U_ENTRY_CORPUS.filter(
                (entry) =>
                    entry.kind === 'episode' && !entry.url.includes('/series/')
            );
            expect(promoted.length).toBeGreaterThanOrEqual(2);
        });

        it('covers episodes with no season in the name', () => {
            const seasonless = corpusEntriesOfKind('episode').filter(
                (entry) => entry.episode?.hasExplicitSeason === false
            );
            expect(seasonless.length).toBeGreaterThanOrEqual(2);
        });
    });
});

describe('M3U group corpora', () => {
    it('has unique ids', () => {
        const ids = M3U_GROUP_CORPORA.map((corpus) => corpus.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(M3U_GROUP_CORPORA.map((corpus) => [corpus.id, corpus] as const))(
        '%s: expected tree conserves every input title exactly once',
        (_id, corpus) => {
            const claimed = [
                ...corpus.expectedParents.flatMap((parent) => parent.children),
                ...corpus.expectedRoots,
            ];

            expect(new Set(corpus.groupTitles).size).toBe(
                corpus.groupTitles.length
            );
            expect(new Set(claimed).size).toBe(claimed.length);
            expect([...claimed].sort()).toEqual([...corpus.groupTitles].sort());
        }
    );

    it.each(M3U_GROUP_CORPORA.map((corpus) => [corpus.id, corpus] as const))(
        '%s: every parent is labelled and has at least two children',
        (_id, corpus) => {
            for (const parent of corpus.expectedParents) {
                expect(parent.label.trim()).toBe(parent.label);
                expect(parent.label).not.toBe('');
                expect(parent.children.length).toBeGreaterThanOrEqual(2);
            }
        }
    );

    it.each(M3U_GROUP_CORPORA.map((corpus) => [corpus.id, corpus] as const))(
        '%s: describes itself',
        (_id, corpus) => {
            expect(corpus.description.trim()).not.toBe('');
            expect(corpus.groupTitles.length).toBeGreaterThan(0);
        }
    );

    describe('coverage', () => {
        it('includes a dialect with no separators at all', () => {
            const tokenOnly = groupCorpus('xtream-tr-de');
            expect(
                tokenOnly.groupTitles.every(
                    (title) => !/[|/»›▶>]| - |: /.test(title.replace('/', ''))
                )
            ).toBe(true);
            expect(
                tokenOnly.expectedParents.every(
                    (parent) => parent.origin !== 'separator'
                )
            ).toBe(true);
        });

        it('includes a dialect with no hierarchy at all', () => {
            expect(groupCorpus('iptv-org-flat').expectedParents).toEqual([]);
        });

        it('exercises all three parent origins somewhere', () => {
            const origins = new Set(
                M3U_GROUP_CORPORA.flatMap((corpus) =>
                    corpus.expectedParents.map((parent) => parent.origin)
                )
            );
            expect([...origins].sort()).toEqual([
                'leading-token',
                'separator',
                'trailing-token',
            ]);
        });

        it('includes non-Latin and RTL titles', () => {
            const nonLatin = groupCorpus('non-latin');
            expect(
                nonLatin.groupTitles.some((title) => /[Ѐ-ӿ]/.test(title))
            ).toBe(true);
            expect(
                nonLatin.groupTitles.some((title) => /[؀-ۿ]/.test(title))
            ).toBe(true);
        });

        it('includes punctuation that must not be read as hierarchy', () => {
            expect(
                groupCorpus('punctuation-traps').expectedRoots.length
            ).toBeGreaterThan(0);
        });
    });
});

describe('M3U group fold equivalences', () => {
    it('lists at least two spellings per group', () => {
        expect(M3U_GROUP_FOLD_EQUIVALENCES.length).toBeGreaterThan(0);

        for (const spellings of M3U_GROUP_FOLD_EQUIVALENCES) {
            expect(spellings.length).toBeGreaterThanOrEqual(2);
            expect(new Set(spellings).size).toBe(spellings.length);
        }
    });
});
