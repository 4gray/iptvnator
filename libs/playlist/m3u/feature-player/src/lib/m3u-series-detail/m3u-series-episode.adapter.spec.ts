import { Channel } from '@iptvnator/shared/interfaces';
import { buildM3uSeriesCatalog } from '@iptvnator/shared/m3u-utils';
import { toSeasonRecord, toXtreamEpisode } from './m3u-series-episode.adapter';

const row = (name: string, url?: string) =>
    ({
        url:
            url ??
            `http://h.example/series/u/p/${encodeURIComponent(name)}.mp4`,
        name,
        group: { title: 'Shows' },
        tvg: { logo: 'http://logo/show.png' },
    }) as unknown as Channel;

const series = (names: string[]) =>
    buildM3uSeriesCatalog(
        names.map((name) => row(name)),
        'pl-1'
    )[0];

describe('M3U series episode adapter', () => {
    it('keys seasons as strings the shared component can sort', () => {
        const record = toSeasonRecord(
            series(['SHOW S1 E1', 'SHOW S2 E1', 'SHOW S10 E1'])
        );

        expect(
            Object.keys(record).sort((a, b) => Number(a) - Number(b))
        ).toEqual(['1', '2', '10']);
    });

    it('round-trips the numeric id through the string field', () => {
        // The shared component reads Number(episode.id) for playback
        // positions; an id that does not parse back loses watch history.
        const source = series(['SHOW S1 E1']);
        const episode = source.seasons.get(1)?.[0];
        const adapted = toXtreamEpisode(episode!);

        expect(Number(adapted.id)).toBe(episode?.id);
        expect(Number.isSafeInteger(Number(adapted.id))).toBe(true);
    });

    it('carries the row URL as direct_source so it plays unchanged', () => {
        const adapted = toXtreamEpisode(
            series(['SHOW S1 E1'])!.seasons.get(1)![0]
        );

        expect(adapted.direct_source).toContain('/series/');
        expect(adapted.container_extension).toBe('mp4');
    });

    it('reads the container extension past a query string', () => {
        const source = buildM3uSeriesCatalog(
            [row('SHOW S1 E1', 'http://h.example/series/u/p/9.mkv?token=abc')],
            'pl-1'
        )[0];

        expect(
            toXtreamEpisode(source.seasons.get(1)![0]).container_extension
        ).toBe('mkv');
    });

    it('falls back to an empty extension when the URL has none', () => {
        const source = buildM3uSeriesCatalog(
            [row('SHOW S1 E1', 'http://h.example/series/u/p/9')],
            'pl-1'
        )[0];

        expect(
            toXtreamEpisode(source.seasons.get(1)![0]).container_extension
        ).toBe('');
    });

    it('leaves the title empty when the provider wrote none', () => {
        // The shared episode card already prefixes the episode number, so a
        // synthesised title renders it twice ("7. E7").
        const adapted = toXtreamEpisode(
            series(['SHOW S1 E7'])!.seasons.get(1)![0]
        );

        expect(adapted.title).toBe('');
        expect(adapted.episode_num).toBe(7);
    });

    it('keeps a real episode title the provider did write', () => {
        const source = series(['SHOW S1 E1 - Good News About Hell']);

        expect(toXtreamEpisode(source.seasons.get(1)![0]).title).toBe(
            'Good News About Hell'
        );
    });
});
