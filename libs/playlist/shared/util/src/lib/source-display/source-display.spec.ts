import {
    sourceCopyUrl,
    sourceDisplayName,
    sourceSortName,
    sourceDisplayUrl,
    sourceHost,
} from './source-display';

const M3U_URL =
    'http://biggie.to:8080/get.php?username=joe&password=hunter2&type=m3u_plus';

describe('sourceDisplayName', () => {
    it('keeps a name the user chose', () => {
        expect(sourceDisplayName({ title: 'Free TV', url: M3U_URL })).toBe(
            'Free TV'
        );
    });

    it('shows the host when the source has no name', () => {
        expect(sourceDisplayName({ title: '', url: M3U_URL })).toBe(
            'biggie.to:8080'
        );
        expect(
            sourceDisplayName({
                title: '',
                serverUrl: 'http://xtream.tv:80',
                username: 'joe',
                password: 'hunter2',
            })
        ).toBe('xtream.tv');
    });

    it('shows the host for the name an URL import derives', () => {
        // The import stores the URL's last segment, query and all.
        expect(
            sourceDisplayName({
                title: 'get.php?username=joe&password=hunter2&type=m3u_plus',
                url: M3U_URL,
            })
        ).toBe('biggie.to:8080');
    });

    it('shows the host for a pasted URL', () => {
        expect(
            sourceDisplayName({
                title: 'https://cdn.tv/lists/clean.m3u',
                url: 'https://cdn.tv/lists/clean.m3u',
            })
        ).toBe('cdn.tv');
    });

    it('drops a name that carries a credential', () => {
        expect(
            sourceDisplayName({
                title: 'My portal pass== hunter2',
                serverUrl: 'http://xtream.tv',
            })
        ).toBe('xtream.tv');
        expect(
            sourceDisplayName({
                title: 'backup hunter2',
                serverUrl: 'http://xtream.tv',
                password: 'hunter2',
            })
        ).toBe('xtream.tv');
        expect(
            sourceDisplayName({
                title: 'Box 00:1A:79:00:00:01',
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'http://portal.tv/c/',
            })
        ).toBe('portal.tv');
    });

    it('keeps an account name in the name: it is shown by design', () => {
        expect(sourceDisplayName({ title: 'joe', url: M3U_URL })).toBe('joe');
        expect(
            sourceDisplayName({
                title: 'joe',
                url: 'https://host.test/list?usr=joe&pass=hunter2',
            })
        ).toBe('joe');
    });

    it('reads keys, markers and values through every encoding layer', () => {
        for (const url of [
            'https://proxy.test/list?%2570assword=hunter2',
            'https://origin.test/%256Cive/joe/hunter2/1.ts',
        ]) {
            expect(sourceDisplayName({ title: 'Mine hunter2', url })).toBe(
                new URL(url).host
            );
        }
        // A password encoded twice still matches the name it appears in.
        const url = `https://host.test/list?password=${encodeURIComponent(
            encodeURIComponent('pw#9876')
        )}`;
        expect(sourceDisplayName({ title: 'Mine pw#9876', url })).toBe(
            'host.test'
        );
    });

    it('drops a name holding an account hidden behind encoded separators', () => {
        for (const url of [
            'https://origin.test/live%2Fjoe%2Fhunter2%2F1.ts',
            'https://origin.test/live/joe%2Fx/hunter2/1.ts',
        ]) {
            expect(sourceDisplayName({ title: 'Mine hunter2', url })).toBe(
                'origin.test'
            );
        }
    });

    it('drops a name holding a secret of a JSON config in the URL', () => {
        for (const json of [
            '{"password":"hunter2"}',
            '{"pass\\u0077ord":"hunter2"}',
            '{"proxy":{"upstream":"http://joe:hunter2@origin.test/a"}}',
        ]) {
            const url = `https://proxy.test/list?config=${encodeURIComponent(json)}`;
            expect(sourceDisplayName({ title: 'Mine hunter2', url })).toBe(
                'proxy.test'
            );
        }
        expect(
            sourceDisplayName({
                title: 'Mine',
                url: 'https://proxy.test/list?config=%7B%22hd%22%3A1%7D',
            })
        ).toBe('Mine');
    });

    it('reads a bracketed key that only starts like JSON as parameters', () => {
        const url = `https://proxy.test/list?config=${encodeURIComponent(
            '[password]=hunter2'
        )}`;
        expect(sourceDisplayName({ title: 'Mine hunter2', url })).toBe(
            'proxy.test'
        );
    });

    it('drops a name that is nothing but a short password', () => {
        const xtream = {
            serverUrl: 'http://xtream.tv:8080',
            username: 'joe',
            password: 'pw',
        };
        expect(sourceDisplayName({ ...xtream, title: 'pw' })).toBe(
            'xtream.tv:8080'
        );
        expect(sourceDisplayName({ ...xtream, title: ' pw ' })).toBe(
            'xtream.tv:8080'
        );
        // A password has its own case: `PW` is not `pw`.
        expect(sourceDisplayName({ ...xtream, title: 'PW' })).toBe('PW');
        // Inside a longer name a short password is just letters.
        expect(sourceDisplayName({ ...xtream, title: 'Pwnova' })).toBe(
            'Pwnova'
        );
        expect(sourceDisplayUrl({ ...xtream, username: 'pw' })).toBe(
            'http://xtream.tv:8080'
        );
    });

    it('finds a MAC from the URL whatever its letter case', () => {
        const mac = '00:1A:79:00:00:01';
        for (const url of [
            `https://host.test/list.m3u?mac=${mac}`,
            `https://proxy.test/list?url=${encodeURIComponent(
                `http://origin.test/c/?mac=${mac}`
            )}`,
        ]) {
            expect(
                sourceDisplayName({ title: 'Box 00:1a:79:00:00:01', url })
            ).toBe(new URL(url).host);
        }
    });

    it('keeps a name holding the password word in another case', () => {
        expect(
            sourceDisplayName({
                title: 'Stress Portal',
                serverUrl: 'http://xtream.tv',
                username: 'stress',
                password: 'stress',
            })
        ).toBe('Stress Portal');
    });

    it('keeps a name that only shares a letter with a decoded password', () => {
        // `%2542` is the password as written; decoded it is just `B`.
        const url = 'https://host.test/list?password=%2542';
        expect(sourceDisplayName({ title: 'Bay News', url })).toBe('Bay News');
        expect(sourceDisplayName({ title: 'Mine %42', url })).toBe('host.test');
    });

    it('drops a name holding a password under a short account key', () => {
        for (const key of ['pass', 'pas', 'PASS']) {
            const url = `https://host.test/list?user=joe&${key}=hunter2`;
            expect(sourceDisplayName({ title: 'hunter2', url })).toBe(
                'host.test'
            );
            expect(sourceDisplayName({ title: 'Mine hunter2', url })).toBe(
                'host.test'
            );
        }
    });

    it('shows the host for a name an import took from a URL fragment', () => {
        const url = 'https://host.test/list.m3u#api_key=secret123';
        expect(
            sourceDisplayName({ title: 'list.m3u#api_key=secret123', url })
        ).toBe('host.test');
        // A typed name holding the fragment's secret collapses too.
        expect(sourceDisplayName({ title: 'My secret123', url })).toBe(
            'host.test'
        );
    });

    it('drops a name holding a secret of a URL nested in the source URL', () => {
        const url = `https://proxy.test/list?url=${encodeURIComponent(
            'http://joe:hunter2@origin.test/get.php?password=pw4567&type=m3u'
        )}`;
        for (const title of ['Mine hunter2', 'Mine pw4567', 'Mine joe']) {
            expect(sourceDisplayName({ title, url })).toBe('proxy.test');
        }
        expect(sourceDisplayName({ title: 'Mine', url })).toBe('Mine');
    });

    it('drops a name holding the password of an Xtream stream path', () => {
        const url = 'http://host.tv/LIVE/joe/hunter2/1.ts';
        expect(sourceDisplayName({ title: 'Mine hunter2', url })).toBe(
            'host.tv'
        );
        expect(
            sourceDisplayName({
                title: 'My hunter2',
                url: 'https://host.test/live/joe/hunter2/list.m3u',
            })
        ).toBe('host.test');
    });

    it('drops a name holding a secret of a URL in the fragment', () => {
        const url = 'https://proxy.test/list#https://joe:hunter2@origin.test/a';
        for (const title of ['Mine hunter2', 'Mine joe']) {
            expect(sourceDisplayName({ title, url })).toBe('proxy.test');
        }
        expect(sourceDisplayName({ title: 'Mine', url })).toBe('Mine');
    });

    it('keeps a playlist file name from a path that names no account', () => {
        const url = 'https://cdn.example/live/news/list.m3u';
        expect(sourceDisplayName({ title: 'list.m3u', url })).toBe('list.m3u');
    });

    it('drops a name holding a secret of a nested URL encoded twice', () => {
        const url = `https://proxy.test/list?url=${encodeURIComponent(
            encodeURIComponent('http://joe:hunter2@origin.test/a.m3u')
        )}`;
        for (const title of ['Mine hunter2', 'Mine joe']) {
            expect(sourceDisplayName({ title, url })).toBe('proxy.test');
        }
    });

    it('drops a name holding a secret of a URL nested in a path segment', () => {
        const url = `https://proxy.test/fetch/${encodeURIComponent(
            'http://origin.test/live/joe/hunter2/1.ts'
        )}/token=tk98765`;
        for (const title of ['Mine hunter2', 'Mine joe', 'Mine tk98765']) {
            expect(sourceDisplayName({ title, url })).toBe('proxy.test');
        }
        expect(sourceDisplayName({ title: 'Mine', url })).toBe('Mine');
    });

    it('returns null for a local file without a name', () => {
        expect(sourceDisplayName({ title: '' })).toBeNull();
        expect(sourceDisplayName({ title: '', filename: 'list.m3u' })).toBe(
            'list.m3u'
        );
    });
});

