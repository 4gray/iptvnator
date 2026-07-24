import {
    extractSeasonFromTitle,
    resolveEnrichmentSeasonNumber,
} from './season-marker.util';

describe('extractSeasonFromTitle', () => {
    it('reads bracketed number-first markers', () => {
        expect(extractSeasonFromTitle('The Mandalorian (2 season)')).toBe(2);
        expect(extractSeasonFromTitle('Кухня (6 сезон)')).toBe(6);
    });

    it('reads word-first markers with any joiner', () => {
        expect(extractSeasonFromTitle('Breaking Bad Season 2')).toBe(2);
        expect(extractSeasonFromTitle('Breaking Bad season_02')).toBe(2);
        expect(extractSeasonFromTitle('Breaking Bad season2')).toBe(2);
        expect(extractSeasonFromTitle('Мандалорец сезон 2')).toBe(2);
        expect(extractSeasonFromTitle('Dark Staffel 3')).toBe(3);
        expect(extractSeasonFromTitle('La Casa Temporada 4')).toBe(4);
    });

    it('reads number-first markers including ordinals', () => {
        expect(extractSeasonFromTitle('The Boys 2 Season')).toBe(2);
        expect(extractSeasonFromTitle('The Boys 2nd Season')).toBe(2);
        expect(extractSeasonFromTitle('Пацаны 2 сезон')).toBe(2);
        expect(extractSeasonFromTitle('Пацаны 2-й сезон')).toBe(2);
    });

    it('reads S-form markers, including S..E.. episode tags', () => {
        expect(extractSeasonFromTitle('The Boys S05')).toBe(5);
        expect(extractSeasonFromTitle('Gintama s2')).toBe(2);
        expect(extractSeasonFromTitle('[S03] Dark')).toBe(3);
        expect(extractSeasonFromTitle('Dark S02E05')).toBe(2);
    });

    it('never fires on titles without an explicit marker', () => {
        expect(extractSeasonFromTitle('The Mandalorian')).toBeNull();
        expect(extractSeasonFromTitle("Ocean's 11")).toBeNull();
        expect(extractSeasonFromTitle('Cars 2')).toBeNull();
        expect(extractSeasonFromTitle('The 4400')).toBeNull();
        expect(extractSeasonFromTitle('The Four Seasons')).toBeNull();
        expect(extractSeasonFromTitle('2 Fast 2 Furious')).toBeNull();
        expect(extractSeasonFromTitle('2001: A Space Odyssey')).toBeNull();
        expect(extractSeasonFromTitle('')).toBeNull();
        expect(extractSeasonFromTitle(null)).toBeNull();
    });

    it('rejects plurals, word-internal hits and season zero', () => {
        expect(extractSeasonFromTitle('Best of 2 Seasons')).toBeNull();
        expect(extractSeasonFromTitle('Postseason 3')).toBeNull();
        expect(extractSeasonFromTitle('Dark S00')).toBeNull();
    });
});

describe('resolveEnrichmentSeasonNumber', () => {
    it('overrides a renumbered single-season slice with the title season', () => {
        expect(
            resolveEnrichmentSeasonNumber({
                rawTitle: 'The Mandalorian (2 season)',
                providerSeasonNumber: 1,
                providerSeasonCount: 1,
            })
        ).toBe(2);
    });

    it('keeps provider numbering for multi-season items', () => {
        expect(
            resolveEnrichmentSeasonNumber({
                rawTitle: 'The Mandalorian (2 season)',
                providerSeasonNumber: 1,
                providerSeasonCount: 3,
            })
        ).toBe(1);
    });

    it('keeps provider numbering when the marker agrees with it', () => {
        expect(
            resolveEnrichmentSeasonNumber({
                rawTitle: 'The Mandalorian (2 season)',
                providerSeasonNumber: 2,
                providerSeasonCount: 1,
            })
        ).toBe(2);
    });

    it('keeps provider numbering without a title marker', () => {
        expect(
            resolveEnrichmentSeasonNumber({
                rawTitle: 'The Mandalorian',
                providerSeasonNumber: 1,
                providerSeasonCount: 1,
            })
        ).toBe(1);
    });
});
