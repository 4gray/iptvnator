import {
    normalizeTitle,
    normalizeTitleKeys,
    titleYearsCompatible,
} from './title-normalization.util';

describe('normalizeTitleKeys', () => {
    it('keeps a trailing year in the exact form and strips it in base', () => {
        expect(normalizeTitleKeys('Blade Runner 2049')).toEqual({
            exact: 'blade runner 2049',
            base: 'blade runner',
            trailingYear: 2049,
        });
    });

    it('returns identical tiers when there is no trailing year', () => {
        expect(normalizeTitleKeys('Blade Runner')).toEqual({
            exact: 'blade runner',
            base: 'blade runner',
            trailingYear: null,
        });
    });

    it('strips quality tags and bracket groups on both tiers', () => {
        expect(normalizeTitleKeys('The Matrix 1999 [4K] (Remastered)')).toEqual(
            {
                exact: 'the matrix 1999',
                base: 'the matrix',
                trailingYear: 1999,
            }
        );
    });

    it('never strips a year that IS the whole title', () => {
        expect(normalizeTitleKeys('2012')).toEqual({
            exact: '2012',
            base: '2012',
            trailingYear: null,
        });
    });

    it('keeps leading/mid-title years (only trailing years are tags)', () => {
        expect(normalizeTitle('2001: A Space Odyssey')).toBe(
            '2001 a space odyssey'
        );
    });

    it('only strips UPPERCASE language prefixes', () => {
        expect(normalizeTitle('EN - The Boys s05')).toBe('the boys');
        expect(normalizeTitle('It: Chapter Two')).toBe('it chapter two');
    });

    it('strips season suffixes on both tiers', () => {
        expect(normalizeTitleKeys('The Boys s05').exact).toBe('the boys');
        expect(normalizeTitleKeys('Пацаны сезон 2').base).toBe('пацаны');
    });

    it('strips number-first season suffixes ("2 season", "2 сезон")', () => {
        expect(normalizeTitle('The Mandalorian 2 Season')).toBe(
            'the mandalorian'
        );
        expect(normalizeTitle('The Mandalorian 2nd Season')).toBe(
            'the mandalorian'
        );
        expect(normalizeTitle('Мандалорец 2 сезон')).toBe('мандалорец');
        expect(normalizeTitle('Пацаны 2-й сезон')).toBe('пацаны');
    });

    it('keeps plural "seasons" endings — only singular markers are tags', () => {
        expect(normalizeTitle('Best of 2 Seasons')).toBe('best of 2 seasons');
    });

    it('folds both lowercase spellings of Greek sigma together', () => {
        // `toLowerCase` picks the form by position — "ΑΣ" becomes "ας" while
        // an already-lowercase "ασ" stays medial — so one word arrives here
        // spelled two ways. Both SQL tiers fold them (SQLite's trigram
        // tokenizer natively, the scan's GLOB classes in JavaScript), so
        // leaving them apart here admits a candidate and then discards it.
        expect(normalizeTitle('ΑΣ')).toBe(normalizeTitle('Ας'));
        expect(normalizeTitle('ασ')).toBe(normalizeTitle('ας'));
        expect(normalizeTitle('ΑΣ')).toBe(normalizeTitle('ασ'));
        expect(normalizeTitle('Ο Άρχοντας')).toBe(normalizeTitle('ο αρχοντασ'));
    });

    it('does not fold sigma into unrelated Greek letters', () => {
        // The fold is one letter's two lowercase forms, not a general
        // loosening of Greek — these must stay different titles.
        expect(normalizeTitle('ΑΣ')).not.toBe(normalizeTitle('ΑΝ'));
        expect(normalizeTitle('ΟΣ')).not.toBe(normalizeTitle('ΑΣ'));
    });
});