describe('sourceSortName', () => {
    it('sorts a source by the name it shows', () => {
        expect(sourceSortName({ title: 'get.php?x=1', url: M3U_URL })).toBe(
            sourceDisplayName({ title: 'get.php?x=1', url: M3U_URL })
        );
        expect(sourceSortName({ title: '' })).toBe('');
    });
});

describe('sourceDisplayUrl', () => {
    it('shows an M3U URL without credentials', () => {
        expect(sourceDisplayUrl({ url: M3U_URL })).toBe(
            'http://biggie.to:8080/get.php?type=m3u_plus'
        );
    });

    it('shortens a long path to its last segment', () => {
        expect(
            sourceDisplayUrl({
                url: 'https://raw.githubusercontent.com/user/repo/main/clean.m3u',
            })
        ).toBe('https://raw.githubusercontent.com/…/clean.m3u');
        expect(
            sourceDisplayUrl({
                url: 'https://iptv-org.github.io/iptv/index.m3u',
            })
        ).toBe('https://iptv-org.github.io/iptv/index.m3u');
    });

    it('shows host, port and account for Xtream, never the password', () => {
        expect(
            sourceDisplayUrl({
                serverUrl: 'http://xtream.tv:8080/',
                username: 'joe',
                password: 'hunter2',
            })
        ).toBe('http://xtream.tv:8080 · joe');
    });

    it('leaves out an account name that is, or holds, the password', () => {
        for (const username of ['hunter2', 'joe-hunter2']) {
            expect(
                sourceDisplayUrl({
                    serverUrl: 'http://xtream.tv:8080/',
                    username,
                    password: 'hunter2',
                })
            ).toBe('http://xtream.tv:8080');
        }
    });

    it('shows the portal URL for Stalker, never the MAC', () => {
        expect(
            sourceDisplayUrl({
                macAddress: '00:1A:79:00:00:01',
                portalUrl:
                    'http://portal.tv/stalker_portal/c/?mac=00:1A:79:00:00:01',
            })
        ).toBe('http://portal.tv/stalker_portal/c/');
    });

    it('falls back to the origin when a secret sits in the path', () => {
        expect(
            sourceDisplayUrl({
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'http://portal.tv/00:1A:79:00:00:01/c/',
            })
        ).toBe('http://portal.tv');
    });

    it('finds a secret whatever the case of its escapes or letters', () => {
        for (const portalUrl of [
            'http://portal.tv/00%3a1A%3a79%3a00%3a00%3a01/c/',
            'http://portal.tv/00:1a:79:00:00:01/c/',
        ]) {
            expect(
                sourceDisplayUrl({ macAddress: '00:1A:79:00:00:01', portalUrl })
            ).toBe('http://portal.tv');
        }
        expect(
            sourceDisplayName({
                title: 'Box 00:1a:79:00:00:01',
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'http://portal.tv/c/',
            })
        ).toBe('portal.tv');
    });

    it('has no URL for a local file or an unparsable address', () => {
        expect(sourceDisplayUrl({ title: 'local' })).toBeNull();
        expect(sourceDisplayUrl({ url: 'not a url' })).toBeNull();
        expect(
            sourceDisplayUrl({ serverUrl: 'nope', username: 'joe' })
        ).toBeNull();
    });

    it('never shows a password, token or MAC', () => {
        const sources = [
            { url: M3U_URL },
            { url: 'http://joe:hunter2@cdn.tv/a/b/c/list.m3u?token=hunter2' },
            { serverUrl: 'http://x.tv', username: 'joe', password: 'hunter2' },
            {
                macAddress: 'hunter2',
                portalUrl: 'http://p.tv/c/?mac=hunter2&sn=hunter2',
            },
        ];
        for (const source of sources) {
            expect(sourceDisplayUrl(source) ?? '').not.toMatch(/hunter2/);
            expect(
                sourceDisplayName({ ...source, title: '' }) ?? ''
            ).not.toMatch(/hunter2/);
        }
    });
});

describe('sourceHost and sourceCopyUrl', () => {
    it('reads the endpoint by provider precedence', () => {
        const stalker = {
            macAddress: '00:1A:79:00:00:01',
            portalUrl: 'http://portal.tv/c/',
            url: 'http://other.tv/list.m3u',
        };
        expect(sourceHost(stalker)).toBe('portal.tv');
        expect(sourceCopyUrl(stalker)).toBe('http://portal.tv/c/');
        expect(sourceCopyUrl({ url: M3U_URL })).toBe(M3U_URL);
        expect(sourceCopyUrl({})).toBeNull();
        expect(sourceHost({})).toBeNull();
    });
});
