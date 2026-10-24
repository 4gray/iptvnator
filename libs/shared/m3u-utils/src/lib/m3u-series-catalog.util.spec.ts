import type { Channel } from '@iptvnator/shared/interfaces';
import { buildM3uSeriesCatalog, parseM3uEpisode } from './m3u-series-catalog.util';

function item(name: string, id = name): Channel {
    return { id, name, url: `https://example.invalid/${id}` } as Channel;
}
describe('M3U series catalog', () => {
    it.each([
        ['Breaking Bad S01E02', 'Breaking Bad', 1, 2],
        ['Dark 2x03', 'Dark', 2, 3],
        ['Leyla Sezon 3 Bölüm 10', 'Leyla', 3, 10],
        ['Show Episode 12', 'Show', 0, 12],
    ])('parses a recognizable episode: %s', (name, title, season, episode) => {
        expect(parseM3uEpisode(item(name))).toEqual({ title, season, episode });
    });

    it('never treats ordinary film titles or unsupported names as episodes', () => {
        expect(parseM3uEpisode(item('2001 A Space Odyssey'))).toBeNull();
        expect(parseM3uEpisode(item('4x4'))).toBeNull();
        expect(parseM3uEpisode(item('Untitled episode'))).toBeNull();
    });

    it('groups seasons and preserves original playable channels including duplicate encodes', () => {
        const channels = [
            item('Breaking Bad S02E02', 'two'),
            item('Breaking Bad S01E03', 'three'),
            item('Breaking Bad S01E01', 'one'),
            item('Breaking Bad S01E01', 'hd'),
            item('Unstructured Name', 'unknown'),
        ];
        const catalog = buildM3uSeriesCatalog(channels);
        expect(catalog.series).toHaveLength(1);
        expect(catalog.series[0].seasons.map(s => s.number)).toEqual([1, 2]);
        expect(catalog.series[0].seasons[0].episodes.map(e => e.channel.id))
            .toEqual(['one', 'hd', 'three']);
        expect(catalog.unorganized).toEqual([channels[4]]);
        expect(catalog.series[0].seasons[0].episodes[0].channel).toBe(channels[2]);
    });

    it('processes 100,000 entries without duplicating source channel objects', () => {
        const channels = Array.from({length: 100000}, (_, i) =>
            item(`Series ${i % 25} S${String(1 + Math.floor(i / 2500) % 4).padStart(2, '0')}E${String(1 + i % 80).padStart(2,'0')}`, String(i))
        );
        const catalog = buildM3uSeriesCatalog(channels);
        expect(catalog.series).toHaveLength(25);
        expect(catalog.series.reduce((n, s) => n + s.count, 0)).toBe(100000);
        expect(catalog.series.flatMap(s => s.seasons).flatMap(s => s.episodes)
            .every(e => channels.includes(e.channel))).toBe(true);
    });
});
