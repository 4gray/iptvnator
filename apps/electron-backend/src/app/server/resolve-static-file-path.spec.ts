import { posix, win32 } from 'node:path';

import { resolveStaticFilePath } from './http-server';

describe('resolveStaticFilePath', () => {
    const POSIX_STATIC_ROOT = '/opt/iptvnator/remote-control';
    const WINDOWS_STATIC_ROOT = 'C:\\iptvnator\\remote-control';

    it('rejects a Windows double-leading-slash traversal', () => {
        expect(
            resolveStaticFilePath(
                WINDOWS_STATIC_ROOT,
                '//../../outside-secret.txt',
                win32
            )
        ).toBeNull();
    });

    it('rejects encoded traversal segments after one decode', () => {
        expect(
            resolveStaticFilePath(
                POSIX_STATIC_ROOT,
                '/%2e%2e/outside-secret.txt',
                posix
            )
        ).toBeNull();
    });

    it('fails closed for malformed percent encoding without throwing', () => {
        expect(
            resolveStaticFilePath(POSIX_STATIC_ROOT, '/%E0%A4%A', posix)
        ).toBeNull();
    });

    it('rejects decoded NUL bytes', () => {
        expect(
            resolveStaticFilePath(
                POSIX_STATIC_ROOT,
                '/assets/%00secret.js',
                posix
            )
        ).toBeNull();
    });

    it('resolves a valid Windows-style asset inside the static root', () => {
        expect(
            resolveStaticFilePath(
                WINDOWS_STATIC_ROOT,
                '/assets\\app.js?version=1',
                win32
            )
        ).toBe('C:\\iptvnator\\remote-control\\assets\\app.js');
    });

    it('ignores query and fragment data for filesystem resolution', () => {
        expect(
            resolveStaticFilePath(
                POSIX_STATIC_ROOT,
                '/data.json?cache=1#ignored',
                posix
            )
        ).toBe('/opt/iptvnator/remote-control/data.json');
    });

    it('decodes the URL pathname exactly once', () => {
        expect(
            resolveStaticFilePath(
                POSIX_STATIC_ROOT,
                '/%252e%252e/asset.js',
                posix
            )
        ).toBe('/opt/iptvnator/remote-control/%2e%2e/asset.js');
    });
});
