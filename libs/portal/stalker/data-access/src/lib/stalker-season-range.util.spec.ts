import { hasSeasonRangeInTitle } from './stalker-season-range.util';

describe('hasSeasonRangeInTitle', () => {
    it.each([
        'The Office (1-9 season)',
        'The Office (1–9 season)',
        'Офис (1-9 сезон)',
        'The Office Seasons 1-9',
        'The Office S01-S09',
    ])('recognizes the multi-season range %s', (title) => {
        expect(hasSeasonRangeInTitle(title)).toBe(true);
    });
    it.each([
        'The Boys S02',
        'The Boys (2 season)',
        '2001-2009',
        'Seasons 2-2',
        null,
    ])('does not mark a single season or ordinary range %s', (title) => {
        expect(hasSeasonRangeInTitle(title)).toBe(false);
    });
});
