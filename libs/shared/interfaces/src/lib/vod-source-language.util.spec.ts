import {
    isKnownLanguageTag,
    titleLanguagePrefix,
    unambiguousCategoryLanguage,
    vodSourceLanguage,
} from './vod-source-language.util';

describe('titleLanguagePrefix', () => {
    it('reads the tag before a pipe, any case', () => {
        expect(titleLanguagePrefix('EN| Night of the Living Dead')).toBe('EN');
        expect(titleLanguagePrefix('ALB |Some Movie')).toBe('ALB');
        expect(titleLanguagePrefix('  ru| Ночь')).toBe('RU');
    });

    it('reads Cyrillic tags', () => {
        expect(titleLanguagePrefix('РУС | Фильм')).toBe('РУС');
        expect(titleLanguagePrefix('укр| Фільм')).toBe('УКР');
    });

    it('reads Unicode pipe lookalikes as the separator', () => {
        expect(titleLanguagePrefix('EN │ Movie')).toBe('EN');
        expect(titleLanguagePrefix('DE ¦ Der Film')).toBe('DE');
        expect(titleLanguagePrefix('FR｜Le Film')).toBe('FR');
    });

    it('reads a bracketed tag at the start', () => {
        expect(titleLanguagePrefix('[EN] Movie')).toBe('EN');
        expect(titleLanguagePrefix('(ru) Ночь')).toBe('RU');
        // A bracket deeper in the title is not a prefix.
        expect(titleLanguagePrefix('Movie [EN]')).toBeNull();
    });

    it('requires the brackets to pair', () => {
        // Openers and closers matched independently would accept these.
        expect(titleLanguagePrefix('[EN) Movie')).toBeNull();
        expect(titleLanguagePrefix('(DE] Film')).toBeNull();
    });

    it('reads an uppercase tag before a spaced dash, and only that form', () => {
        expect(titleLanguagePrefix('EN - Movie')).toBe('EN');
        expect(titleLanguagePrefix('РУС - Фильм')).toBe('РУС');
        // Lowercase before a dash is a title word ("Up - the movie").
        expect(titleLanguagePrefix('Up - the movie')).toBeNull();
        // Unspaced dashes are ordinary punctuation.
        expect(titleLanguagePrefix('X-Men')).toBeNull();
        expect(titleLanguagePrefix('EN-Movie')).toBeNull();
    });

    it('gates bracket and dash tags to known languages', () => {
        // Brackets and dashes are where quality and rip tags live; taking
        // them at their word would fabricate an "HD" language that outranks
        // and masks a real category-derived one.
        expect(titleLanguagePrefix('[HD] Dune')).toBeNull();
        expect(titleLanguagePrefix('[UHD] Dune')).toBeNull();
        expect(titleLanguagePrefix('[CAM] Dune')).toBeNull();
        expect(titleLanguagePrefix('NEW - Dune')).toBeNull();
        expect(titleLanguagePrefix('VIP - Dune')).toBeNull();
        // The legacy pipe form stays permissive — tightening it would drop
        // filter options that work today.
        expect(titleLanguagePrefix('SNF| Dune')).toBe('SNF');
    });

    it('accepts the MULTI marker despite its five letters', () => {
        expect(titleLanguagePrefix('MULTI | Movie')).toBe('MULTI');
        expect(titleLanguagePrefix('Multi| Movie')).toBe('MULTI');
    });

    it('rejects titles whose separator is not a language marker', () => {
        // Five letters is a word, not a language code.
        expect(titleLanguagePrefix('NIGHT| of something')).toBeNull();
        expect(titleLanguagePrefix('Night of the Living Dead')).toBeNull();
        expect(titleLanguagePrefix('4K| Movie')).toBeNull();
        expect(titleLanguagePrefix(undefined)).toBeNull();
        expect(titleLanguagePrefix('')).toBeNull();
    });
});

