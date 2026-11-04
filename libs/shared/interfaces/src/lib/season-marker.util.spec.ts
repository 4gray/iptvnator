import {
    extractSeasonFromTitle,
    pickSeasonMarkedTitle,
    resolveEnrichmentSeasonNumber,
} from './season-marker.util';

describe('extractSeasonFromTitle', () => {
    it('retains historical numeric grouping for persisted episode coordinates', () => {
        expect(
            extractSeasonFromTitle('Synthetic Series Alpha (1-9 season)')
        ).toBe(9);
    });
    it('reads bracketed number-first markers', () => {
        expect(extractSeasonFromTitle('Synthetic Series Beta (2 season)')).toBe(
            2
        );
        expect(extractSeasonFromTitle('Тестовый сериал Бета (6 сезон)')).toBe(
            6
        );
    });

    it('reads word-first markers with any joiner', () => {
        expect(extractSeasonFromTitle('Synthetic Series Gamma Season 2')).toBe(
            2
        );
        expect(extractSeasonFromTitle('Synthetic Series Gamma season_02')).toBe(
            2
        );
        expect(extractSeasonFromTitle('Synthetic Series Gamma season2')).toBe(
            2
        );
        expect(extractSeasonFromTitle('Тестовый сериал Гамма сезон 2')).toBe(2);
        expect(extractSeasonFromTitle('Synthetic Series Delta Staffel 3')).toBe(
            3
        );
        expect(
            extractSeasonFromTitle('Synthetic Series Epsilon Temporada 4')
        ).toBe(4);
    });

    it('reads number-first markers including ordinals', () => {
        expect(extractSeasonFromTitle('Synthetic Series Zeta 2 Season')).toBe(
            2
        );
        expect(extractSeasonFromTitle('Synthetic Series Zeta 2nd Season')).toBe(
            2
        );
        expect(extractSeasonFromTitle('Тестовый сериал Дельта 2 сезон')).toBe(
            2
        );
        expect(extractSeasonFromTitle('Тестовый сериал Дельта 2-й сезон')).toBe(
            2
        );
    });

    it('reads S-form markers, including S..E.. episode tags', () => {
        expect(extractSeasonFromTitle('Synthetic Series Zeta S05')).toBe(5);
        expect(extractSeasonFromTitle('Synthetic Series Eta s2')).toBe(2);
        expect(extractSeasonFromTitle('[S03] Synthetic Series Delta')).toBe(3);
        expect(extractSeasonFromTitle('Synthetic Series Delta S02E05')).toBe(2);
    });

    it('never fires on titles without an explicit marker', () => {
        expect(extractSeasonFromTitle('Synthetic Series Beta')).toBeNull();
        expect(extractSeasonFromTitle('Synthetic Heist 11')).toBeNull();
        expect(extractSeasonFromTitle('Synthetic Race 2')).toBeNull();
        expect(extractSeasonFromTitle('Synthetic 4400')).toBeNull();
        expect(extractSeasonFromTitle('Synthetic Four Seasons')).toBeNull();
        expect(extractSeasonFromTitle('2 Synthetic 2 Example')).toBeNull();
        expect(extractSeasonFromTitle('2001: Synthetic Voyage')).toBeNull();
        expect(extractSeasonFromTitle('')).toBeNull();
        expect(extractSeasonFromTitle(null)).toBeNull();
    });

    it('rejects plurals, word-internal hits and season zero', () => {
        expect(extractSeasonFromTitle('Best of 2 Seasons')).toBeNull();
        expect(extractSeasonFromTitle('Postseason 3')).toBeNull();
        expect(extractSeasonFromTitle('Synthetic Series Delta S00')).toBeNull();
    });
});

describe('pickSeasonMarkedTitle', () => {
    it.each([
        ['Show S01', 'Show (1-9 season)', 'Show S01'],
        ['Show Seasons 1-9', 'Show (1-9 season)', 'Show (1-9 season)'],
    ])(
        'preserves historical numeric title choice for %s / %s',
        (name, original, expected) => {
            expect(pickSeasonMarkedTitle(name, original)).toBe(expected);
        }
    );
    it('retains a range carried only by the original title', () => {
        expect(
            pickSeasonMarkedTitle(
                'Synthetic Series Alpha',
                'Synthetic Series Alpha (1-9 season)'
            )
        ).toBe('Synthetic Series Alpha (1-9 season)');
    });
    it('prefers the title that carries a season marker', () => {
        expect(
            pickSeasonMarkedTitle(
                'Regular Series',
                'Synthetic Series Beta (2 season)'
            )
        ).toBe('Synthetic Series Beta (2 season)');
        expect(
            pickSeasonMarkedTitle(
                'Synthetic Series Zeta S05',
                'Synthetic Series Zeta'
            )
        ).toBe('Synthetic Series Zeta S05');
    });

    it('falls back to the first non-empty title without markers', () => {
        expect(pickSeasonMarkedTitle(undefined, 'Synthetic Series Beta')).toBe(
            'Synthetic Series Beta'
        );
        expect(pickSeasonMarkedTitle('', null)).toBeNull();
    });
});

describe('resolveEnrichmentSeasonNumber', () => {
    it('overrides a renumbered single-season slice with the title season', () => {
        expect(
            resolveEnrichmentSeasonNumber({
                rawTitle: 'Synthetic Series Beta (2 season)',
                providerSeasonNumber: 1,
                providerSeasonCount: 1,
            })
        ).toBe(2);
    });

    it('keeps provider numbering for multi-season items', () => {
        expect(
            resolveEnrichmentSeasonNumber({
                rawTitle: 'Synthetic Series Beta (2 season)',
                providerSeasonNumber: 1,
                providerSeasonCount: 3,
            })
        ).toBe(1);
    });

    it('keeps provider numbering when the marker agrees with it', () => {
        expect(
            resolveEnrichmentSeasonNumber({
                rawTitle: 'Synthetic Series Beta (2 season)',
                providerSeasonNumber: 2,
                providerSeasonCount: 1,
            })
        ).toBe(2);
    });

    it('keeps provider numbering without a title marker', () => {
        expect(
            resolveEnrichmentSeasonNumber({
                rawTitle: 'Synthetic Series Beta',
                providerSeasonNumber: 1,
                providerSeasonCount: 1,
            })
        ).toBe(1);
    });
});
