import { M3U_ENTRY_CORPUS } from './m3u-entry-corpus.spec-data';
import { parseM3uEpisode } from './m3u-episode-parse.util';

describe('parseM3uEpisode', () => {
    describe('against the provider corpus', () => {
        const episodes = M3U_ENTRY_CORPUS.filter(
            (entry) => entry.kind === 'episode'
        );

        it.each(episodes.map((entry) => [entry.name, entry] as const))(
            '%s',
            (_name, entry) => {
                const parsed = parseM3uEpisode(entry.name);

                expect(parsed).not.toBeNull();
                expect(parsed?.seriesTitle).toBe(entry.episode?.seriesTitle);
                expect(parsed?.seasonNumber).toBe(entry.episode?.season);
                expect(parsed?.episodeNumber).toBe(entry.episode?.episode);
                expect(parsed?.hasExplicitSeason).toBe(
                    entry.episode?.hasExplicitSeason
                );
            }
        );

        it('finds no episode in a name that carries no marker', () => {
            // Every corpus row the classifier does NOT route here, minus the
            // ones whose names deliberately mimic a marker — those are the
            // next test.
            const unmarked = M3U_ENTRY_CORPUS.filter(
                (entry) =>
                    entry.kind !== 'episode' &&
                    !/(s\d+\s*e\d+|b[öo]l[üu]m|episode|season|\dx\d\d)/i.test(
                        entry.name
                    )
            );

            expect(unmarked.length).toBeGreaterThan(5);
            for (const entry of unmarked) {
                expect(parseM3uEpisode(entry.name)).toBeNull();
            }
        });

        it('leaves the marker-mimicking rows to the classifier', () => {
            // Two shapes reach this function only because a test calls it
            // directly: a live channel named "MTV S1 E1", and a film named
            // "KILL BILL: BÖLÜM 2" — Turkish writes film instalments where
            // English writes "Part 2". Both are settled by classifyM3uEntry,
            // which has the URL; re-deciding them here would duplicate the
            // rule, and a duplicated rule eventually disagrees with itself.
            // So the parser reads the name it is given and says what it
            // sees.
            const trap = M3U_ENTRY_CORPUS.filter(
                (entry) =>
                    entry.kind !== 'episode' &&
                    /(s\d+\s*e\d+|b[öo]l[üu]m\s*\d)/i.test(entry.name)
            );

            expect(trap.length).toBeGreaterThan(0);
            for (const entry of trap) {
                expect(parseM3uEpisode(entry.name)).not.toBeNull();
            }
        });
    });

    describe('marker spellings', () => {
        it.each([
            ['Dark S02E03', 'Dark', 2, 3, true],
            ['Dark s02.e03', 'Dark', 2, 3, true],
            ['Dark S2-E3', 'Dark', 2, 3, true],
            ['The Office 1x02', 'The Office', 1, 2, true],
            ['Tatort Staffel 2 Folge 12', 'Tatort', 2, 12, true],
            ['Tatort Folge 12', 'Tatort', 1, 12, false],
            ['Друзья 12 серия', 'Друзья', 1, 12, false],
            ['DELIKANLI 5.BÖLÜM', 'DELIKANLI', 1, 5, false],
            ['UZAK SEHIR 120.BÖLÜM', 'UZAK SEHIR', 1, 120, false],
            ['La Casa Capitulo 4', 'La Casa', 1, 4, false],
            ['DELIKANLI 7.BÖLÜM FINAL', 'DELIKANLI', 1, 7, false],
            // Pilots and specials are numbered E0 by real providers; the
            // app already treats season zero as a valid Specials
            // coordinate, so episode zero is kept too.
            ['TR:SHERLOCK S4 E0', 'TR:SHERLOCK', 4, 0, true],
        ])('%s', (name, title, season, episode, explicit) => {
            expect(parseM3uEpisode(name)).toEqual(
                expect.objectContaining({
                    seriesTitle: title,
                    seasonNumber: season,
                    episodeNumber: episode,
                    hasExplicitSeason: explicit,
                })
            );
        });
    });

    describe('what it refuses', () => {
        it.each([
            '4x4',
            'Cars 2',
            "Ocean's 11",
            'Dune (2021)',
            'Star Wars: Episode I - The Phantom Menace',
            'TRT 1 HD',
            '',
        ])('%s is not an episode', (name) => {
            expect(parseM3uEpisode(name)).toBeNull();
        });

        it('refuses a name that is nothing but a marker', () => {
            // There is no series to file it under, and an empty title would
            // collapse every such row into one phantom series.
            expect(parseM3uEpisode('S01E01')).toBeNull();
            expect(parseM3uEpisode('5.BÖLÜM')).toBeNull();
        });

        it('handles nullish input', () => {
            expect(parseM3uEpisode(null)).toBeNull();
            expect(parseM3uEpisode(undefined)).toBeNull();
        });
    });

    describe('the tail after the marker', () => {
        it('is kept as the episode title, not as part of the series', () => {
            expect(
                parseM3uEpisode('Severance S01E01 - Good News About Hell')
            ).toEqual(
                expect.objectContaining({
                    seriesTitle: 'Severance',
                    episodeTitle: 'Good News About Hell',
                })
            );
        });

        it('is dropped from the series title even when it is noise', () => {
            // This is the removal that makes 40k rows collapse into 2k
            // series; without it every dub variant is its own "series".
            const a = parseM3uEpisode('SHOW S1 E1 - Türkçe Dublaj');
            const b = parseM3uEpisode('SHOW S1 E2 - Altyazılı');

            expect(a?.seriesTitle).toBe('SHOW');
            expect(b?.seriesTitle).toBe('SHOW');
        });

        it('is null when the provider wrote nothing after the marker', () => {
            expect(parseM3uEpisode('SHOW S1 E1')?.episodeTitle).toBeNull();
        });
    });

    it('keeps the leading language tag on the series title', () => {
        // Two dubs of one show must stay two series: merging them would
        // interleave audio languages inside a single season.
        expect(
            parseM3uEpisode('TR:MODERN FAMILY 2009 S2 E14')?.seriesTitle
        ).toBe('TR:MODERN FAMILY 2009');
        expect(parseM3uEpisode('DE:MODERN FAMILY S2 E14')?.seriesTitle).toBe(
            'DE:MODERN FAMILY'
        );
    });
});
