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
