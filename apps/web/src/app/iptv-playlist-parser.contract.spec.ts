import { parse } from 'iptv-playlist-parser';

/**
 * Contract tests for the 4gray/iptv-playlist-parser fork (jest maps the
 * module to the real parser source via test-stubs/iptv-playlist-parser.mjs).
 * Guards the fork-specific behaviors iptvnator depends on:
 * - no URL length/format validation (issue #1189: Pluto JWT URLs > 2084 chars)
 * - '#' comments never become URLs and never shift the item index
 * - the fork-only `radio` attribute survives upstream syncs
 * - `url` is stripped at the first '|' while pipe params land in `http.*`
 */
describe('iptv-playlist-parser contract (4gray fork)', () => {
    const plutoUrl = (id: string) =>
        `https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/v2/stitch/hls/channel/${id}/master.m3u8?jwt=${'e'.repeat(2100)}&masterJWTPassthrough=true`;

    it('parses playlists whose URLs are longer than 2084 characters (#1189)', () => {
        const playlist = [
            '#EXTM3U',
            '#EXTINF:-1 group-title="Anime & Geek" tvg-id="one" tvg-name="Beyblade",Beyblade',
            plutoUrl('one'),
            '#EXTINF:-1 group-title="TV Brasileira" tvg-id="two" tvg-name="TV Cultura",TV Cultura',
            plutoUrl('two'),
            '',
        ].join('\n');

        const result = parse(playlist);

        expect(result.items.length).toBe(2);
        expect(result.items[0].name).toBe('Beyblade');
        expect(result.items[0].url).toBe(plutoUrl('one'));
        expect(result.items[1].name).toBe('TV Cultura');
        expect(result.items[1].url).toBe(plutoUrl('two'));
    });

    it('ignores comments and unknown directives between #EXTINF and the URL', () => {
        const playlist = [
            '#EXTM3U',
            '#EXTINF:-1 tvg-id="one",Channel One',
            '# stray comment',
            '#EXT-X-SESSION-DATA:DATA-ID="com.example",VALUE="x"',
            'http://example.com/one.m3u8',
            '#EXTINF:-1 tvg-id="two",Channel Two',
            'http://example.com/two.m3u8',
            '',
        ].join('\n');

        const result = parse(playlist);

        expect(result.items.length).toBe(2);
        expect(result.items[0].url).toBe('http://example.com/one.m3u8');
        expect(result.items[0].raw).toContain('# stray comment');
        expect(result.items[1].url).toBe('http://example.com/two.m3u8');
    });

    it('parses the radio attribute used by the radio player', () => {
        const playlist = [
            '#EXTM3U',
            '#EXTINF:-1 radio="true" tvg-id="r1",Radio One',
            'http://example.com/radio1',
            '#EXTINF:-1 tvg-id="tv1",TV One',
            'http://example.com/tv1',
            '',
        ].join('\n');

        const result = parse(playlist);

        expect(result.items[0].radio).toBe('true');
        expect(result.items[1].radio).toBe('');
    });

    it('strips pipe options from url while keeping them in http.*', () => {
        const playlist = [
            '#EXTM3U',
            '#EXTINF:-1,Piped',
            'http://example.com/stream.ts|User-Agent=CustomUA&Referer=http://ref.example',
            '',
        ].join('\n');

        const result = parse(playlist);

        expect(result.items[0].url).toBe('http://example.com/stream.ts');
        expect(result.items[0].http['user-agent']).toBe('CustomUA');
        expect(result.items[0].http.referrer).toBe('http://ref.example');
    });

    it('exposes EPG urls from the playlist header', () => {
        const result = parse(
            [
                '#EXTM3U x-tvg-url="https://epg.example/guide.xml"',
                '#EXTINF:-1,One',
                'http://example.com/one.m3u8',
                '',
            ].join('\n')
        );

        expect(result.header.attrs['x-tvg-url']).toBe(
            'https://epg.example/guide.xml'
        );
    });
});
