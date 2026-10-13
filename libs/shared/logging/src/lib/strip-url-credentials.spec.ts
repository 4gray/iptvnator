import { stripUrlCredentials } from './strip-url-credentials';

describe('stripUrlCredentials', () => {
    it.each([
        [
            'http://host.tv:8080/get.php?username=joe&password=hunter2&type=m3u_plus',
            'http://host.tv:8080/get.php?type=m3u_plus',
        ],
        ['http://joe:hunter2@host.tv/list.m3u', 'http://host.tv/list.m3u'],
        [
            'http://host.tv/live/joe/hunter2/123.ts',
            'http://host.tv/live/123.ts',
        ],
        [
            'https://cdn.tv/playlist.m3u8?token=abc123&quality=hd',
            'https://cdn.tv/playlist.m3u8?quality=hd',
        ],
        ['http://portal.tv/c/?mac=00:1A:79:00:00:01', 'http://portal.tv/c/'],
        [
            'http://host.tv/list.m3u#user=joe&pass=hunter2',
            'http://host.tv/list.m3u',
        ],
        ['http://[::1]:3211/get.php?password=p', 'http://[::1]:3211/get.php'],
        [
            'https://iptv-org.github.io/iptv/index.m3u',
            'https://iptv-org.github.io/iptv/index.m3u',
        ],
    ])('shows %s as %s', (input, expected) => {
        expect(stripUrlCredentials(input)).toBe(expected);
    });

    it('never returns a password from a credential-bearing URL', () => {
        const urls = [
            'http://joe:hunter2@host.tv/get.php?username=joe&password=hunter2',
            'http://host.tv/movie/joe/hunter2/9.mkv?auth=hunter2',
            'http://host.tv/x#password=hunter2',
        ];
        for (const url of urls) {
            expect(stripUrlCredentials(url)).not.toMatch(/hunter2/);
        }
    });

    it('cleans a credential-bearing URL nested in a kept parameter', () => {
        const proxied = `https://proxy.test/list?url=${encodeURIComponent(
            'http://joe:hunter2@origin.test/get.php?username=joe&password=hunter2&type=m3u'
        )}&quality=hd`;
        const shown = stripUrlCredentials(proxied);
        expect(shown).not.toMatch(/hunter2|joe/);
        expect(new URL(shown ?? '').searchParams.get('url')).toBe(
            'http://origin.test/get.php?type=m3u'
        );
        expect(new URL(shown ?? '').searchParams.get('quality')).toBe('hd');
    });

    it('cleans nested parameter lists, fragments and path segments', () => {
        expect(
            stripUrlCredentials(
                `https://proxy.test/list?next=${encodeURIComponent(
                    'token=abc&page=2'
                )}`
            )
        ).toBe('https://proxy.test/list?next=page%3D2');
        expect(
            stripUrlCredentials(
                `https://proxy.test/list#src=${encodeURIComponent(
                    'http://joe:hunter2@origin.test/a.m3u'
                )}`
            )
        ).not.toMatch(/hunter2/);
        const inPath = `https://proxy.test/fetch/${encodeURIComponent(
            'http://joe:hunter2@origin.test/a.m3u'
        )}`;
        expect(stripUrlCredentials(inPath)).not.toMatch(/hunter2|joe/);
    });

    it('drops a kept part that still names a secret', () => {
        expect(
            stripUrlCredentials(
                'https://proxy.test/list?via=joe:hunter2@origin.test&hd=1'
            )
        ).toBe('https://proxy.test/list?hd=1');
        expect(
            stripUrlCredentials(
                `https://proxy.test/list?note=${encodeURIComponent(
                    'token: abc'
                )}&hd=1`
            )
        ).toBe('https://proxy.test/list?hd=1');
    });

    it('drops URLs nested deeper than it cleans', () => {
        let url = 'http://joe:hunter2@origin.test/a.m3u';
        for (let depth = 0; depth < 6; depth += 1) {
            url = `https://hop${depth}.test/?u=${encodeURIComponent(url)}`;
        }
        expect(stripUrlCredentials(url)).not.toMatch(/hunter2/);
    });

    it('returns null for text that is not an absolute URL', () => {
        expect(stripUrlCredentials('get.php?username=joe')).toBeNull();
        expect(stripUrlCredentials('')).toBeNull();
        expect(stripUrlCredentials('not a url')).toBeNull();
    });
});
