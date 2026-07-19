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
        expect(normalizeTitle('4K-DE - The Pitt (2025) (US)')).toBe(
            'the pitt'
        );
        expect(normalizeTitle('AR-SUBS - Fallout (2024) (US)')).toBe(
            'fallout'
        );
        expect(normalizeTitle('4K-OSN+ - The Last of Us (2023)')).toBe(
            'the last of us'
        );
    });

    it('never treats numeric fragments as leading tags', () => {
        expect(normalizeTitle('1917 - Behind the Lines')).toBe(
            '1917 behind the lines'
        );
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

    it('strips joined dash tags only for case-uniform vocabulary tokens', () => {
        expect(normalizeTitle('Breaking Bad-eng')).toBe('breaking bad');
        expect(normalizeTitle('The Last of Us-DE')).toBe('the last of us');
        expect(normalizeTitle('The Pitt (2025)-it')).toBe('the pitt');
        expect(normalizeTitle('Spider-Man')).toBe('spider man');
        expect(normalizeTitle('Kick-It')).toBe('kick it');
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
        'The Pitt (2025)_sub', 'The Pitt (2025)-it', 'The Pitt (2025)',
        'The Pitt (Hindi)', 'The Pitt (2025) 4K', 'The Pitt (2025) DE',
        'The Pitt (2025) ES', 'The Pitt (2025) FR', 'The Pitt (2025)_eng',
        'The Pitt [MULTI-SUB]', 'The Pitt (2025) (4K DV)', 'GR - The Pitt',
        '4K-DE - The Pitt (2025) (US)', '4K-TR - The Pitt (2025) (US)',
        'AR-SUBS - The Pitt (2025) (US)', 'DE - The Pitt (2025) (US)',
        'ALB| The Pitt', 'EXYU| The Pitt', '|ALB| The Pitt', '|DE| The Pitt',
    ];

    const falloutCorpus = [
        'Fallout', 'DE - Fallout (2024)', 'Fallout (2024) - 4K',
        'Fallout (2024) FR-EN', 'Fallout (2024) Multi', 'Fallout (2024)_fr',
        'Fallout_esp', 'Fallout (4K)', '4K-AMZ - Fallout (2024) (US)',
        'AL - Fallout (2024)', 'AMZ - Fallout (2024) (US)',
        'AR-DE - Fallout (US)', 'LA - Fallout', 'EN| Fallout - 4K',
        'MULTI| Fallout - 4K', 'Fallout ( مدبلج )', 'Fallout (Telugu)',
        '|EN| Fallout - 4K', '|MULTI| Fallout', '|TR| Fallout',
    ];

    const lastOfUsCorpus = [
        'The Last of Us', 'The Last Of Us', 'The Last of Us (2023) 4K',
        'The Last of Us (2023) AF', 'The Last of Us_tr',
        'The Last of Us--esp', 'The Last of Us-DE', 'The Last of Us-esp',
        'The Last of Us [L]', 'The Last of Us ( HD )',
        '4K-OSN+ - The Last of Us (2023)', 'IS - The Last of Us (2023) (US)',
        'RU - The Last of Us', 'ALB| The Last of Us',
    ];

    const breakingBadCorpus = [
        'Breaking Bad', 'Breaking Bad (2008)_fr', 'Breaking Bad (US)_msub',
        'Breaking Bad_it', 'Breaking Bad-DE', 'Breaking Bad-eng',
        'Breaking Bad ( عائلي )', 'Breaking Bad (Pure)',
        'Breaking Bad - Multi', 'Breaking Bad ES', 'AR-DE - Breaking Bad',
        'EN| Breaking Bad SUB', 'MULTI| Breaking Bad', 'AR| Breaking Bad',
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
