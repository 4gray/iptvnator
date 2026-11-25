import type { SourceServerRequest } from '@iptvnator/shared/interfaces';
import {
    isProfilePinRefusal,
    parseRetryAfter,
    profileRequestTarget,
} from './source-sync-profile-route';

const profileId = '11111111-1111-4111-8111-111111111111';

describe('profile source request route', () => {
    it.each([
        [
            { operation: 'profiles-list', revision: '7' },
            {
                path: '/v1/profiles',
                method: 'GET',
                headers: { 'If-None-Match': '"profiles-7"' },
            },
        ],
        [
            { operation: 'profiles-set-enabled', profile: { enabled: true } },
            {
                path: '/v1/profiles',
                method: 'PATCH',
                headers: {},
                body: { enabled: true },
            },
        ],
        [
            {
                operation: 'profiles-order',
                profile: { ids: ['default', profileId] },
            },
            {
                path: '/v1/profiles/order',
                method: 'PUT',
                headers: {},
                body: { ids: ['default', profileId] },
            },
        ],
        [
            { operation: 'profiles-order', profile: { ids: [] } },
            {
                path: '/v1/profiles/order',
                method: 'PUT',
                headers: {},
                body: { ids: [] },
            },
        ],
        [
            { operation: 'profile-create', profile: { name: 'Synthetic' } },
            {
                path: '/v1/profiles',
                method: 'POST',
                headers: {},
                body: { name: 'Synthetic' },
            },
        ],
        [
            {
                operation: 'profile-update',
                id: profileId,
                profile: { name: 'Updated' },
            },
            {
                path: `/v1/profiles/${profileId}`,
                method: 'PATCH',
                headers: {},
                body: { name: 'Updated' },
            },
        ],
        [
            { operation: 'profile-delete', id: profileId },
            {
                path: `/v1/profiles/${profileId}`,
                method: 'DELETE',
                headers: {},
            },
        ],
        [
            {
                operation: 'profile-unlock',
                id: profileId,
                profile: { pin: '1234' },
            },
            {
                path: `/v1/profiles/${profileId}/unlock`,
                method: 'POST',
                headers: {},
                body: { pin: '1234' },
            },
        ],
    ])('builds the expected target for %o', (request, target) => {
        expect(
            profileRequestTarget(request as unknown as SourceServerRequest)
        ).toEqual(target);
    });

    it.each([
        {
            operation: 'profile-update',
            id: 'not-a-profile',
            profile: { name: 'x' },
        },
        { operation: 'profiles-list', id: profileId },
        { operation: 'profile-create', profile: { name: 'x' }, source: {} },
        { operation: 'profile-create', profile: { name: 'x', unknown: true } },
        { operation: 'profiles-set-enabled', profile: { enabled: 'yes' } },
        {
            operation: 'profile-create',
            profile: { name: 'x', pin: '1'.repeat(17) },
        },
        {
            operation: 'profiles-order',
            profile: { ids: [profileId, profileId] },
        },
        {
            operation: 'profiles-order',
            profile: {
                ids: Array.from(
                    { length: 14 },
                    (_, index) =>
                        `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`
                ),
            },
        },
        { operation: 'profile-create', profile: { name: 'x' }, revision: '1' },
        { operation: 'profile-unlock', id: profileId },
    ])('rejects an invalid renderer request: %o', (request) => {
        expect(() => profileRequestTarget(request as never)).toThrow(
            'Invalid source request'
        );
    });

    it.each([
        ['0', 0],
        ['30', 30],
        [30, 30],
        ['soon', undefined],
        ['-1', undefined],
        ['1.5', undefined],
        [1.5, undefined],
    ])('parses Retry-After %p as %p', (value, expected) => {
        expect(parseRetryAfter(value)).toBe(expected);
    });

    it('recognizes only profile PIN refusals', () => {
        expect(
            isProfilePinRefusal(
                {
                    operation: 'profile-unlock',
                    id: profileId,
                    profile: { pin: '1234' },
                },
                { status: 403, body: { code: 'wrong_pin' } }
            )
        ).toBe(true);
        expect(
            isProfilePinRefusal(
                { operation: 'list' },
                { status: 403, body: { code: 'wrong_pin' } }
            )
        ).toBe(false);
    });
});
