import { buildStalkerRequestUrl } from './stalker-request-url.util';

const PORTAL = 'http://portal.example/stalker_portal/server/load.php';

/** Decode a query value the way PHP's `$_GET` would (one form-urldecode). */
function portalVisibleValue(encoded: string): string {
    return decodeURIComponent(encoded.replace(/\+/g, '%20'));
}

function cmdWireValue(fullUrl: string): string {
    const match = /[?&]cmd=([^&]*)/.exec(fullUrl);
    if (!match) {
        throw new Error(`no cmd param in ${fullUrl}`);
    }
    return match[1];
}

describe('buildStalkerRequestUrl', () => {
    it('builds the reference wire format for a typical create_link request', () => {
        const fullUrl = buildStalkerRequestUrl(PORTAL, {
            type: 'itv',
            action: 'create_link',
            cmd: 'ffrt3 http://host/ch/123',
        });

        expect(fullUrl).toBe(
            'http://portal.example/stalker_portal/server/load.php' +
                '?type=itv&action=create_link' +
                '&cmd=ffrt3%20http://host/ch/123&JsHttpRequest=1-xml'
        );
    });

    it.each([
        ['ffrt3 http://host/ch/123', 'ffrt3%20http://host/ch/123'],
        [
            'auto http://host/ch/123?token=abc',
            'auto%20http://host/ch/123?token=abc',
        ],
        ['/media/12345.mpg', '/media/12345.mpg'],
        [
            'auto http://host/s/a%3Ab%20c.m3u8',
            'auto%20http://host/s/a%3Ab%20c.m3u8',
        ],
    ])('sends cmd %s as %s', (cmd, expectedWireValue) => {
        const fullUrl = buildStalkerRequestUrl(PORTAL, {
            action: 'create_link',
            cmd,
        });

        expect(cmdWireValue(fullUrl)).toBe(expectedWireValue);
    });

    it('does not double-encode a cmd that already contains percent sequences', () => {
        const fullUrl = buildStalkerRequestUrl(PORTAL, {
            action: 'create_link',
            cmd: 'auto http://host/s/a%3Ab.m3u8?sig=x%2Fy',
        });

        expect(fullUrl).not.toContain('%25');
        // After the portal's single decode, pre-encoded sequences resolve —
        // exactly what it would receive from a real STB.
        expect(portalVisibleValue(cmdWireValue(fullUrl))).toBe(
            'auto http://host/s/a:b.m3u8?sig=x/y'
        );
    });

    it('blocks query-parameter injection through cmd without losing data', () => {
        const maliciousCmd =
            'http://host/ch/1?x=1&action=do_evil&mac=00:00:00:00:00:00#frag';
        const fullUrl = buildStalkerRequestUrl(PORTAL, {
            action: 'create_link',
            type: 'itv',
            cmd: maliciousCmd,
        });

        const params = new URL(fullUrl).searchParams;
        expect(params.getAll('action')).toEqual(['create_link']);
        expect(params.get('mac')).toBeNull();
        expect(params.get('x')).toBeNull();
        expect(fullUrl).not.toContain('#');
        // The dangerous characters are escaped, not stripped: the portal
        // still receives the full original cmd string after one decode.
        expect(portalVisibleValue(cmdWireValue(fullUrl))).toBe(maliciousCmd);
    });

    it('keeps full encoding for non-cmd params', () => {
        const fullUrl = buildStalkerRequestUrl(PORTAL, {
            action: 'get_profile',
            metrics: '{"mac":"00:1A:79:AA:BB:CC"}',
        });

        expect(fullUrl).toContain(
            'metrics=%7B%22mac%22%3A%2200%3A1A%3A79%3AAA%3ABB%3ACC%22%7D'
        );
    });

    it('appends JsHttpRequest only when missing', () => {
        const withoutIt = buildStalkerRequestUrl(PORTAL, { action: 'x' });
        expect(withoutIt.match(/JsHttpRequest/g)).toHaveLength(1);

        const withIt = buildStalkerRequestUrl(PORTAL, {
            action: 'x',
            JsHttpRequest: '1-xml',
        });
        expect(withIt.match(/JsHttpRequest/g)).toHaveLength(1);
    });

    it('drops any query string carried by the portal URL itself', () => {
        const fullUrl = buildStalkerRequestUrl(
            'http://portal.example/portal.php?stale=1',
            { action: 'handshake' }
        );

        expect(fullUrl).toBe(
            'http://portal.example/portal.php?action=handshake&JsHttpRequest=1-xml'
        );
    });

    it('emits URLs whose bytes survive WHATWG re-parsing (the axios transport)', () => {
        const cmds = [
            'ffrt3 http://host/ch/123',
            'auto http://host/ch/123?token=a%3Ab c',
            '/media/12345.mpg',
            'x&y=z#w;v',
            'auto http://host/канал/1',
        ];

        for (const cmd of cmds) {
            const fullUrl = buildStalkerRequestUrl(PORTAL, {
                action: 'create_link',
                cmd,
            });
            expect(new URL(fullUrl).toString()).toBe(fullUrl);
        }
    });
});
