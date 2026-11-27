import { DEFAULT_PROFILE_ID } from '@iptvnator/shared/interfaces/profiles';
import {
    activeProfileKey,
    clearActiveProfileId,
    profilesStartKey,
    readActiveProfileId,
    readProfilesStart,
    writeActiveProfileId,
    writeProfilesStart,
} from './profiles-preferences';

const NAS = 'synthetic-nas';
const OTHER = 'synthetic-other';
const ADULT = '11111111-1111-4111-8111-111111111111';

describe('per-device profile preferences', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('keys each preference by server instance', () => {
        expect(profilesStartKey(NAS)).toBe(
            'iptvnator-server:synthetic-nas:profiles-start-v1'
        );
        expect(activeProfileKey(NAS)).toBe(
            'iptvnator-server:synthetic-nas:active-profile-v1'
        );
        expect(profilesStartKey(null)).toBeNull();
        expect(activeProfileKey(undefined)).toBeNull();
    });

    it('defaults the start-up preference to "ask"', () => {
        expect(readProfilesStart(NAS)).toBe('ask');
        expect(readProfilesStart(null)).toBe('ask');
    });

    it('round-trips the start-up preference per instance', () => {
        expect(writeProfilesStart(NAS, 'last')).toBe(true);
        expect(readProfilesStart(NAS)).toBe('last');
        expect(readProfilesStart(OTHER)).toBe('ask');
        expect(writeProfilesStart(NAS, 'ask')).toBe(true);
        expect(readProfilesStart(NAS)).toBe('ask');
    });

    it('reads an unrecognised stored start-up value as "ask"', () => {
        localStorage.setItem(
            `iptvnator-server:${NAS}:profiles-start-v1`,
            'always'
        );
        expect(readProfilesStart(NAS)).toBe('ask');
    });

    it('does not write without a server instance', () => {
        expect(writeProfilesStart(null, 'last')).toBe(false);
        expect(writeActiveProfileId(undefined, ADULT)).toBe(false);
        expect(localStorage.length).toBe(0);
    });

    it('round-trips the active profile per instance', () => {
        expect(writeActiveProfileId(NAS, ADULT)).toBe(true);
        expect(readActiveProfileId(NAS)).toBe(ADULT);
        expect(readActiveProfileId(OTHER)).toBeNull();
        expect(writeActiveProfileId(NAS, DEFAULT_PROFILE_ID)).toBe(true);
        expect(readActiveProfileId(NAS)).toBe(DEFAULT_PROFILE_ID);
    });

    it('refuses to store an id that is not a profile id', () => {
        expect(writeActiveProfileId(NAS, '../escape')).toBe(false);
        expect(readActiveProfileId(NAS)).toBeNull();
    });

    it('ignores a stored active id that is not a profile id', () => {
        localStorage.setItem(
            `iptvnator-server:${NAS}:active-profile-v1`,
            'not-a-profile'
        );
        expect(readActiveProfileId(NAS)).toBeNull();
    });

    it('clears only this instance', () => {
        writeActiveProfileId(NAS, ADULT);
        writeActiveProfileId(OTHER, ADULT);
        clearActiveProfileId(NAS);
        clearActiveProfileId(null);
        expect(readActiveProfileId(NAS)).toBeNull();
        expect(readActiveProfileId(OTHER)).toBe(ADULT);
    });

    it('never throws when storage is unavailable', () => {
        const denied = () => {
            throw new DOMException('denied', 'SecurityError');
        };
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
        jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
        expect(readProfilesStart(NAS)).toBe('ask');
        expect(readActiveProfileId(NAS)).toBeNull();
        expect(writeProfilesStart(NAS, 'last')).toBe(false);
        expect(writeActiveProfileId(NAS, ADULT)).toBe(false);
        expect(() => clearActiveProfileId(NAS)).not.toThrow();
    });
});
