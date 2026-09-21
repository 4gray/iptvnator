import {
    classifyM3uEntry,
    m3uCollectionContentType,
} from './m3u-content-kind.util';
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

        it('applies the same strong-code rule with no path evidence', () => {
            // One name must not get two answers depending on a path that
            // said nothing: word order is what separates a film instalment
            // from an episode, and the URL does not change that.
            expect(
                classifyM3uEntry(
                    entry('http://h.example/x/y.mkv', 'Dark S02E03')
                )
            ).toBe('episode');
            expect(
                classifyM3uEntry(
                    entry('http://h.example/x/y.mkv', 'Breaking Bad Episode 5')
                )
            ).toBe('movie');
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

        it('keeps a live path that happens to contain the word series', () => {
            // "/live/user/series/123.ts" is a channel; the stated rule is
            // that live wins, so the guard runs before the series check.
            expect(
                classifyM3uEntry(
                    entry('http://h.example/live/user/series/123.ts', 'Sport')
                )
            ).toBe('live');
        });

        it('keeps a season-named film a film with no path evidence', () => {
            // Nothing but the extension and the name to go on, and a season
            // word alone has never identified an episode.
            expect(
                classifyM3uEntry(
                    entry('http://h.example/x/y.mp4', 'OPEN SEASON 3 2010')
                )
            ).toBe('movie');
            expect(
                classifyM3uEntry(
                    entry('http://h.example/x/y.mp4', 'KILL BILL: BÖLÜM 2')
                )
            ).toBe('movie');
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
        // Turkish serials label their last episode this way; an end-anchored
        // rule filed exactly those rows as films.
        ['DELIKANLI 7.BÖLÜM FINAL', true],
        ['CENNETIN COCUKLARI 31.BÖLÜM SON', true],
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

describe('m3uCollectionContentType', () => {
    it('files an episode under the show it belongs to', () => {
        // The collection surfaces have no separate episode kind, and a
        // favourited episode belongs to its series.
        expect(
            m3uCollectionContentType(
                entry('http://h.example/series/u/p/1.mp4', 'Dark S01E01')
            )
        ).toBe('series');
    });

    it('keeps radio on the live side', () => {
        // The collection item carries its own radio flag; inventing a
        // fourth content type would make every consumer learn it.
        expect(
            m3uCollectionContentType(
                entry('http://h.example/live/u/p/1.ts', 'TRT FM', 'true')
            )
        ).toBe('live');
    });

    it.each([
        ['http://h.example/movie/u/p/1.mkv', 'Dune', 'movie'],
        ['http://h.example/live/u/p/2.ts', 'TRT 1', 'live'],
    ])('%s is %s', (url, name, expected) => {
        expect(m3uCollectionContentType(entry(url, name))).toBe(expected);
    });

    it('treats unusable input as live', () => {
        expect(m3uCollectionContentType(null)).toBe('live');
    });
});
