import {
    extractXtreamCredentialsFromUrl,
    normalizeXtreamServerUrl,
    resolveXtreamPortalStatus,
} from './xtream-portal.utils';

describe('xtream portal utilities', () => {
    describe('normalizeXtreamServerUrl', () => {
        it.each([
            [' https://example.com/ ', 'https://example.com'],
            ['https://example.com/base/', 'https://example.com/base'],
            [
                'https://example.com/get.php?username=user&password=pass&type=m3u_plus',
                'https://example.com',
            ],
            [
                'https://example.com/base/player_api.php?username=user&password=pass',
                'https://example.com/base',
            ],
        ])('normalizes %s to %s', (input, expected) => {
            expect(normalizeXtreamServerUrl(input)).toBe(expected);
        });

        it('rejects non-http portal URLs', () => {
            expect(() =>
                normalizeXtreamServerUrl('file://example.com/portal')
            ).toThrow('Only http and https Xtream URLs are supported');
        });
    });

    describe('extractXtreamCredentialsFromUrl', () => {
        it('extracts and trims credentials from a full Xtream playlist URL', () => {
            expect(
                extractXtreamCredentialsFromUrl(
                    'https://example.com/get.php?username=%20user%20&password=%20pass%20&type=m3u_plus'
                )
            ).toEqual({
                username: 'user',
                password: 'pass',
            });
        });

        it('returns null when the URL has no usable credentials', () => {
            expect(
                extractXtreamCredentialsFromUrl('https://example.com/get.php')
            ).toBeNull();
        });
    });

    describe('resolveXtreamPortalStatus', () => {
        const now = new Date('2026-06-14T00:00:00.000Z');

        it('accepts active status case-insensitively and treats exp_date 0 as unlimited', () => {
            expect(
                resolveXtreamPortalStatus(
                    {
                        user_info: {
                            auth: 1,
                            status: 'active',
                            exp_date: '0',
                        },
                    },
                    now
                )
            ).toBe('active');
        });

        it('uses auth=1 as active when status is missing', () => {
            expect(
                resolveXtreamPortalStatus(
                    {
                        user_info: {
                            auth: '1',
                            exp_date: String(now.getTime() / 1000 + 3600),
                        },
                    },
                    now
                )
            ).toBe('active');
        });

        it('marks explicit auth failure as inactive', () => {
            expect(
                resolveXtreamPortalStatus({
                    user_info: {
                        auth: 0,
                    },
                })
            ).toBe('inactive');
        });

        it('marks active accounts with past expiration as expired', () => {
            expect(
                resolveXtreamPortalStatus(
                    {
                        user_info: {
                            auth: 1,
                            status: 'Active',
                            exp_date: String(now.getTime() / 1000 - 3600),
                        },
                    },
                    now
                )
            ).toBe('expired');
        });
    });
});
