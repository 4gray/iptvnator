import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    DEFAULT_PERSONAL_SCOPE,
    DEFAULT_PROFILE_ID,
    profileScope,
    type ServerProfile,
    type ServerProfileList,
} from '@iptvnator/shared/interfaces/profiles';
import { ProfilesClient } from './profiles-client';

const profileId = '11111111-2222-4333-8444-555555555555';
const defaultProfile: ServerProfile = {
    id: DEFAULT_PROFILE_ID,
    scope: DEFAULT_PERSONAL_SCOPE,
    name: 'Household',
    colour: '#a1b2c3',
    hasPin: false,
    kids: false,
    sortOrder: 0,
};
const profile: ServerProfile = {
    id: profileId,
    scope: profileScope(profileId),
    name: 'Robin',
    colour: '#123456',
    emoji: '🦊',
    hasPin: true,
    kids: false,
    sortOrder: 1,
};
const list: ServerProfileList = {
    enabled: true,
    revision: 7,
    profiles: [defaultProfile, profile],
};

function fixture(response: SourceServerResponse = { status: 200, body: list }) {
    const request = jest.fn<
        Promise<SourceServerResponse>,
        [SourceServerRequest]
    >();
    request.mockResolvedValue(response);
    return { request, client: new ProfilesClient({ request }) };
}

describe('ProfilesClient', () => {
    it('lists profiles and sends a revision only when supplied', async () => {
        const f = fixture();

        await expect(f.client.list()).resolves.toEqual({
            ok: true,
            value: { changed: true, list },
        });
        expect(f.request).toHaveBeenCalledWith({ operation: 'profiles-list' });
    });

    it('uses a matching revision for the 304 list path', async () => {
        const f = fixture({ status: 304 });

        await expect(f.client.list(7)).resolves.toEqual({
            ok: true,
            value: { changed: false },
        });
        expect(f.request).toHaveBeenCalledWith({
            operation: 'profiles-list',
            revision: '7',
        });
    });

    it('rejects invalid revisions and a revisionless 304 before parsing', async () => {
        const f = fixture({ status: 304 });

        await expect(f.client.list()).resolves.toEqual({
            ok: false,
            error: { code: 'invalid_response' },
        });
        await expect(f.client.list(-1)).resolves.toEqual({
            ok: false,
            error: { code: 'invalid_body' },
        });
        await expect(f.client.list(1.5)).resolves.toEqual({
            ok: false,
            error: { code: 'invalid_body' },
        });
        expect(f.request).toHaveBeenCalledTimes(1);
    });

    it('sets the household profiles switch', async () => {
        const f = fixture();

        await expect(f.client.setEnabled(false)).resolves.toEqual({
            ok: true,
            value: list,
        });
        expect(f.request).toHaveBeenCalledWith({
            operation: 'profiles-set-enabled',
            profile: { enabled: false },
        });
    });

    it('reorders valid ids and accepts the Default profile id', async () => {
        const f = fixture();

        await expect(
            f.client.reorder([DEFAULT_PROFILE_ID, profileId])
        ).resolves.toEqual({ ok: true, value: list });
        expect(f.request).toHaveBeenCalledWith({
            operation: 'profiles-order',
            profile: { ids: [DEFAULT_PROFILE_ID, profileId] },
        });
    });

    it('creates a profile with only contract keys', async () => {
        const f = fixture({ status: 201, body: profile });
        const input = {
            name: 'Robin',
            colour: '#123456',
            emoji: '🦊',
            pin: '1234',
            kids: false,
            unexpected: 'drop me',
        };

        await expect(f.client.create(input)).resolves.toEqual({
            ok: true,
            value: profile,
        });
        expect(f.request).toHaveBeenCalledWith({
            operation: 'profile-create',
            profile: {
                name: 'Robin',
                colour: '#123456',
                emoji: '🦊',
                pin: '1234',
                kids: false,
            },
        });
    });

    it('updates a profile and drops unknown and undefined keys', async () => {
        const f = fixture({ status: 200, body: profile });
        const input = {
            name: 'Robin',
            emoji: null,
            currentPin: '1234',
            colour: undefined,
            unexpected: 'drop me',
        };

        await expect(f.client.update(profileId, input)).resolves.toEqual({
            ok: true,
            value: profile,
        });
        expect(f.request).toHaveBeenCalledWith({
            operation: 'profile-update',
            id: profileId,
            profile: { name: 'Robin', emoji: null, currentPin: '1234' },
        });
    });

    it('removes a profile with and without a current PIN', async () => {
        const f = fixture({ status: 204 });

        await expect(f.client.remove(profileId)).resolves.toEqual({
            ok: true,
            value: undefined,
        });
        f.request.mockResolvedValueOnce({ status: 200, body: {} });
        await expect(f.client.remove(profileId, '1234')).resolves.toEqual({
            ok: true,
            value: undefined,
        });
        expect(f.request.mock.calls).toEqual([
            [{ operation: 'profile-delete', id: profileId }],
            [
                {
                    operation: 'profile-delete',
                    id: profileId,
                    profile: { currentPin: '1234' },
                },
            ],
        ]);
    });

    it('unlocks only after the server confirms it', async () => {
        const f = fixture({ status: 200, body: { unlocked: true } });

        await expect(f.client.unlock(profileId, '1234')).resolves.toEqual({
            ok: true,
            value: undefined,
        });
        expect(f.request).toHaveBeenCalledWith({
            operation: 'profile-unlock',
            id: profileId,
            profile: { pin: '1234' },
        });
        f.request.mockResolvedValueOnce({ status: 200, body: {} });
        await expect(f.client.unlock(profileId, '1234')).resolves.toEqual({
            ok: false,
            error: { code: 'invalid_response' },
        });
    });

    it.each([
        ['update', (client: ProfilesClient) => client.update('../x', {})],
        ['remove', (client: ProfilesClient) => client.remove('not-a-uuid')],
        ['unlock', (client: ProfilesClient) => client.unlock('', '1234')],
        [
            'reorder',
            (client: ProfilesClient) => client.reorder([profileId, 'bad']),
        ],
    ])('rejects an invalid profile id for %s', async (_method, attempt) => {
        const f = fixture();
        await expect(attempt(f.client)).resolves.toEqual({
            ok: false,
            error: { code: 'invalid_profile_id' },
        });
        expect(f.request).not.toHaveBeenCalled();
    });

    it('maps thrown requests to offline without exposing their detail', async () => {
        const f = fixture();
        f.request.mockRejectedValue(new Error('synthetic network detail'));

        await expect(f.client.list()).resolves.toEqual({
            ok: false,
            error: { code: 'offline' },
        });
    });
});
