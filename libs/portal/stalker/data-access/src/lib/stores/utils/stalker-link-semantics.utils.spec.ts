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
                    { use_http_tmp_link: '0' },
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
            expect(
                resolveStalkerStaticPlaybackUrl({ use_http_tmp_link: '0' }, cmd)
            ).toBeNull();
        });

        it.each([
            ['ffrt3 http://localhost/ch/1234_'],
            ['http://127.0.0.1:8080/ch/1234_'],
            ['http://0.0.0.0/ch/1234_'],
            ['http://[::1]/ch/1234_'],
        ])('defers to create_link for the portal-local address %p', (cmd) => {
            expect(
                resolveStalkerStaticPlaybackUrl({ use_http_tmp_link: '0' }, cmd)
            ).toBeNull();
        });

        it('gives no verdict when the caller has no row to read flags from', () => {
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

        it('gives no verdict for a row carrying neither flag key', () => {
            // A Favorite persisted before these flags were carried was
            // stripped of them by `buildStalkerSelectedVodItem`'s whitelist,
            // so it is indistinguishable from a row the portal marked
            // unflagged. There is no migration for those rows, so absence has
            // to read as "no evidence" rather than "no temporary link".
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { id: '42', cmd: 'x' } as never,
                    'ffrt3 http://cdn.example/live/42.m3u8'
                )
            ).toBeNull();
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { use_http_tmp_link: undefined, use_load_balancing: null },
                    'ffrt3 http://cdn.example/live/42.m3u8'
                )
            ).toBeNull();
        });

        it.each([
            ['http://127.0.0.2/ch/1234_'],
            ['http://127.1.2.3:8080/ch/1234_'],
            ['http://127.255.255.255/ch/1234_'],
        ])('treats the whole 127.0.0.0/8 range as portal-local (%p)', (cmd) => {
            expect(
                resolveStalkerStaticPlaybackUrl({ use_http_tmp_link: '0' }, cmd)
            ).toBeNull();
        });

        it.each([
            // `URL` keeps the brackets and normalizes the address, so these
            // reach the guard as `[::]`, `[::1]` and `[::ffff:7f00:1]`.
            ['http://[::]/ch/1234_'],
            ['http://[::1]/ch/1234_'],
            ['http://[0:0:0:0:0:0:0:1]/ch/1234_'],
            ['http://[::ffff:127.0.0.1]/ch/1234_'],
            ['http://[::ffff:7f00:1]/ch/1234_'],
            ['http://[::ffff:127.255.255.255]/ch/1234_'],
            ['http://[::ffff:0.0.0.0]/ch/1234_'],
        ])('treats the IPv6 portal-local form %p as local', (cmd) => {
            expect(
                resolveStalkerStaticPlaybackUrl({ use_http_tmp_link: '0' }, cmd)
            ).toBeNull();
        });

        it.each([
            ['ffrt3 http://localhost./ch/1234_'],
            ['http://LocalHost./ch/1234_'],
        ])('strips the DNS root dot before classifying %p', (cmd) => {
            expect(
                resolveStalkerStaticPlaybackUrl({ use_http_tmp_link: '0' }, cmd)
            ).toBeNull();
        });

        it.each([
            ['HTTP://cdn.example/live/42.m3u8'],
            ['ffrt3 HTTPS://cdn.example/live/42.m3u8'],
            ['hTTp://cdn.example/live/42.m3u8'],
        ])('accepts the case-insensitive scheme %p', (cmd) => {
            // RFC 3986 makes the scheme case-insensitive. A case-sensitive
            // test failed safe (it minted a link) but defeated the contract
            // for a portal that spells it this way.
            expect(
                resolveStalkerStaticPlaybackUrl({ use_http_tmp_link: '0' }, cmd)
            ).toMatch(/cdn\.example\/live\/42\.m3u8$/);
        });

        it.each([
            ['http:///ch/1234_'],
            ['ffrt3 https:///ch/1234_'],
        ])('defers to create_link for the authority-less url %p', (cmd) => {
            // `new URL('http:///ch/1')` reports the host as `ch` — a malformed
            // command would otherwise reach the player as a nonsense address
            // rather than going to the portal to be resolved.
            expect(
                resolveStalkerStaticPlaybackUrl({ use_http_tmp_link: '0' }, cmd)
            ).toBeNull();
        });

        it('keeps a routable IPv6 host', () => {
            // 2001:db8::1 is documentation space, but it is routable as far as
            // this guard is concerned — only local placeholders are rejected.
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { use_http_tmp_link: '0' },
                    'http://[2001:db8::1]/live/42.m3u8'
                )
            ).toBe('http://[2001:db8::1]/live/42.m3u8');
        });

        it('keeps an IPv4-mapped address that is not loopback', () => {
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { use_http_tmp_link: '0' },
                    'http://[::ffff:203.0.113.7]/live/42.m3u8'
                )
            ).not.toBeNull();
        });

        it.each([
            // RFC 6761 §6.3 reserves the whole `.localhost` suffix.
            ['http://stream.localhost/ch/1234_'],
            ['ffrt3 http://a.b.localhost/ch/1234_'],
            ['http://stream.localhost./ch/1234_'],
            // Conventional /etc/hosts alias for 127.0.0.1.
            ['http://localhost.localdomain/ch/1234_'],
        ])('treats the localhost name %p as portal-local', (cmd) => {
            expect(
                resolveStalkerStaticPlaybackUrl({ use_http_tmp_link: '0' }, cmd)
            ).toBeNull();
        });

        it('does not mistake a localhost-prefixed host for a localhost name', () => {
            // Only the SUFFIX is reserved — `localhost.cdn.example` is an
            // ordinary routable name and must keep playing statically.
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { use_http_tmp_link: '0' },
                    'http://localhost.cdn.example/live/42.m3u8'
                )
            ).toBe('http://localhost.cdn.example/live/42.m3u8');
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { use_http_tmp_link: '0' },
                    'http://notlocalhost/live/42.m3u8'
                )
            ).toBe('http://notlocalhost/live/42.m3u8');
        });

        it('does not mistake a non-loopback 127-lookalike for loopback', () => {
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { use_http_tmp_link: '0' },
                    'http://127.0.0.1.cdn.example/live/42.m3u8'
                )
            ).toBe('http://127.0.0.1.cdn.example/live/42.m3u8');
        });

        it('keeps a non-loopback host that merely looks local', () => {
            expect(
                resolveStalkerStaticPlaybackUrl(
                    { use_http_tmp_link: '0' },
                    'http://localhost.cdn.example/live/42.m3u8'
                )
            ).toBe('http://localhost.cdn.example/live/42.m3u8');
        });
    });
});