describe('provider tag stripping', () => {
    it('strips wrapped pipe tags', () => {
        expect(normalizeTitle('|DE| ARD')).toBe('ard');
        expect(normalizeTitle('|MULTI| Fallout - 4K')).toBe('fallout');
        expect(normalizeTitle('|EXYU| The Pitt')).toBe('the pitt');
    });

    it('strips long and compound leading tags', () => {
        expect(normalizeTitle('EXYU| Fallout')).toBe('fallout');
        expect(normalizeTitle('MULTI| Breaking Bad')).toBe('breaking bad');
        expect(normalizeTitle('4K-DE - The Pitt (2025) (US)')).toBe('the pitt');
        expect(normalizeTitle('AR-SUBS - Fallout (2024) (US)')).toBe('fallout');
        expect(normalizeTitle('4K-OSN+ - The Last of Us (2023)')).toBe(
            'the last of us'
        );
    });

    it('never treats numeric fragments as leading tags', () => {
        expect(normalizeTitle('1917 - Behind the Lines')).toBe(
            '1917 behind the lines'
        );
    });

    it('reads pipe lookalikes as the pipe they look like', () => {
        // `│`, `¦` and `｜` are indistinguishable from `|` in a catalog, so
        // the same tag must not survive in one playlist and vanish in
        // another — the two copies would never match as the same film.
        expect(normalizeTitle('EN │ Fallout')).toBe('fallout');
        expect(normalizeTitle('DE ¦ Fallout')).toBe('fallout');
        expect(normalizeTitle('MULTI｜Fallout')).toBe('fallout');
    });

    it('strips a pipe tag welded to the title', () => {
        // "|FR|VO|Le dernier empereur" — the wrapped tag goes first, then
        // "VO|" with no space after it.
        expect(normalizeTitle('|FR|VO|Le dernier empereur')).toBe(
            'le dernier empereur'
        );
        expect(normalizeTitle('EN|Fallout')).toBe('fallout');
    });

    it('keeps a name that only looks like a tag before a pipe', () => {
        // Pins the UPPERCASE rule on the pipe branch. Relaxing it there is
        // tempting — nothing but a tag precedes a pipe, surely — but measured
        // against 1.27M real catalog titles a case-insensitive (or Cyrillic)
        // pipe rule corrupted 349 keys and rescued none: "name | year" and
        // the Russian "localized | original" convention both put the film's
        // own name in the tag position.
        // The base tier drops the trailing year, so the name is what must
        // survive; the exact tier shows the whole string it came from.
        expect(normalizeTitle('Akira | 1988')).toBe('akira');
        expect(normalizeTitleKeys('Akira | 1988').exact).toBe('akira 1988');
        expect(normalizeTitle('Coco | 2017')).toBe('coco');
        expect(normalizeTitle('Момо | Momo')).toBe('момо momo');
        expect(normalizeTitle('Мумия | The Mummy')).toBe('мумия the mummy');
    });

    it('keeps bare 4-5 char words before a spaced dash (real titles)', () => {
        expect(normalizeTitle('DUNE - Part Two')).toBe('dune part two');
        expect(normalizeTitle('ALIEN - Covenant')).toBe('alien covenant');
    });

    it('strips underscore and double-dash suffix tags', () => {
        expect(normalizeTitle('Fallout_eng')).toBe('fallout');
        expect(normalizeTitle('Breaking Bad (US)_msub')).toBe('breaking bad');
        expect(normalizeTitle('The Pitt (2025)_sub')).toBe('the pitt');
        expect(normalizeTitle('The Last of Us--esp')).toBe('the last of us');
    });

    it('keeps underscore-as-space titles intact', () => {
        expect(normalizeTitle('The_Last_of_Us')).toBe('the last of us');
    });

    it('keeps sole-underscore titles whose tail is not a known tag', () => {
        expect(normalizeTitle('Mr_Robot')).toBe('mr robot');
        expect(normalizeTitle('Cowboy_Bebop')).toBe('cowboy bebop');
        expect(normalizeTitle('Mrs_Davis')).toBe('mrs davis');
    });

    it('strips joined dash tags only for case-uniform vocabulary tokens', () => {
        expect(normalizeTitle('Breaking Bad-eng')).toBe('breaking bad');
        expect(normalizeTitle('The Last of Us-DE')).toBe('the last of us');
        expect(normalizeTitle('The Pitt (2025)-it')).toBe('the pitt');
        expect(normalizeTitle('Spider-Man')).toBe('spider man');
        expect(normalizeTitle('Kick-It')).toBe('kick it');
    });

    it('keeps English hyphenated word endings that collide with codes', () => {
        expect(normalizeTitle('drive-in')).toBe('drive in');
        expect(normalizeTitle('Plug-in')).toBe('plug in');
    });

    it('strips bare trailing UPPERCASE vocabulary tags', () => {
        expect(normalizeTitle('The Pitt (2025) DE')).toBe('the pitt');
        expect(normalizeTitle('Breaking Bad ES')).toBe('breaking bad');
        expect(normalizeTitle('EN| Breaking Bad SUB')).toBe('breaking bad');
        expect(normalizeTitle('The Last of Us (2023) AF')).toBe(
            'the last of us'
        );
    });

    it('never strips trailing tags that could be real endings', () => {
        expect(normalizeTitle('Rocky II')).toBe('rocky ii');
        expect(normalizeTitle('Made in USA')).toBe('made in usa');
        expect(normalizeTitle('NCIS: LA')).toBe('ncis la');
        expect(normalizeTitle('Making It')).toBe('making it');
        expect(normalizeTitle('THE LAST OF US')).toBe('the last of us');
    });

    const pittCorpus = [
        'The Pitt (2025)_sub',
        'The Pitt (2025)-it',
        'The Pitt (2025)',
        'The Pitt (Hindi)',
        'The Pitt (2025) 4K',
        'The Pitt (2025) DE',
        'The Pitt (2025) ES',
        'The Pitt (2025) FR',
        'The Pitt (2025)_eng',
        'The Pitt [MULTI-SUB]',
        'The Pitt (2025) (4K DV)',
        'GR - The Pitt',
        '4K-DE - The Pitt (2025) (US)',
        '4K-TR - The Pitt (2025) (US)',
        'AR-SUBS - The Pitt (2025) (US)',
        'DE - The Pitt (2025) (US)',
        'ALB| The Pitt',
        'EXYU| The Pitt',
        '|ALB| The Pitt',
        '|DE| The Pitt',
    ];

    const falloutCorpus = [
        'Fallout',
        'DE - Fallout (2024)',
        'Fallout (2024) - 4K',
        'Fallout (2024) FR-EN',
        'Fallout (2024) Multi',
        'Fallout (2024)_fr',
        'Fallout_esp',
        'Fallout (4K)',
        '4K-AMZ - Fallout (2024) (US)',
        'AL - Fallout (2024)',
        'AMZ - Fallout (2024) (US)',
        'AR-DE - Fallout (US)',
        'LA - Fallout',
        'EN| Fallout - 4K',
        'MULTI| Fallout - 4K',
        'Fallout ( مدبلج )',
        'Fallout (Telugu)',
        '|EN| Fallout - 4K',
        '|MULTI| Fallout',
        '|TR| Fallout',
    ];

    const lastOfUsCorpus = [
        'The Last of Us',
        'The Last Of Us',
        'The Last of Us (2023) 4K',
        'The Last of Us (2023) AF',
        'The Last of Us_tr',
        'The Last of Us--esp',
        'The Last of Us-DE',
        'The Last of Us-esp',
        'The Last of Us [L]',
        'The Last of Us ( HD )',
        '4K-OSN+ - The Last of Us (2023)',
        'IS - The Last of Us (2023) (US)',
        'RU - The Last of Us',
        'ALB| The Last of Us',
    ];

    const breakingBadCorpus = [
        'Breaking Bad',
        'Breaking Bad (2008)_fr',
        'Breaking Bad (US)_msub',
        'Breaking Bad_it',
        'Breaking Bad-DE',
        'Breaking Bad-eng',
        'Breaking Bad ( عائلي )',
        'Breaking Bad (Pure)',
        'Breaking Bad - Multi',
        'Breaking Bad ES',
        'AR-DE - Breaking Bad',
        'EN| Breaking Bad SUB',
        'MULTI| Breaking Bad',
        'AR| Breaking Bad',
        // Pipe lookalikes and a lowercase tag: identical on screen to the
        // forms above, so they have to reach the same key.
        'EN │ Breaking Bad',
        'DE ¦ Breaking Bad',
        'FR｜Breaking Bad',
    ];

    it.each([
        ['the pitt', pittCorpus],
        ['fallout', falloutCorpus],
        ['the last of us', lastOfUsCorpus],
        ['breaking bad', breakingBadCorpus],
    ])(
        'normalizes every observed provider variant of "%s" to one key',
        (expected, corpus) => {
            for (const name of corpus) {
                expect(normalizeTitleKeys(name).base).toBe(expected);
            }
        }
    );

    describe("leading tag vs. the film's own name", () => {
        // "IT - 65 (2023)" and "AKA - 2023" are the same shape: 2-5 uppercase
        // characters, a separator, digits. Only the token's MEANING separates
        // the Italian copy of the film "65" from the film "AKA" followed by
        // its year, so the strip is vocabulary-gated whenever nothing but
        // digits would survive it.

        it('keeps a name that only looks like a tag before its year', () => {
            // Measured on the live catalog: these all normalized to a bare
            // year, so AKA/BDE/BRO/OUT/WIL/IF shared the single key "2023"
            // and were offered to each other as alternative sources.
            expect(normalizeTitle('AKA - 2023')).toBe('aka');
            expect(normalizeTitle('AKA | 2023')).toBe('aka');
            expect(normalizeTitle('IO - 2019')).toBe('io');
            expect(normalizeTitle('ARQ - 2016')).toBe('arq');
            expect(normalizeTitle('UFO - 2012')).toBe('ufo');
            expect(normalizeTitle('LBJ - 2017')).toBe('lbj');
            expect(normalizeTitle('EO - 2022')).toBe('eo');
            expect(normalizeTitle('BDE - 2023')).toBe('bde');
            expect(normalizeTitle('VFW - 2019 (4K HDR)')).toBe('vfw');
            expect(normalizeTitleKeys('AKA - 2023').exact).toBe('aka 2023');
        });

        it('still strips real tags before a numeric film title', () => {
            // The opposite shape, and the reason a shape-only guard was
            // rejected: here the tag is real and the film's NAME is numeric.
            expect(normalizeTitle('IT - 65 (2023)')).toBe('65');
            expect(normalizeTitle('|FR|VO| 300 (2007)')).toBe('300');
            expect(normalizeTitle('|FR|VO| 1922')).toBe('1922');
            expect(normalizeTitle('OSN - 1917 - 2019')).toBe('1917');
            expect(normalizeTitle('EN - 42 - 2013')).toBe('42');
            expect(normalizeTitle('NRC - 7500 (2019)')).toBe('7500');
            expect(normalizeTitle('EXYU| 3022')).toBe('3022');
        });

        it('strips streaming-provider tags before numeric series titles', () => {
            // Found only in the series catalog: a movie-only vocabulary
            // dropped these copies of 1923/1883/24/99 out of their groups.
            expect(normalizeTitle('AMZ - 99 (2024)')).toBe('99');
            expect(normalizeTitle('D+ - 24 (2001) (US)')).toBe('24');
            expect(normalizeTitle('D+ - 9-1-1 (2018) (US)')).toBe('9 1 1');
            expect(normalizeTitle('P+ - 1883 (2021)')).toBe('1883');
        });

        it('reads a compound tag by its head, so names survive', () => {
            // "4K-<lang>" pairings are open-ended, so the head carries the
            // meaning — and it is also what tells a compound tag apart from
            // a hyphenated name.
            expect(normalizeTitle('4K-FR - 1992 (2024)')).toBe('1992');
            expect(normalizeTitle('AR-SUBS - 180 (2026)')).toBe('180');
            expect(normalizeTitle('SO-IN - 65 (2023)')).toBe('65');
            expect(normalizeTitle('INU-OH - 2022')).toBe('inu oh');
            expect(normalizeTitle('PC-4L - 2020')).toBe('pc 4l');
        });

        it('asks the real pipeline what survives, not a list of its rules', () => {
            // Every later stage removes something, so a guard that predicts
            // them is a list to keep in sync. These are one case per stage,
            // and all of them fall out of running the pipeline and looking:
            expect(normalizeTitle('|TA| RRR - HEVC')).toBe('rrr'); // quality
            expect(normalizeTitle('CAT - Multi ENG')).toBe('cat'); // trailing
            expect(normalizeTitle('IF - 2024_sub')).toBe('if'); // underscore
            expect(normalizeTitle('AKA --xyz')).toBe('aka'); // double dash
            expect(normalizeTitle('CAT - 2022 S01')).toBe('cat 2022'); // season
            // …while a known tag before a numeric title still strips on every
            // one of those paths.
            expect(normalizeTitle('P+ - 1923 S01')).toBe('1923');
            expect(normalizeTitle('IT - 65 s01')).toBe('65');
            expect(normalizeTitle('EX - 1917 (2019) 4K')).toBe('1917');
        });

        it('does not let a quality suffix smuggle the strip through', () => {
            // The suffix has letters only until QUALITY_TAGS removes them, so
            // testing the raw remainder would strip the name and normalize
            // "RRR - HEVC" to the EMPTY key — while "RRR - 2022" keys as
            // "rrr", hiding one copy of the film from the other.
            expect(normalizeTitle('|TA| RRR - HEVC')).toBe('rrr');
            expect(normalizeTitle('CAT - Multi')).toBe('cat');
            expect(normalizeTitle('RRR - 2022 - 4K')).toBe('rrr');
            expect(normalizeTitle('VFW - 2019 UHD')).toBe('vfw');
            // A TRAILING language tag is dropped a few lines later too, so it
            // is no more a word than a quality tag is. Real catalog titles:
            // "sub" made the remainder look meaningful and the key came out
            // as the bare year this whole guard exists to prevent.
            expect(normalizeTitle('IF - 2024_sub')).toBe('if');
            expect(normalizeTitle('O2 - 2024_sub')).toBe('o2');
            expect(normalizeTitle('UFO - 2022_sub')).toBe('ufo');
            expect(normalizeTitle('CAT - Multi ENG')).toBe('cat');
            // …but a tag word next to a real one is just part of the title.
            expect(normalizeTitle('EN - Sub Zero')).toBe('sub zero');
            // …and a real tag before a numeric title still strips, because it
            // now goes through the vocabulary instead of the raw-letter test.
            expect(normalizeTitle('EX - 1917 (2019) 4K')).toBe('1917');
            expect(normalizeTitle('NF - 1899 4K (2022)')).toBe('1899');
            expect(normalizeTitle('EN - 180 - 2026 4K')).toBe('180');
        });

        it('leaves the wrapped-pipe form ungated', () => {
            // A film name is never wrapped in pipes on both sides: all 174
            // letterless cases in the catalog were genuine tags.
            expect(normalizeTitle('|EN| 65')).toBe('65');
            expect(normalizeTitle('|DE| 2067')).toBe('2067');
        });

        it('no longer normalizes a title down to a degenerate key', () => {
            // Both used to collapse into piles of unrelated junk — "" with 72
            // other members, and "2" with everything named after a numeral.
            expect(normalizeTitle('DSP: (2022)')).toBe('dsp');
            expect(normalizeTitle('HIT: 2 (2022)')).toBe('hit 2');
            expect(normalizeTitle('EGO - (Erkeğe Güven Olmaz)')).toBe('ego');
        });
    });

    it('keeps localized subtitles (indistinguishable from real ones)', () => {
        expect(normalizeTitle('Breaking Bad: A Química do Mal')).toBe(
            'breaking bad a quimica do mal'
        );
    });
});

describe('titleYearsCompatible', () => {
    it('accepts unknown years and ±1 tolerance', () => {
        expect(titleYearsCompatible(null, 2049)).toBe(true);
        expect(titleYearsCompatible(1999, undefined)).toBe(true);
        expect(titleYearsCompatible(1999, 2000)).toBe(true);
    });

    it('rejects contradicting years', () => {
        expect(titleYearsCompatible(1982, 2049)).toBe(false);
    });
});
