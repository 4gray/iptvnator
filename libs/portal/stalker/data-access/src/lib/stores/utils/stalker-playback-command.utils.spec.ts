import {
    hasHttpScheme,
    isPlayableHttpUrl,
    normalizeStalkerPlaybackCommand,
    resolveStalkerPlaybackUrl,
} from './stalker-playback-command.utils';

const PORTAL = 'http://demo.example/stalker_portal/server/load.php';

describe('stalker-playback-command.utils', () => {
    describe('hasHttpScheme', () => {
        it.each([
            ['http://a/b', true],
            ['https://a/b', true],
            ['HTTP://a/b', true],
            ['HtTpS://a/b', true],
            ['ffrt4://a/b', false],
            ['rtmp://a/b', false],
            ['/media/1.mpg', false],
            ['', false],
        ])('reads %p as %p', (value, expected) => {
            expect(hasHttpScheme(value)).toBe(expected);
        });
    });

    describe('isPlayableHttpUrl', () => {
        it.each([
            ['http://cdn.example/a.ts', true],
            ['HTTPS://cdn.example/a.ts', true],
            ['http://[::1]/a.ts', true],
            // `new URL` reinterprets the first path segment as the host here.
            ['http:///ch/1', false],
            ['https:///ch/1', false],
            ['ffrt4://ch/1', false],
            ['/media/1.mpg', false],
        ])('reads %p as %p', (value, expected) => {
            expect(isPlayableHttpUrl(value)).toBe(expected);
        });
    });

    describe('normalizeStalkerPlaybackCommand', () => {
        it('splits the solution prefix off a lowercase url', () => {
            expect(
                normalizeStalkerPlaybackCommand('ffrt3 http://cdn.example/a.ts')
            ).toBe('http://cdn.example/a.ts');
        });

        it('splits the solution prefix off an uppercase scheme too', () => {
            // RFC 3986 makes the scheme case-insensitive; a case-sensitive
            // test returned the whole `ffrt3 HTTP://…` string as if it were
            // the URL.
            expect(
                normalizeStalkerPlaybackCommand('ffrt3 HTTP://cdn.example/a.ts')
            ).toBe('HTTP://cdn.example/a.ts');
        });

        it('leaves a bare command untouched', () => {
            expect(
                normalizeStalkerPlaybackCommand('ffrt4://ch/live/1/index.m3u8')
            ).toBe('ffrt4://ch/live/1/index.m3u8');
        });

        it('keeps relative and query-only replies', () => {
            expect(
                normalizeStalkerPlaybackCommand('ffmpeg /media/file_1.mpg')
            ).toBe('/media/file_1.mpg');
            expect(normalizeStalkerPlaybackCommand('ffmpeg ?token=abc')).toBe(
                '?token=abc'
            );
        });
    });

    describe('resolveStalkerPlaybackUrl', () => {
        it('returns an absolute reply as-is regardless of scheme case', () => {
            expect(
                resolveStalkerPlaybackUrl(
                    PORTAL,
                    '/media/source.mpg',
                    'ffmpeg HTTPS://cdn.example/a.ts'
                )
            ).toBe('HTTPS://cdn.example/a.ts');
        });

        it('resolves a relative reply against the installation base', () => {
            expect(
                resolveStalkerPlaybackUrl(
                    PORTAL,
                    '/media/source.mpg',
                    '/media/video_7.mpg'
                )
            ).toBe('http://demo.example/stalker_portal/media/video_7.mpg');
        });

        it('appends a query-only reply to an uppercase-scheme command', () => {
            // The original `cmd` is already an address, so the query belongs
            // on it rather than on the portal base.
            expect(
                resolveStalkerPlaybackUrl(
                    PORTAL,
                    'auto HTTP://cdn.example/live/9.m3u8',
                    '?token=xyz'
                )
            ).toBe('HTTP://cdn.example/live/9.m3u8?token=xyz');
        });

        it('appends a query-only reply to a relative command via the base', () => {
            expect(
                resolveStalkerPlaybackUrl(PORTAL, '/ch/9', '?token=xyz')
            ).toBe('http://demo.example/stalker_portal/ch/9?token=xyz');
        });

        it('returns an empty string for an empty reply', () => {
            expect(resolveStalkerPlaybackUrl(PORTAL, '/ch/9', '')).toBe('');
        });
    });
});
