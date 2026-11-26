import {
    markProfilePicked,
    PROFILE_PICKER_FALLBACK,
    profilePickedThisSession,
    resetProfilePickedForTests,
    sanitizeReturnUrl,
} from './profile-picker-route';

describe('sanitizeReturnUrl', () => {
    it.each([
        ['/workspace/dashboard', '/workspace/dashboard'],
        [
            '/workspace/settings/profiles?x=1#top',
            '/workspace/settings/profiles?x=1#top',
        ],
        ['/workspace/playlists/abc', '/workspace/playlists/abc'],
    ])('keeps the in-app path %s', (value, expected) => {
        expect(sanitizeReturnUrl(value)).toBe(expected);
    });

    it.each([
        'https://evil.test/x',
        '//evil.test/x',
        '/\\evil.test',
        'javascript:alert(1)',
        'workspace',
        '',
        '/profile-picker',
        '/profile-picker?returnUrl=%2Fworkspace',
        '/server-sign-in',
        '/',
        '/workspace\n/x',
        `/${'a'.repeat(3000)}`,
        null,
        undefined,
        42,
    ])('falls back to the workspace for %p', (value) => {
        expect(sanitizeReturnUrl(value)).toBe(PROFILE_PICKER_FALLBACK);
    });
});

describe('session answer', () => {
    afterEach(resetProfilePickedForTests);

    it('is empty at app start and set once the picker was answered', () => {
        expect(profilePickedThisSession()).toBe(false);
        markProfilePicked();
        expect(profilePickedThisSession()).toBe(true);
    });
});
