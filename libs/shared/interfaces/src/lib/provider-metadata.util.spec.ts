import {
    firstProviderText,
    readProviderRating,
    readProviderText,
} from './provider-metadata.util';

describe('readProviderText', () => {
    it.each([undefined, null, '', '   ', 'N/A', 'n/a', ' N/a ', '-', ' - '])(
        'reads %p as absent',
        (value) => {
            expect(readProviderText(value)).toBeUndefined();
        }
    );

    it('trims real text and keeps a value that only contains a stand-in', () => {
        expect(readProviderText('  Drama ')).toBe('Drama');
        expect(readProviderText('Sci-Fi')).toBe('Sci-Fi');
        expect(readProviderText('N/A Studios')).toBe('N/A Studios');
    });

    it('reads finite numbers as text and nothing else', () => {
        expect(readProviderText(2011)).toBe('2011');
        expect(readProviderText(0)).toBe('0');
        expect(readProviderText(Number.NaN)).toBeUndefined();
        expect(readProviderText({})).toBeUndefined();
    });
});

describe('firstProviderText', () => {
    it('skips placeholders and blanks to reach the usable fallback', () => {
        expect(firstProviderText('N/A', '', '  ', '2011')).toBe('2011');
        expect(firstProviderText('-', undefined)).toBeUndefined();
    });
});

describe('readProviderRating', () => {
    it.each(['0', '0.0', '0,0', 0, 'N/A', '-', ''])(
        'reads %p as unrated',
        (value) => {
            expect(readProviderRating(value)).toBeUndefined();
        }
    );

    it('keeps real scores as the provider wrote them', () => {
        expect(readProviderRating('7.4')).toBe('7.4');
        expect(readProviderRating('6,8')).toBe('6,8');
        expect(readProviderRating(8)).toBe('8');
    });
});
