import {
    applyChannelNameStrip,
    stripCountryPrefix,
} from './strip-country-prefix.util';

describe('stripCountryPrefix', () => {
    describe('pipe separators', () => {
        it('strips a "XX | " prefix', () => {
            expect(stripCountryPrefix('US | CNN')).toBe('CNN');
        });

        it('strips a bare-pipe prefix', () => {
            expect(stripCountryPrefix('FR|TF1')).toBe('TF1');
        });

        it('strips a wrapped tag like "|DE| ARD"', () => {
            expect(stripCountryPrefix('|DE| ARD')).toBe('ARD');
        });

        it('strips long prefixes before a pipe', () => {
            expect(stripCountryPrefix('US East | CNN')).toBe('CNN');
        });

        it('only strips up to the first pipe', () => {
            expect(stripCountryPrefix('US | CNN | HD')).toBe('CNN | HD');
        });
    });

    describe('dash and colon separators (short-tag prefixes only)', () => {
        it('strips a two-letter country tag', () => {
            expect(stripCountryPrefix('UK - BBC One')).toBe('BBC One');
        });

        it('strips a three-letter country tag', () => {
            expect(stripCountryPrefix('USA - CNN')).toBe('CNN');
        });

        it('strips alphanumeric tags like 4K', () => {
            expect(stripCountryPrefix('4K - Discovery')).toBe('Discovery');
        });

        it('strips a colon-separated tag', () => {
            expect(stripCountryPrefix('US: CNN')).toBe('CNN');
        });

        it('strips compound quality/provider tags', () => {
            expect(stripCountryPrefix('4K-DE - The Pitt (2025)')).toBe(
                'The Pitt (2025)'
            );
            expect(stripCountryPrefix('AR-SUBS - Fallout')).toBe('Fallout');
            expect(stripCountryPrefix('4K-OSN+ - The Last of Us')).toBe(
                'The Last of Us'
            );
        });

        it('strips longer pipe-tagged prefixes', () => {
            expect(stripCountryPrefix('EXYU| News')).toBe('News');
            expect(stripCountryPrefix('MULTI| Movies')).toBe('Movies');
        });

        it('never treats numeric fragments as tags', () => {
            expect(stripCountryPrefix('1917 - Documentary')).toBe(
                '1917 - Documentary'
            );
        });

        it('keeps bare 4-5 char words before a spaced dash (real titles)', () => {
            expect(stripCountryPrefix('DUNE - Part Two')).toBe(
                'DUNE - Part Two'
            );
            expect(stripCountryPrefix('ALIEN - Covenant')).toBe(
                'ALIEN - Covenant'
            );
        });

        it('only strips the first tag segment', () => {
            expect(stripCountryPrefix('ES - A3 - Sports')).toBe('A3 - Sports');
        });

        it('keeps names whose prefix is not a short uppercase tag', () => {
            expect(stripCountryPrefix('Sky - Sports F1')).toBe(
                'Sky - Sports F1'
            );
            expect(stripCountryPrefix('Discovery - Science')).toBe(
                'Discovery - Science'
            );
            expect(stripCountryPrefix('Mission: Impossible - Fallout')).toBe(
                'Mission: Impossible - Fallout'
            );
        });

        it('keeps hyphenated names without separator spacing', () => {
            expect(stripCountryPrefix('T-Mobile TV')).toBe('T-Mobile TV');
            expect(stripCountryPrefix('US-CNN')).toBe('US-CNN');
        });

        it('keeps single-character prefixes', () => {
            expect(stripCountryPrefix('A - Team')).toBe('A - Team');
        });
    });

    describe('edge cases', () => {
        it('returns names without separators unchanged', () => {
            expect(stripCountryPrefix('BBC One')).toBe('BBC One');
        });

        it('trims surrounding whitespace', () => {
            expect(stripCountryPrefix('  BBC One  ')).toBe('BBC One');
        });

        it('returns the original name when stripping would leave nothing', () => {
            expect(stripCountryPrefix('US | ')).toBe('US |');
        });

        it('handles empty input', () => {
            expect(stripCountryPrefix('')).toBe('');
            expect(stripCountryPrefix('   ')).toBe('');
        });
    });
});

describe('applyChannelNameStrip', () => {
    it('strips when enabled', () => {
        expect(applyChannelNameStrip('US | CNN', true)).toBe('CNN');
    });

    it('returns the raw name when disabled', () => {
        expect(applyChannelNameStrip('US | CNN', false)).toBe('US | CNN');
        expect(applyChannelNameStrip('US | CNN', undefined)).toBe('US | CNN');
        expect(applyChannelNameStrip('US | CNN', null)).toBe('US | CNN');
    });

    it('normalizes nullish names to an empty string', () => {
        expect(applyChannelNameStrip(null, true)).toBe('');
        expect(applyChannelNameStrip(undefined, false)).toBe('');
    });
});
