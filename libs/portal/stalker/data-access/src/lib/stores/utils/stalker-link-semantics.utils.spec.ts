import {
    isStalkerPortalFlagEnabled,
    requiresStalkerTemporaryLink,
    resolveStalkerStaticPlaybackUrl,
} from './stalker-link-semantics.utils';

describe('stalker-link-semantics', () => {
    describe('isStalkerPortalFlagEnabled', () => {
        it.each([
            ['1', true],
            [1, true],
            [true, true],
            ['true', true],
            ['0', false],
            [0, false],
            [false, false],
            ['false', false],
            ['', false],
            ['   ', false],
            [null, false],
            [undefined, false],
            [Number.NaN, false],
        ])('reads %p as %p', (value, expected) => {
            expect(isStalkerPortalFlagEnabled(value)).toBe(expected);
        });
    });

    describe('requiresStalkerTemporaryLink', () => {
        it('is false for a row that sets neither flag', () => {
            expect(
                requiresStalkerTemporaryLink({
                    use_http_tmp_link: '0',
                    use_load_balancing: '0',
                })
            ).toBe(false);
        });

        it('is false when the row carries no flags at all', () => {
            expect(requiresStalkerTemporaryLink({})).toBe(false);
            expect(requiresStalkerTemporaryLink(undefined)).toBe(false);
        });

        it.each(['use_http_tmp_link', 'use_load_balancing'] as const)(
            'is true when %s is set',
            (flag) => {
                expect(requiresStalkerTemporaryLink({ [flag]: '1' })).toBe(true);
            }
        );
    });

    describe('resolveStalkerStaticPlaybackUrl', () => {
        it('plays an unflagged absolute command and strips the solution prefix', () => {
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { use_http_tmp_link: '0', use_load_balancing: '0' },
                    'ffrt3 http://cdn.example/live/42.m3u8'
                )
            ).toBe('http://cdn.example/live/42.m3u8');
        });

        it('accepts a bare URL with no solution prefix', () => {
            expect(
                resolveStalkerStaticPlaybackUrl(
                    {},
                    'https://cdn.example/live/42.m3u8'
                )
            ).toBe('https://cdn.example/live/42.m3u8');
        });

        it.each(['use_http_tmp_link', 'use_load_balancing'] as const)(
            'defers to create_link when %s is set',
            (flag) => {
                expect(
                    resolveStalkerStaticPlaybackUrl(
                        { [flag]: '1' },
                        'ffrt3 http://cdn.example/live/42.m3u8'
                    )
                ).toBeNull();
            }
        );

        it.each([
            // The VOD has_files rewrite produces exactly this shape.
            ['/media/file_42.mpg'],
            ['?token=abc'],
            ['ffrt4://ch/live/10001/index.m3u8'],
            ['rtmp://cdn.example/live/42'],
            [''],
            ['   '],
        ])('defers to create_link for the unresolvable command %p', (cmd) => {
            expect(resolveStalkerStaticPlaybackUrl({}, cmd)).toBeNull();
        });

        it.each([
            ['ffrt3 http://localhost/ch/1234_'],
            ['http://127.0.0.1:8080/ch/1234_'],
            ['http://0.0.0.0/ch/1234_'],
            ['http://[::1]/ch/1234_'],
        ])('defers to create_link for the portal-local address %p', (cmd) => {
            expect(resolveStalkerStaticPlaybackUrl({}, cmd)).toBeNull();
        });

        it('gives no verdict when the caller has no row to read flags from', () => {
            // Distinct from a row that simply carries no flags: the caller
            // cannot vouch for the row, so the portal decides.
            expect(
                resolveStalkerStaticPlaybackUrl(
                    undefined,
                    'ffrt3 http://cdn.example/live/42.m3u8'
                )
            ).toBeNull();
            expect(
                resolveStalkerStaticPlaybackUrl(
                    null,
                    'ffrt3 http://cdn.example/live/42.m3u8'
                )
            ).toBeNull();
        });

        it('keeps a non-loopback host that merely looks local', () => {
            expect(
                resolveStalkerStaticPlaybackUrl(
                    {},
                    'http://localhost.cdn.example/live/42.m3u8'
                )
            ).toBe('http://localhost.cdn.example/live/42.m3u8');
        });
    });
});
