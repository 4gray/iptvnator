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

    it('knows Xtream account segments in any case, also nested', () => {
        expect(
            stripUrlCredentials('http://host.tv/LIVE/joe/hunter2/1.ts')
        ).toBe('http://host.tv/LIVE/1.ts');
        const nested = `https://proxy.test/list?url=${encodeURIComponent(
            'https://origin.test/LIVE/joe/hunter2/1.ts'
        )}`;
        expect(stripUrlCredentials(nested)).not.toMatch(/hunter2|joe/);
    });

    it('reads parameter names and path markers through every encoding layer', () => {
        expect(
            stripUrlCredentials(
                'https://proxy.test/list?%2570assword=hunter2&hd=1'
            )
        ).toBe('https://proxy.test/list?hd=1');
        expect(
            stripUrlCredentials('https://proxy.test/list?%2570ass=hunter2&hd=1')
        ).toBe('https://proxy.test/list?hd=1');
        const layered = 'https://origin.test/%256Cive/joe/hunter2/1.ts';
        expect(stripUrlCredentials(layered)).not.toMatch(/hunter2|joe/);
        expect(
            stripUrlCredentials(
                `https://proxy.test/list?url=${encodeURIComponent(layered)}`
            )
        ).not.toMatch(/hunter2|joe/);
    });

    it('drops an Xtream account hidden behind encoded separators', () => {
        for (const url of [
            'https://origin.test/live%2Fjoe%2Fhunter2%2F1.ts',
            'https://origin.test/live%2Fjoe/hunter2/1.ts',
            'https://origin.test/live%252Fjoe%252Fhunter2%252F1.ts',
            // A slash encoded inside the user name, not between segments.
            'https://origin.test/live/joe%2Fx/hunter2/1.ts',
            'https://origin.test/live/joe/hun%2Fter2/1.ts',
        ]) {
            expect(stripUrlCredentials(url)).not.toMatch(/hunter2|hun|joe/);
        }
        // Separators alone are no account: the path stays as written.
        expect(
            stripUrlCredentials('https://cdn.test/files%2Flive%2Flist.m3u')
        ).toBe('https://cdn.test/files%2Flive%2Flist.m3u');
    });

    it('drops a JSON value and a quoted key that name a secret', () => {
        for (const json of [
            '{"password":"hunter2"}',
            '{"pass\\u0077ord":"hunter2"}',
            '[{"auth":{"token":"hunter2"}}]',
        ]) {
            expect(
                stripUrlCredentials(
                    `https://proxy.test/list?config=${encodeURIComponent(json)}&hd=1`
                )
            ).toBe('https://proxy.test/list?hd=1');
        }
        expect(
            stripUrlCredentials(
                `https://proxy.test/list?note=${encodeURIComponent(
                    "see 'token': 'hunter2'"
                )}&hd=1`
            )
        ).toBe('https://proxy.test/list?hd=1');
        // Brackets that are not JSON stay: `[1080p]` is a folder name.
        expect(stripUrlCredentials('https://cdn.test/[1080p]/list.m3u')).toBe(
            'https://cdn.test/[1080p]/list.m3u'
        );
    });

    it('cleans a fragment that holds a URL rather than parameters', () => {
        expect(
            stripUrlCredentials(
                'https://proxy.test/list#https://joe:hunter2@origin.test/a.m3u'
            )
        ).toBe('https://proxy.test/list#https://origin.test/a.m3u');
        expect(
            stripUrlCredentials(
                `https://proxy.test/list#${encodeURIComponent(
                    'https://joe:hunter2@origin.test/a.m3u'
                )}`
            )
        ).not.toMatch(/hunter2|joe/);
        expect(
            stripUrlCredentials('https://proxy.test/list#joe:hunter2@origin')
        ).toBe('https://proxy.test/list');
        // A plain anchor stays as written.
        expect(stripUrlCredentials('https://host.test/list.m3u#part-2')).toBe(
            'https://host.test/list.m3u#part-2'
        );
    });

    it('keeps a playlist path that only starts like an Xtream stream', () => {
        // No stream follows `/news/list.m3u`: it names no account.
        expect(stripUrlCredentials('https://cdn.test/live/news/list.m3u')).toBe(
            'https://cdn.test/live/news/list.m3u'
        );
        expect(
            stripUrlCredentials('https://cdn.test/live/joe/hunter2/list.m3u')
        ).toBe('https://cdn.test/live/list.m3u');
    });

    it('cleans a nested URL encoded more than once', () => {
        const origin = 'https://joe:hunter2@origin.test/a.m3u?token=tk98765';
        for (const rounds of [1, 2, 3]) {
            let value = origin;
            for (let round = 0; round < rounds; round += 1) {
                value = encodeURIComponent(value);
            }
            const shown = stripUrlCredentials(
                `https://proxy.test/list?url=${value}&hd=1`
            );
            expect(shown).not.toMatch(/hunter2|joe|tk98765/);
            expect(new URL(shown ?? '').searchParams.get('url')).toBe(
                'https://origin.test/a.m3u'
            );
        }
        // Still encoded after every round it decodes: not shown at all.
        let deep = origin;
        for (let round = 0; round < 8; round += 1) {
            deep = encodeURIComponent(deep);
        }
        expect(
            stripUrlCredentials(`https://proxy.test/list?url=${deep}&hd=1`)
        ).toBe('https://proxy.test/list?hd=1');
    });

    it('keeps a nested URL’s own encoded parameters as written', () => {
        const nested = `https://origin.test/a.m3u?q=${encodeURIComponent(
            'a&b=c'
        )}`;
        const shown = stripUrlCredentials(
            `https://proxy.test/list?url=${encodeURIComponent(nested)}`
        );
        expect(new URL(shown ?? '').searchParams.get('url')).toBe(nested);
        // Plain text with a stray percent sign is not an escape.
        expect(
            stripUrlCredentials('https://proxy.test/list?note=100%25&hd=1')
        ).toBe('https://proxy.test/list?note=100%25&hd=1');
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

    it('stays fast on long runs a backtracking pattern would retry', () => {
        const run = 'a'.repeat(50_000);
        const started = performance.now();
        for (const value of [run, `${run}.`.repeat(2), 'a.'.repeat(25_000)]) {
            stripUrlCredentials(
                `https://host.test/list?note=${encodeURIComponent(value)}`
            );
        }
        // About 0.25 s in total when idle; a backtracking pattern takes
        // minutes. The margin absorbs a loaded CI runner.
        expect(performance.now() - started).toBeLessThan(3_000);
    });

    it('returns null for text that is not an absolute URL', () => {
        expect(stripUrlCredentials('get.php?username=joe')).toBeNull();
        expect(stripUrlCredentials('')).toBeNull();
        expect(stripUrlCredentials('not a url')).toBeNull();
    });
});