describe('isKnownLanguageTag', () => {
    it('accepts assigned two-letter ISO codes in any case', () => {
        expect(isKnownLanguageTag('EN')).toBe(true);
        expect(isKnownLanguageTag('de')).toBe(true);
        expect(isKnownLanguageTag('uk')).toBe(true);
    });

    it('rejects unassigned two-letter tokens', () => {
        expect(isKnownLanguageTag('HD')).toBe(false);
        expect(isKnownLanguageTag('XX')).toBe(false);
    });

    it('accepts curated long tags, Latin and Cyrillic', () => {
        expect(isKnownLanguageTag('ENG')).toBe(true);
        expect(isKnownLanguageTag('DEU')).toBe(true);
        expect(isKnownLanguageTag('LAT')).toBe(true);
        expect(isKnownLanguageTag('РУС')).toBe(true);
        expect(isKnownLanguageTag('MULTI')).toBe(true);
    });

    it('rejects the content-type prefixes categories actually use', () => {
        // The four the gate turns away most often on a real catalog; without
        // it the language select offers "VOD" and "KIDS".
        for (const tag of ['VOD', 'KIDS', 'SHOW', 'WWE']) {
            expect(isKnownLanguageTag(tag)).toBe(false);
        }
    });

    it('rejects everyday category words that are real ISO 639-3 codes', () => {
        // `new`, `top` and `hot` are assigned in ISO 639-3, which is exactly
        // why validation is curated instead of registry-driven.
        expect(isKnownLanguageTag('NEW')).toBe(false);
        expect(isKnownLanguageTag('TOP')).toBe(false);
        expect(isKnownLanguageTag('HOT')).toBe(false);
        expect(isKnownLanguageTag('VIP')).toBe(false);
        expect(isKnownLanguageTag('KIDS')).toBe(false);
    });
});

describe('unambiguousCategoryLanguage', () => {
    it('reads the language every prefixed category agrees on', () => {
        expect(
            unambiguousCategoryLanguage(['EN | Netflix', 'EN | Action'])
        ).toBe('EN');
    });

    it('lets unprefixed categories abstain rather than veto', () => {
        expect(
            unambiguousCategoryLanguage(['EN | Netflix', 'Netflix 4K'])
        ).toBe('EN');
    });

    it('yields nothing on a conflict', () => {
        expect(
            unambiguousCategoryLanguage(['EN | Netflix', 'DE | Cinema'])
        ).toBeNull();
    });

    it('rejects category prefixes that are not languages', () => {
        expect(unambiguousCategoryLanguage(['NEW | 2024'])).toBeNull();
        expect(unambiguousCategoryLanguage(['TOP | 250'])).toBeNull();
        expect(unambiguousCategoryLanguage(['VIP | Cinema'])).toBeNull();
        // ...while a real language beside them still reads through.
        expect(
            unambiguousCategoryLanguage(['NEW | 2024', 'DE | Apple TV'])
        ).toBe('DE');
    });

    it('handles empty and missing input', () => {
        expect(unambiguousCategoryLanguage([])).toBeNull();
        expect(unambiguousCategoryLanguage(null)).toBeNull();
        expect(unambiguousCategoryLanguage(undefined)).toBeNull();
        expect(unambiguousCategoryLanguage([null, ''])).toBeNull();
    });
});

describe('vodSourceLanguage', () => {
    it('prefers the title prefix over the category language', () => {
        expect(
            vodSourceLanguage({
                rawTitle: 'RU| Movie',
                categoryLanguage: 'EN',
            })
        ).toBe('RU');
    });

    it('falls back to the category language when the title says nothing', () => {
        expect(
            vodSourceLanguage({ rawTitle: 'Movie', categoryLanguage: 'EN' })
        ).toBe('EN');
    });

    it('yields nothing when neither side knows', () => {
        expect(vodSourceLanguage({ rawTitle: 'Movie' })).toBeNull();
        expect(vodSourceLanguage({})).toBeNull();
    });
});
