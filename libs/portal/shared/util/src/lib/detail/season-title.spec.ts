import { splitSeasonSuffix } from './season-title';

describe('splitSeasonSuffix', () => {
    it.each([
        ['Большая фарма (1 сезон)', 'Большая фарма', 1],
        ['Родители родителей 2 сезон', 'Родители родителей', 2],
        ['Родители родителей (сезон 3)', 'Родители родителей', 3],
        ['Big Pharma Season 2', 'Big Pharma', 2],
        ['Big Pharma - Season 12', 'Big Pharma', 12],
        ['Big Pharma [Season 4]', 'Big Pharma', 4],
        ['Big Pharma S02', 'Big Pharma', 2],
        ['La casa de papel: Temporada 5', 'La casa de papel', 5],
        ['Dark Staffel 3', 'Dark', 3],
    ])('strips %s', (raw, title, season) => {
        expect(splitSeasonSuffix(raw)).toEqual({ title, season });
    });

    it.each([
        'S.W.A.T.',
        'Area 51',
        'Season of the Witch',
        'Fast 9',
        '24',
        'The 100',
    ])('leaves %s alone', (raw) => {
        expect(splitSeasonSuffix(raw)).toEqual({ title: raw, season: null });
    });

    it('keeps a title that is only a season marker', () => {
        expect(splitSeasonSuffix('Season 2')).toEqual({
            title: 'Season 2',
            season: null,
        });
    });

    it('trims and tolerates empty input', () => {
        expect(splitSeasonSuffix('  ')).toEqual({ title: '', season: null });
        expect(splitSeasonSuffix(undefined)).toEqual({ title: '', season: null });
    });
});
