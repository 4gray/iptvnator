import { classifyM3uEntry } from './m3u-content-kind.util';
import { M3U_ENTRY_CORPUS } from './m3u-entry-corpus.spec-data';
import { hasStrongEpisodeCode } from './m3u-vod-detection.util';

const entry = (
    url: string,
    name = 'Channel',
    radio?: 'true'
): { url: string; name: string; radio?: 'true' } => ({ url, name, radio });

describe('classifyM3uEntry', () => {
    describe('against the provider corpus', () => {
        // Both dialects at once: the Xtream-shaped Turkish/German panel and
        // the international spellings. A rule that only satisfies one of
        // them fails here rather than in a user's playlist.
        it.each(
            M3U_ENTRY_CORPUS.map(
                (item) => [item.name, item.kind, item] as const
            )
        )('%s → %s', (_name, expected, item) => {
            expect(classifyM3uEntry(item)).toBe(expected);
        });
    });

    describe('rule order', () => {
        it('reports radio before reading the URL at all', () => {
            expect(
                classifyM3uEntry(
                    entry(
                        'http://h.example/movie/u/p/1.mkv',
                        'Some Station',
                        'true'
                    )
                )
            ).toBe('radio');
        });

        it('keeps DASH out of VOD', () => {
            expect(
                classifyM3uEntry(entry('http://h.example/x/manifest.mpd'))
            ).toBe('live');
        });

        it('lets the series path overrule the name', () => {
            expect(
                classifyM3uEntry(
                    entry('http://h.example/series/u/p/9.mp4', 'Dune')
                )
            ).toBe('episode');
        });

        it('lets the live path overrule an episode code in the name', () => {
            // The dangerous false positive: a working channel leaving the
            // live layout because of how the provider named it.
            expect(
                classifyM3uEntry(
                    entry('http://h.example/live/u/p/9.ts', 'MTV S1 E1')
                )
            ).toBe('live');
        });

        it('promotes a /movie/ row only on a strong episode code', () => {
            expect(
                classifyM3uEntry(
                    entry(
                        'http://h.example/movie/u/p/1.mp4',
                        'THE BAD BATCH S01 E01'
                    )
                )
            ).toBe('episode');
            expect(
                classifyM3uEntry(
                    entry(
                        'http://h.example/movie/u/p/2.mp4',
                        'KILL BILL: BÖLÜM 2 2004'
                    )
                )
            ).toBe('movie');
        });

        it('accepts a weak marker once no path stated the kind', () => {
            // Nothing else is left to go on, and the container already
            // proved this is a file rather than a stream.
            expect(
                classifyM3uEntry(
                    entry('http://h.example/x/y.mkv', 'Breaking Bad Episode 5')
                )
            ).toBe('episode');
        });

        it('never turns a stream container into a movie', () => {
            for (const url of [
                'http://h.example/x/y.ts',
                'http://h.example/x/y.m3u8',
                'http://h.example/x/y',
            ]) {
                expect(classifyM3uEntry(entry(url, 'Some Movie 2024'))).toBe(
                    'live'
                );
            }
        });

        it('reads the path, not the query string', () => {
            expect(
                classifyM3uEntry(
                    entry('http://h.example/live/u/p/9.ts?from=/series/')
                )
            ).toBe('live');
        });

        it('falls back to live for unusable input', () => {
            expect(classifyM3uEntry(null)).toBe('live');
            expect(classifyM3uEntry(undefined)).toBe('live');
            expect(classifyM3uEntry(entry(''))).toBe('live');
        });
    });
});

describe('hasStrongEpisodeCode', () => {
    it.each([
        ['THE BAD BATCH S01 E01', true],
        ['BLACK MIRROR S1 E1', true],
        ['Dark S02E03', true],
        ['The Office 1x02', true],
        ['DELIKANLI 5.BÖLÜM', true],
        ['UZAK SEHIR 120.BÖLÜM', true],
        ['Tatort Staffel 2 Folge 12', true],
    ])('%s is strong', (name, expected) => {
        expect(hasStrongEpisodeCode(name)).toBe(expected);
    });

    it.each([
        ['KILL BILL: BÖLÜM 2 2004', false],
        ['AÇLIK OYUNLARI: ALAYCI KUŞ - BÖLÜM 1 2014', false],
        ['OPEN SEASON 3 2010', false],
        ['Breaking Bad - Episode 5', false],
        ['Star Wars: Episode I - The Phantom Menace', false],
        ['4x4', false],
        ['Cars 2', false],
        ['', false],
    ])('%s is not strong', (name, expected) => {
        expect(hasStrongEpisodeCode(name)).toBe(expected);
    });
});
