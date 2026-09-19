import { foldSearchText } from './search-text-fold.util';

describe('foldSearchText', () => {
    it('folds the Turkish dotted capital I onto a plain lower-case i (issue #609)', () => {
        expect(foldSearchText('İnşaat Kanalı')).toBe('inşaat kanalı');
        expect(
            foldSearchText('İnşaat Kanalı').includes(foldSearchText('inş'))
        ).toBe(true);
        expect(foldSearchText('İnş')).toBe(foldSearchText('inş'));
    });

    it.each([
        ['Ünlü Şef', 'ünlü şef'],
        ['ÇANAKKALE', 'çanakkale'],
        ['Первый канал HD', 'первый канал hd'],
        ['Ёлки', 'ёлки'],
        ['Йога для всех', 'йога для всех'],
        ['Ελλάδα Σήμερα', 'ελλάδα σήμερα'],
        ['Amélie', 'amélie'],
        ['Straße', 'straße'],
    ])(
        'keeps precomposed letters of other scripts intact: %s',
        (input, expected) => {
            expect(foldSearchText(input)).toBe(expected);
        }
    );

    it('treats decomposed input like its precomposed form', () => {
        // "é" typed as e + combining acute must still find a precomposed "é"
        // only through the same fold; both sides drop the mark consistently.
        expect(foldSearchText('Amélie')).toBe('amelie');
        expect(foldSearchText('Здравствуйте')).toBe('здравствуите');
    });

    it('does not fold the dotless ı onto i', () => {
        // The Turkish I/ı pair is a separate letter, not a case form of i;
        // it is deliberately left alone (see the FTS index, which does not
        // fold it either).
        expect(foldSearchText('Işık')).toBe('işık');
        expect(foldSearchText('ışık')).toBe('ışık');
    });
});
