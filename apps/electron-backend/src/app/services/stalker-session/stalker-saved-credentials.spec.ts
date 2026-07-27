import type { StalkerSessionConnectionDescriptor } from '@iptvnator/shared/interfaces';
import { createStalkerSavedCredentialsLoader } from './stalker-saved-credentials';

const DESCRIPTOR: StalkerSessionConnectionDescriptor = {
    connectionMode: 'persisted-open',
    identityOverrides: {
        deviceId1: 'DEVICE-1',
        serialNumber: 'SERIAL-1',
    },
    learnedEndpointHint:
        'https://portal.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:12:34:56',
    playlistRef: 'playlist-1',
    profilePreset: {
        id: 'mag250-public-5_1-minimal-v1',
        version: 1,
    },
    sourceUrl: 'https://portal.example/c/',
};

const SAVED_PLAYLIST = {
    _id: 'playlist-1',
    macAddress: '00-1a-79-12-34-56',
    password: 'saved password',
    stalkerIdentityOverrides: {
        deviceId1: 'DEVICE-1',
        serialNumber: 'SERIAL-1',
    },
    stalkerProfilePreset: {
        id: 'mag250-public-5_1-minimal-v1',
        version: 1,
    },
    stalkerSourceUrl: 'https://portal.example/c/#ignored',
    type: 'stalker',
    username: ' saved-user ',
};

describe('createStalkerSavedCredentialsLoader', () => {
    it('returns an exact matching Stalker credential pair without exposing the row', async () => {
        const readPlaylist = jest.fn().mockResolvedValue(SAVED_PLAYLIST);
        const load = createStalkerSavedCredentialsLoader(readPlaylist);

        await expect(load(DESCRIPTOR)).resolves.toEqual({
            password: 'saved password',
            username: 'saved-user',
        });
        expect(readPlaylist).toHaveBeenCalledWith('playlist-1');
    });

    it.each([
        ['source', { stalkerSourceUrl: 'https://other.example/c/' }],
        ['MAC', { macAddress: '00:1A:79:AA:BB:CC' }],
        [
            'profile',
            {
                stalkerProfilePreset: {
                    id: 'mag250-public-5_1-minimal-v1',
                    version: 2,
                },
            },
        ],
        [
            'identity',
            {
                stalkerIdentityOverrides: {
                    deviceId1: 'OTHER-DEVICE',
                    serialNumber: 'SERIAL-1',
                },
            },
        ],
        ['provider type', { type: 'xtream' }],
    ])('rejects a descriptor/%s mismatch', async (_label, patch) => {
        const load = createStalkerSavedCredentialsLoader(async () => ({
            ...SAVED_PLAYLIST,
            ...patch,
        }));

        await expect(load(DESCRIPTOR)).resolves.toBeUndefined();
    });

    it.each([
        ['missing row', null],
        ['missing username', { ...SAVED_PLAYLIST, username: undefined }],
        ['blank username', { ...SAVED_PLAYLIST, username: '   ' }],
        ['missing password', { ...SAVED_PLAYLIST, password: undefined }],
        ['empty password', { ...SAVED_PLAYLIST, password: '' }],
    ])('ignores %s', async (_label, row) => {
        const load = createStalkerSavedCredentialsLoader(async () => row);

        await expect(load(DESCRIPTOR)).resolves.toBeUndefined();
    });

    it('matches legacy identity columns when the structured override is absent', async () => {
        const {
            stalkerIdentityOverrides: _structured,
            ...legacyPlaylist
        } = SAVED_PLAYLIST;
        const load = createStalkerSavedCredentialsLoader(async () => ({
            ...legacyPlaylist,
            stalkerDeviceId1: 'DEVICE-1',
            stalkerSerialNumber: 'SERIAL-1',
        }));

        await expect(load(DESCRIPTOR)).resolves.toEqual({
            password: 'saved password',
            username: 'saved-user',
        });
    });
});
