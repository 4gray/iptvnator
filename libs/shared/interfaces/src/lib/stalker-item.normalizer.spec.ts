import {
    extractStalkerItemType,
    isStalkerRadioItem,
    normalizeStalkerDate,
} from './stalker-item.normalizer';

describe('extractStalkerItemType', () => {
    it('treats Stalker radio stations as live collection items', () => {
        expect(
            extractStalkerItemType({
                id: '40001',
                title: 'Jazz Radio',
                category_id: 'radio',
                radio: true,
            })
        ).toBe('live');
        expect(
            extractStalkerItemType({
                id: '40002',
                title: 'Rock Radio',
                category_id: 'radio-genre-1',
                radio: 'true',
            })
        ).toBe('live');
    });
});

describe('isStalkerRadioItem', () => {
    it('does not infer radio from a generic HTTP path segment', () => {
        expect(
            isStalkerRadioItem({
                id: '77',
                title: 'News Channel',
                cmd: 'https://media.example.com/live/radio/news/index.m3u8',
            })
        ).toBe(false);
    });
});

describe('normalizeStalkerDate', () => {
    it('normalizes SQLite UTC timestamps without relying on engine-specific parsing', () => {
        const originalParse = Date.parse;
        const parseSpy = jest
            .spyOn(Date, 'parse')
            .mockImplementation((value: string) => {
                if (value === '2026-04-21 22:49:02') {
                    return Number.NaN;
                }

                return originalParse(value);
            });

        expect(normalizeStalkerDate('2026-04-21 22:49:02')).toBe(
            '2026-04-21T22:49:02.000Z'
        );
        expect(parseSpy).not.toHaveBeenCalledWith('2026-04-21 22:49:02');
    });

    it('preserves fractional seconds in SQLite UTC timestamps', () => {
        expect(normalizeStalkerDate('2026-04-21 22:49:02.7')).toBe(
            '2026-04-21T22:49:02.700Z'
        );
    });
});
