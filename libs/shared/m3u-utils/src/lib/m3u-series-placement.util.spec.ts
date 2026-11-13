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
