import { M3uSeriesEpisode } from './m3u-series-model';
import {
    fileNameOf,
    m3uPlaybackKey,
    placeNumberedEpisode,
    placeUnnumberedEpisode,
} from './m3u-series-placement.util';

type Row = { url: string; name: string };
const row = (file: string): Row => ({
    url: `http://h.example/series/u/p/${file}`,
    name: file,
});
const episode = (
    channel: Row,
    episodeNumber: number,
    extra: Partial<M3uSeriesEpisode<Row>> = {}
): M3uSeriesEpisode<Row> => ({
    id: 0,
    seasonNumber: 1,
    episodeNumber,
    title: null,
    channel,
    alternatives: [],
    ...extra,
});

describe('fileNameOf', () => {
    it('reads the last path segment, lowercased, without query or fragment', () => {
        expect(fileNameOf('http://h.example/a/b/Clip-9.MP4?token=1#t=3')).toBe(
            'clip-9.mp4'
        );
        expect(fileNameOf('http://h.example/a/b/')).toBe('b');
    });

    it('is empty for a missing URL', () => {
        expect(fileNameOf(null)).toBe('');
        expect(fileNameOf(undefined)).toBe('');
    });
});

describe('m3uPlaybackKey', () => {
    it('is the URL alone for a row with no headers and no DRM', () => {
        expect(m3uPlaybackKey({ url: 'http://h.example/a.mp4' })).toBe(
            'http://h.example/a.mp4'
        );
        expect(m3uPlaybackKey({})).toBe('');
    });

    it('tells apart rows whose stated DRM differs', () => {
        const url = 'http://h.example/a.mpd';
        const first = m3uPlaybackKey({ url, drm: { licenseType: 'clearkey' } });
        const second = m3uPlaybackKey({ url, drm: { licenseType: 'other' } });

        expect(first).not.toBe(second);
        expect(first).not.toBe(url);
    });

    it('prefers the stated DRM over the raw block', () => {
        const url = 'http://h.example/a.mpd';
        const raw =
            '#KODIPROP:inputstream.adaptive.license_type=clearkey\n' +
            `#KODIPROP:inputstream.adaptive.license_key=${'1'.repeat(32)}:${'a'.repeat(32)}`;
        const drm = { licenseType: 'stated', supported: false };

        expect(m3uPlaybackKey({ url, raw, drm })).toBe(
            m3uPlaybackKey({ url, drm })
        );
    });
});

