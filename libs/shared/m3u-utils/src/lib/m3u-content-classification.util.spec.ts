import type { Channel } from '@iptvnator/shared/interfaces';
import { buildM3uContentIndex,
    m3uContentOverrideKey, classifyM3uContent } from './m3u-content-classification.util';

function item(group: string, name: string, url: string, radio = 'false'): Channel {
    return { id: name, name, url, radio, group: { title: group } } as Channel;
}

describe('M3U presentation classification', () => {
    it.each([
        ['Ulusal Kanallar', 'A2 HD', 'https://example.test/live/a2.ts', 'live'],
        ['Spor Kanalları', 'BEINSPORTS 5 HD', 'https://example.test/abc.m3u8', 'live'],
        ['Türk Sinema', 'Star Wars: Episode 1', 'https://example.test/movie/12.mp4', 'movies'],
        ['Türk Yerli Filmleri', 'Film 2026', 'https://example.test/video.ts', 'movies'],
        ['Yeni Eklenen Filmler', 'Dune', 'https://example.test/1.mkv', 'movies'],
        ['Türk Yerli Dizileri', 'Kardeşlerim 35. Bölüm', 'https://example.test/episode.ts', 'series'],
        ['Netflix Türkiye', 'Breaking Bad S02E03', 'https://example.test/media/episode.mkv', 'series'],
        ['Netflix Türkiye', 'Some Film', 'https://example.test/movie/78', 'movies'],
        ['Netflix Türkiye', 'Some Series', 'https://example.test/series/33', 'series'],
        ['Netflix Türkiye', 'Ambiguous Stream', 'https://example.test/watch?id=3', 'unclassified'],
        ['Türk Aksiyon & Gerilim', 'Unknown', 'https://example.test/opaque', 'unclassified'],
        ['Unlabeled', 'Radio', 'https://example.test/audio.mp3', 'unclassified'],
    ] as const)('%s / %s => %s', (group, name, url, expected) => {
        expect(classifyM3uContent(item(group, name, url))).toBe(expected);
    });

    it('treats explicitly marked radio as live', () => {
        expect(classifyM3uContent(item('Müzik', 'Radio', 'https://example.test/radio', 'true'))).toBe('live');
    });

    it('does not classify a generic .ts or .m3u8 URL as live without evidence', () => {
        expect(classifyM3uContent(item('Mixed', 'Unknown', 'https://example.test/123.ts'))).toBe('unclassified');
        expect(classifyM3uContent(item('Mixed', 'Unknown', 'https://example.test/123.m3u8'))).toBe('unclassified');
    });

    it('returns complete, disjoint ordered partitions without mutating channels', () => {
        const channels = [
            item('Ulusal Kanallar', 'A2 HD', 'https://example.test/live/a2.ts'),
            item('Türk Sinema', 'Dune', 'https://example.test/m.mp4'),
            item('Türk Yerli Dizileri', 'Show S01E01', 'https://example.test/s.mkv'),
            item('Other', 'Unknown', 'https://example.test/unknown'),
        ];
        const before = JSON.stringify(channels);
        const index = buildM3uContentIndex(channels);
        expect([index.live.length, index.movies.length, index.series.length, index.unclassified.length]).toEqual([1, 1, 1, 1]);
        expect(Object.values(index).flat()).toHaveLength(channels.length);
        expect(index.live[0]).toBe(channels[0]);
        expect(JSON.stringify(channels)).toBe(before);
    });

    it('classifies a 100,000-item synthetic list with no duplicate work per group', () => {
        const channels = Array.from({ length: 100_000 }, (_, i) =>
            item(i % 2 === 0 ? 'Spor Kanalları' : 'Türk Yerli Filmleri',
                `Entry ${i}`, `https://example.test/${i}.ts`)
        );
        const index = buildM3uContentIndex(channels);
        expect(index.live.length).toBe(50_000);
        expect(index.movies.length).toBe(50_000);
        expect(index.series.length).toBe(0);
        expect(index.unclassified.length).toBe(0);
    });
    it('respects per-channel overrides and reset without mutating source channels', () => {
        const original = { id: 'one', name: 'Example', url: 'https://example.invalid/file.mp4', group: { title: '' } } as Channel;
        const identity = m3uContentOverrideKey(original);
        expect(buildM3uContentIndex([original]).movies).toHaveLength(1);
        const manual = buildM3uContentIndex([original], { [identity]: 'live' });
        expect(manual.live).toEqual([original]);
        expect(manual.movies).toHaveLength(0);
        expect(buildM3uContentIndex([original], {}).movies).toEqual([original]);
        expect(original.group?.title).toBe('');
    });

    it('uses URL and name instead of volatile parsed-channel ID', () => {
        const channel = { name: 'Example', url: 'https://example.invalid/a.mp4', id: 'old' } as Channel;
        expect(m3uContentOverrideKey(channel)).toBe(m3uContentOverrideKey({ ...channel, id: 'new' }));
        expect(m3uContentOverrideKey(channel)).not.toBe(m3uContentOverrideKey({ ...channel, name: 'Other' }));
    });

});
