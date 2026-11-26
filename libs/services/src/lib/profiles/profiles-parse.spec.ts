import {
    DEFAULT_PERSONAL_SCOPE,
    DEFAULT_PROFILE_ID,
    profileScope,
} from '@iptvnator/shared/interfaces/profiles';
import {
    parseServerProfile,
    parseServerProfileList,
    parseUnlockResponse,
} from './profiles-parse';

const profileId = '11111111-2222-4333-8444-555555555555';
const defaultProfile = {
    id: DEFAULT_PROFILE_ID,
    scope: DEFAULT_PERSONAL_SCOPE,
    name: 'Household',
    colour: '#A1B2C3',
    hasPin: false,
    kids: false,
    sortOrder: 0,
};
const profile = {
    id: profileId,
    scope: profileScope(profileId),
    name: 'Robin',
    colour: '#123456',
    emoji: '🦊',
    hasPin: true,
    kids: false,
    sortOrder: 1,
};

describe('profiles response parsing', () => {
    it('round-trips a valid list and strips extra fields', () => {
        const parsed = parseServerProfileList({
            enabled: true,
            revision: 3,
            profiles: [
                { ...defaultProfile, unexpected: 'drop me' },
                { ...profile, unexpected: 'drop me too' },
            ],
            unexpected: true,
        });

        expect(parsed).toEqual({
            enabled: true,
            revision: 3,
            profiles: [{ ...defaultProfile, colour: '#a1b2c3' }, profile],
        });
    });

    it.each([
        ['id', { ...profile, id: 'not-an-id' }],
        ['scope', { ...profile, scope: 'invalid' }],
        ['scope/id mismatch', { ...profile, scope: DEFAULT_PERSONAL_SCOPE }],
        ['empty name', { ...profile, name: '' }],
        ['oversized name', { ...profile, name: 'a'.repeat(65) }],
        ['colour', { ...profile, colour: 'blue' }],
        ['empty emoji', { ...profile, emoji: '' }],
        ['oversized emoji', { ...profile, emoji: 'x'.repeat(33) }],
        ['hasPin', { ...profile, hasPin: 'yes' }],
        ['kids', { ...profile, kids: 1 }],
        ['sortOrder', { ...profile, sortOrder: Infinity }],
    ])('rejects an invalid profile %s', (_field, value) => {
        expect(parseServerProfile(value)).toBeNull();
    });

    it('accepts an absent emoji but rejects null', () => {
        expect(parseServerProfile({ ...profile, emoji: undefined })).toEqual({
            id: profile.id,
            scope: profile.scope,
            name: profile.name,
            colour: profile.colour,
            hasPin: profile.hasPin,
            kids: profile.kids,
            sortOrder: profile.sortOrder,
        });
        expect(parseServerProfile({ ...profile, emoji: null })).toBeNull();
    });

    it.each([
        [
            'enabled',
            { enabled: 'true', revision: 1, profiles: [defaultProfile] },
        ],
        [
            'revision',
            { enabled: true, revision: 1.5, profiles: [defaultProfile] },
        ],
        ['profiles', { enabled: true, revision: 1, profiles: {} }],
        [
            'duplicate ids',
            {
                enabled: true,
                revision: 1,
                profiles: [defaultProfile, defaultProfile],
            },
        ],
        [
            'missing Default',
            { enabled: true, revision: 1, profiles: [profile] },
        ],
    ])('rejects an invalid list %s', (_field, value) => {
        expect(parseServerProfileList(value)).toBeNull();
    });

    it('recognizes only the explicit unlock response', () => {
        expect(parseUnlockResponse({ unlocked: true })).toBe(true);
        expect(parseUnlockResponse({ unlocked: false })).toBeNull();
        expect(parseUnlockResponse({})).toBeNull();
    });
});