describe('placeNumberedEpisode', () => {
    const coordinateHolder = (files: string[]) => {
        const season = new Map<number, M3uSeriesEpisode<Row>>();
        for (const file of files) {
            placeNumberedEpisode(season, episode(row(file), 1));
        }
        return [...season.entries()]
            .sort(([a], [b]) => a - b)
            .map(([key, held]) => [
                key,
                held.channel.name,
                held.rowKey ?? null,
            ]);
    };

    it('keeps the coordinate on the same file whatever the row order', () => {
        // A refresh that reverses two parts must not hand one part's
        // watched mark and resume point to the other.
        const inOrder = coordinateHolder(['part-1.mp4', 'part-2.mp4']);
        const reversed = coordinateHolder(['part-2.mp4', 'part-1.mp4']);

        expect(reversed).toEqual(inOrder);
        expect(inOrder).toEqual([
            [1, 'part-1.mp4', null],
            [1.001, 'part-2.mp4', 'part-2.mp4'],
        ]);
    });

    it('parks the same row twice under the holder after a swap', () => {
        const season = new Map<number, M3uSeriesEpisode<Row>>();
        placeNumberedEpisode(season, episode(row('part-2.mp4'), 1));
        placeNumberedEpisode(season, episode(row('part-1.mp4'), 1));
        placeNumberedEpisode(season, episode(row('part-2.mp4'), 1));

        expect(season.size).toBe(2);
        expect(season.get(1.001)?.alternatives).toHaveLength(1);
    });

    it('gives the coordinate to an extra stream that gains the best row', () => {
        // "part-22" is listed as an extra of "part-1". The same file again
        // under a shorter name ranks before "part-1": the stream folds it in
        // and takes the coordinate, and "part-1" is keyed on its own row.
        const season = new Map<number, M3uSeriesEpisode<Row>>();
        placeNumberedEpisode(season, episode(row('part-1.mp4'), 1));
        placeNumberedEpisode(season, episode(row('part-22.mp4'), 1));
        placeNumberedEpisode(
            season,
            episode({ ...row('part-22.mp4'), name: 'p2' }, 1)
        );

        expect([...season.keys()].sort()).toEqual([1, 1.001]);
        expect(season.get(1)?.channel.name).toBe('p2');
        expect(season.get(1)?.rowKey).toBeUndefined();
        expect(season.get(1)?.alternatives).toHaveLength(1);
        expect(season.get(1.001)?.channel.name).toBe('part-1.mp4');
        expect(season.get(1.001)?.rowKey).toBe('part-1.mp4');
    });

    it('lists the same entries in every order of rows sharing streams', () => {
        // Q is the same stream as P and the best-ranked row of all; it holds
        // the coordinate even when P was already listed as an extra.
        const permutations = <V>(items: V[]): V[][] =>
            items.length <= 1
                ? [items]
                : items.flatMap((item, index) =>
                      permutations(items.filter((_, i) => i !== index)).map(
                          (rest) => [item, ...rest]
                      )
                  );
        const named = (name: string, file: string): Row => ({
            ...row(file),
            name,
        });
        const listing = (rows: Row[]) => {
            const season = new Map<number, M3uSeriesEpisode<Row>>();
            for (const channel of rows) {
                placeNumberedEpisode(season, episode(channel, 1));
            }
            return [...season.values()]
                .map((held) => [
                    held.channel.name,
                    held.rowKey ?? null,
                    held.alternatives.map((alt) => alt.name).sort(),
                ])
                .sort();
        };

        for (const rows of [
            [named('HHHHH', 'u1'), named('PPPPPPP', 'u2'), named('QQQ', 'u2')],
            [named('AAAA', 'u1'), named('BBBBBB', 'u1'), named('CCC', 'u2')],
            [named('XX', 'u1'), named('YY', 'u1'), named('ZZZ', 'u2')],
        ]) {
            const listings = permutations(rows).map(listing);
            for (const each of listings) expect(each).toEqual(listings[0]);
        }
        expect(
            listing([
                named('HHHHH', 'u1'),
                named('PPPPPPP', 'u2'),
                named('QQQ', 'u2'),
            ])
        ).toEqual([
            ['HHHHH', 'u1', []],
            ['QQQ', null, ['PPPPPPP']],
        ]);
    });

    it('drops the row key of an extra that takes the coordinate', () => {
        // An extra of another year group (`mergeParts`) that ranks first
        // holds the coordinate and its id; the displaced row is keyed.
        const season = new Map<number, M3uSeriesEpisode<Row>>();
        placeNumberedEpisode(season, episode(row('part-22.mp4'), 1));
        placeNumberedEpisode(
            season,
            episode(row('p1.mp4'), 1, { rowKey: 'p1.mp4' })
        );

        expect(season.get(1)?.channel.name).toBe('p1.mp4');
        expect(season.get(1)?.rowKey).toBeUndefined();
        expect(season.get(1.001)?.rowKey).toBe('part-22.mp4');
    });

    it('takes the coordinate from an unnumbered row sitting in it', () => {
        // The unnumbered row's number was only its place in the list; a row
        // that states the coordinate holds it, and the other is listed next.
        const season = new Map<number, M3uSeriesEpisode<Row>>();
        placeUnnumberedEpisode(season, episode(row('extra.mp4'), 0));
        expect(season.get(1)?.unnumbered).toBe(true);

        placeNumberedEpisode(season, episode(row('e1.mp4'), 1));

        expect(season.get(1)?.channel.name).toBe('e1.mp4');
        expect(season.get(1)?.unnumbered).toBeUndefined();
        expect(season.get(2)?.channel.name).toBe('extra.mp4');
        expect(season.get(2)?.unnumbered).toBe(true);
        expect(season.get(2)?.rowKey).toBe('extra.mp4');
    });
});
