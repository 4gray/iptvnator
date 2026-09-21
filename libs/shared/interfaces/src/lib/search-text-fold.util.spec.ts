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
        ['Ёжик', 'ёжик'],
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

    it.each([
        ['Amélie', 'Amélie'],
        ['İnşaat', 'İnşaat'],
        ['Ёжик', 'Ёжик'],
        ['Йога', 'Йога'],
        ['Ünlü', 'Ünlü'],
        ['Ά', 'Ά'],
    ])(
        'folds canonically equivalent spellings of %s to one string',
        (precomposed, decomposed) => {
            expect(foldSearchText(decomposed)).toBe(
                foldSearchText(precomposed)
            );
        }
    );

    it('stays accent-sensitive, unlike the diacritic-folding SQL index', () => {
        // The renderer filters were accent-sensitive before this helper and
        // stay so: only marks that cannot compose are dropped. Accent-blind
        // matching is the FTS index's own behaviour, not this fold's.
        expect(foldSearchText('Amélie')).not.toBe(foldSearchText('Amelie'));
    });

    it('does not fold the dotless ı onto i', () => {
        // The Turkish I/ı pair is a separate letter, not a case form of i;
        // it is deliberately left alone (see the FTS index, which does not
        // fold it either).
        expect(foldSearchText('Işık')).toBe('işık');
        expect(foldSearchText('ışık')).toBe('ışık');
    });
});
