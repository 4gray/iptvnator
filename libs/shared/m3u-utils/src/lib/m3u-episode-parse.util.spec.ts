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
            // directly: a live channel named "POPWELLE S1 E1", and a film named
            // "GECE AVCISI: BÖLÜM 2" — Turkish writes film instalments where
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
            ['Hollow S02E03', 'Hollow', 2, 3, true],
            ['Hollow s02.e03', 'Hollow', 2, 3, true],
            ['Hollow S2-E3', 'Hollow', 2, 3, true],
            ['The Depot 1x02', 'The Depot', 1, 2, true],
            [
                'Kommissar Nebelfeld Staffel 2 Folge 12',
                'Kommissar Nebelfeld',
                2,
                12,
                true,
            ],
            [
                'Kommissar Nebelfeld Folge 12',
                'Kommissar Nebelfeld',
                1,
                12,
                false,
            ],
            ['Тихий двор 12 серия', 'Тихий двор', 1, 12, false],
            ['YILDIZ SOKAGI 5.BÖLÜM', 'YILDIZ SOKAGI', 1, 5, false],
            ['SESSIZ VADI 120.BÖLÜM', 'SESSIZ VADI', 1, 120, false],
            ['La Finca Capitulo 4', 'La Finca', 1, 4, false],
            ['YILDIZ SOKAGI 7.BÖLÜM FINAL', 'YILDIZ SOKAGI', 1, 7, false],
            // Pilots and specials are numbered E0 by real providers; the
            // app already treats season zero as a valid Specials
            // coordinate, so episode zero is kept too.
            ['TR:DEDEKTIF S4 E0', 'TR:DEDEKTIF', 4, 0, true],
            // A bare trailing code, with no season anywhere in the name.
            ['Harbor Lights E12', 'Harbor Lights', 1, 12, false],
            ['Harbor Lights EP 7', 'Harbor Lights', 1, 7, false],
            // A title ending in a number, with a word-first marker: the
            // number is the title's, not the episode's.
            ['The 100 Episode 5', 'The 100', 1, 5, false],
            ['Babylon 5 Folge 3', 'Babylon 5', 1, 3, false],
            ['Hawaii Five-0 Folge 5', 'Hawaii Five-0', 1, 5, false],
            ['24 Episode 5', '24', 1, 5, false],
            // ...while a quality tail or a season after a number-first
            // marker leaves it number-first.
            ['YILDIZ SOKAGI 5.BÖLÜM 1080p', 'YILDIZ SOKAGI', 1, 5, false],
            ['YILDIZ SOKAGI 5.BÖLÜM 2023', 'YILDIZ SOKAGI', 1, 5, false],
            ['Тихий двор 12 серия 2 сезон', 'Тихий двор', 2, 12, true],
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
            '6x6',
            'Rockets 2',
            "Harper's 11",
            'Sandline (2021)',
            'Starfall Saga: Episode I - The Silent Orbit',
            'KANAL ORNEK 1 HD',
            '',
        ])('%s is not an episode', (name) => {
            expect(parseM3uEpisode(name)).toBeNull();
        });

        it('refuses a name that is nothing but a marker', () => {
            // There is no series to file it under, and an empty title would
            // collapse every such row into one phantom series.
            expect(parseM3uEpisode('S01E01')).toBeNull();
            expect(parseM3uEpisode('5.BÖLÜM')).toBeNull();
            // Must not fall through to the bare "E01" reading either.
            expect(parseM3uEpisode('S01 E01')).toBeNull();
            expect(parseM3uEpisode('S01E01', '  ')).toBeNull();
            expect(parseM3uEpisode('S01E01', null)).toBeNull();
        });

        it('names a marker-only row after the fallback title', () => {
            expect(parseM3uEpisode('S01E01 - Pilot', ' Harbor ')).toEqual({
                seriesTitle: 'Harbor',
                seasonNumber: 1,
                episodeNumber: 1,
                hasExplicitSeason: true,
                episodeTitle: 'Pilot',
            });
            // A name that states its own title keeps it.
            expect(
                parseM3uEpisode('Hollow S02E03', 'Harbor')?.seriesTitle
            ).toBe('Hollow');
        });

        it('handles nullish input', () => {
            expect(parseM3uEpisode(null)).toBeNull();
            expect(parseM3uEpisode(undefined)).toBeNull();
        });
    });

    describe('the tail after the marker', () => {
        it('is kept as the episode title, not as part of the series', () => {
            expect(
                parseM3uEpisode('Partition S01E01 - Notes From the Basement')
            ).toEqual(
                expect.objectContaining({
                    seriesTitle: 'Partition',
                    episodeTitle: 'Notes From the Basement',
                })
            );
        });

        it('is dropped from the series title even when it is noise', () => {
            // This is the removal that makes tens of thousands of rows
            // collapse into a few thousand series; without it every dub
            // variant is its own "series".
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
            parseM3uEpisode('TR:HAPPY HOUSEHOLD 2009 S2 E14')?.seriesTitle
        ).toBe('TR:HAPPY HOUSEHOLD 2009');
        expect(parseM3uEpisode('DE:HAPPY HOUSEHOLD S2 E14')?.seriesTitle).toBe(
            'DE:HAPPY HOUSEHOLD'
        );
    });
});
