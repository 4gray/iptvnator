import { hasSeasonRangeInTitle } from './stalker-season-range.util';

describe('hasSeasonRangeInTitle', () => {
    it.each([
        'Synthetic Series Alpha (1-9 season)',
        'Synthetic Series Alpha (1–9 season)',
        'Тестовый сериал Альфа (1-9 сезон)',
        'Synthetic Series Alpha Seasons 1-9',
        'Synthetic Series Alpha S01-S09',
    ])('recognizes the multi-season range %s', (title) => {
        expect(hasSeasonRangeInTitle(title)).toBe(true);
    });
    it.each([
        'Synthetic Series Beta S02',
        'Synthetic Series Beta (2 season)',
        '2001-2009',
        'Seasons 2-2',
        null,
    ])('does not mark a single season or ordinary range %s', (title) => {
        expect(hasSeasonRangeInTitle(title)).toBe(false);
    });
});
