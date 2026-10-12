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

    it('returns null for text that is not an absolute URL', () => {
        expect(stripUrlCredentials('get.php?username=joe')).toBeNull();
        expect(stripUrlCredentials('')).toBeNull();
        expect(stripUrlCredentials('not a url')).toBeNull();
    });
});
