import { profilesErrorOf, profilesOfflineError } from './profiles-errors';

const response = (status: number, body?: unknown, retryAfter?: number) => ({
    status,
    body,
    ...(retryAfter === undefined ? {} : { retryAfter }),
});

describe('profiles errors', () => {
    it.each([
        ['pin_required', 403],
        ['wrong_pin', 403],
        ['profiles_disabled', 409],
        ['profile_missing', 404],
        ['profile_name_taken', 409],
        ['profile_limit', 409],
        ['profile_order_mismatch', 409],
        ['kids_profile_pin', 400],
        ['default_profile', 400],
        ['default_profile_kids', 400],
        ['pin_changed', 409],
        ['invalid_profile_name', 400],
        ['invalid_profile_colour', 400],
        ['invalid_profile_emoji', 400],
        ['invalid_pin', 400],
        ['invalid_profile_order', 400],
        ['invalid_profiles_setting', 400],
        ['invalid_body', 400],
    ] as const)('maps %s from the profiles router', (code, status) => {
        expect(profilesErrorOf(response(status, { code }))).toEqual({
            code,
        });
    });

    it('maps special body errors and pin retry delays', () => {
        expect(
            profilesErrorOf(response(400, { code: 'invalid_json' }))
        ).toEqual({ code: 'invalid_body' });
        expect(profilesErrorOf(response(413, { code: 'too_large' }))).toEqual({
            code: 'invalid_body',
        });
        expect(
            profilesErrorOf(response(429, { code: 'pin_locked' }, 30))
        ).toEqual({ code: 'pin_locked', retryAfter: 30 });
        expect(profilesErrorOf(response(429, { code: 'pin_locked' }))).toEqual({
            code: 'pin_locked',
            retryAfter: null,
        });
        expect(
            profilesErrorOf(response(429, { code: 'pin_rate_limited' }, 12))
        ).toEqual({ code: 'pin_rate_limited', retryAfter: 12 });
        expect(
            profilesErrorOf(response(429, { code: 'pin_rate_limited' }, -1))
        ).toEqual({ code: 'pin_rate_limited', retryAfter: null });
    });

    it.each([
        response(401, { code: 'pin_required' }),
        response(403, {}),
        response(409, { code: 'instance_changed' }),
        response(403, { code: 'access_required' }),
        response(404, '<html>not found</html>'),
        response(500, { code: 'profile_missing' }),
    ])(
        'maps unavailable or offline responses without trusting their body',
        (value) => {
            expect(profilesErrorOf(value)).toEqual({
                code: value.status >= 500 ? 'offline' : 'unavailable',
            });
        }
    );

    it('has a payload-free offline error for thrown requests', () => {
        expect(profilesOfflineError()).toEqual({ code: 'offline' });
    });
});
