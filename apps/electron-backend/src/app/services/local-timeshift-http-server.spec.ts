import {
    localTimeshiftResponseHeaders,
    resolveLocalTimeshiftFileName,
} from './local-timeshift-http-server';

describe('local timeshift HTTP server security', () => {
    const token = 'long-random-test-token';

    it.each([
        [`/${token}/index.m3u8`, 'index.m3u8'],
        [`/${token}/segment-000000001.ts`, 'segment-000000001.ts'],
        [`/${token}/segment-42.m4s`, 'segment-42.m4s'],
        [`/${token}/segment-42.mp4`, 'segment-42.mp4'],
        [`/${token}/init.mp4`, 'init.mp4'],
        [`/${token}/init-2.mp4`, 'init-2.mp4'],
    ])('allows a token-protected HLS file: %s', (url, fileName) => {
        expect(resolveLocalTimeshiftFileName(url, token)).toBe(fileName);
    });

    it.each([
        '/wrong-token/index.m3u8',
        `/${token}/secret.txt`,
        `/${token}/segment-1.ts.tmp`,
        `/${token}/%2e%2e/secret.txt`,
        `/${token}/..%2fsecret.txt`,
        `/${token}/nested%2fsegment-1.ts`,
        `/${token}/segment-name.ts`,
        `/${token}/index.m3u8/extra`,
    ])('rejects an invalid or traversing path: %s', (url) => {
        expect(resolveLocalTimeshiftFileName(url, token)).toBeUndefined();
    });

    it('sets no-store and loopback-only CORS response headers', () => {
        expect(localTimeshiftResponseHeaders('http://localhost:4200')).toEqual(
            expect.objectContaining({
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Access-Control-Allow-Origin': 'http://localhost:4200',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Range',
            })
        );
        expect(
            localTimeshiftResponseHeaders('http://127.0.0.1:4200')
        ).toHaveProperty(
            'Access-Control-Allow-Origin',
            'http://127.0.0.1:4200'
        );
        expect(localTimeshiftResponseHeaders('null')).toHaveProperty(
            'Access-Control-Allow-Origin',
            'null'
        );
        expect(
            localTimeshiftResponseHeaders('https://attacker.example')
        ).not.toHaveProperty('Access-Control-Allow-Origin');
    });
});
