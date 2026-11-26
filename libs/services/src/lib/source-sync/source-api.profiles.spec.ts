import type { SourceServerRequest } from '@iptvnator/shared/interfaces';
import {
    sourceAuthorization,
    verifySourceInstance,
} from './source-authorization';
import { requestSourceServer } from './source-api';
import { prepareSourceConnection } from './source-connection';
import { saveBrowserSourceConnection } from './source-browser-settings';

const connection = { apiUrl: 'https://nas.test/api', instanceId: 'nas' };
const profileId = '11111111-1111-4111-8111-111111111111';

describe('profile browser source transport', () => {
    const originalFetch = globalThis.fetch;
    const originalElectron = window.electron;

    beforeEach(async () => {
        Reflect.deleteProperty(window, 'electron');
        saveBrowserSourceConnection(connection, 'synthetic-nas-token');
        await prepareSourceConnection();
        verifySourceInstance({
            service: 'iptvnator',
            apiVersion: 1,
            storage: 'server',
            instanceId: 'nas',
            capabilities: ['sources-v1'],
        });
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 200,
            headers: new Headers(),
            json: async () => ({}),
        });
    });

    afterEach(async () => {
        localStorage.clear();
        sessionStorage.clear();
        await prepareSourceConnection();
        window.electron = originalElectron;
        globalThis.fetch = originalFetch;
    });

    it.each([
        ['profiles-list', {}, '/v1/profiles', 'GET'],
        ['profiles-set-enabled', { enabled: true }, '/v1/profiles', 'PATCH'],
        [
            'profiles-order',
            { ids: ['default', profileId] },
            '/v1/profiles/order',
            'PUT',
        ],
        ['profile-create', { name: 'Synthetic' }, '/v1/profiles', 'POST'],
        [
            'profile-update',
            { name: 'Updated' },
            `/v1/profiles/${profileId}`,
            'PATCH',
        ],
        [
            'profile-delete',
            { currentPin: '1234' },
            `/v1/profiles/${profileId}`,
            'DELETE',
        ],
        [
            'profile-unlock',
            { pin: '1234' },
            `/v1/profiles/${profileId}/unlock`,
            'POST',
        ],
    ])(
        'sends %s only to its profile endpoint',
        async (operation, profile, path, method) => {
            const request: SourceServerRequest = {
                operation: operation as SourceServerRequest['operation'],
                ...(operation.startsWith('profile-') &&
                operation !== 'profile-create'
                    ? { id: profileId }
                    : {}),
                ...(operation === 'profiles-list' ? {} : { profile }),
                source: {
                    id: 'ignored-source',
                    title: 'Ignored source',
                    kind: 'm3u-text',
                    rawM3u: '#EXTM3U',
                },
                history: undefined,
                favorite: undefined,
                activity: undefined,
            } as SourceServerRequest;
            await requestSourceServer(request);
            const [url, options] = (globalThis.fetch as jest.Mock).mock
                .calls[0];
            expect(url).toBe(`${connection.apiUrl}${path}`);
            expect(options).toMatchObject({ method });
            expect(options.body).toBe(
                operation === 'profiles-list'
                    ? undefined
                    : JSON.stringify(profile)
            );
        }
    );

    it('encodes profile ids, sends a valid list revision, and ignores other revisions', async () => {
        await requestSourceServer({
            operation: 'profile-delete',
            id: 'profile/id',
        });
        expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
            `${connection.apiUrl}/v1/profiles/profile%2Fid`
        );
        await requestSourceServer({
            operation: 'profiles-list',
            revision: '7',
        });
        expect(
            (globalThis.fetch as jest.Mock).mock.calls[1][1].headers
        ).toMatchObject({ 'If-None-Match': '"profiles-7"' });
        await requestSourceServer({
            operation: 'profiles-list',
            revision: 'not-a-number',
        });
        expect(
            (globalThis.fetch as jest.Mock).mock.calls[2][1].headers
        ).not.toHaveProperty('If-None-Match');
        await requestSourceServer({
            operation: 'profile-update',
            id: profileId,
            revision: '7',
            profile: { name: 'Updated' },
        });
        expect(
            (globalThis.fetch as jest.Mock).mock.calls[3][1].headers
        ).not.toHaveProperty('If-Match');
    });

    it.each([
        {
            operation: 'profiles-set-enabled',
            revision: '7',
            profile: { enabled: true },
        },
        {
            operation: 'profiles-order',
            revision: '7',
            profile: { ids: ['default', profileId] },
        },
        {
            operation: 'profile-create',
            revision: '7',
            profile: { name: 'Synthetic' },
        },
        {
            operation: 'profile-update',
            id: profileId,
            revision: '7',
            profile: { name: 'Updated' },
        },
        {
            operation: 'profile-delete',
            id: profileId,
            revision: '7',
            profile: { currentPin: '1234' },
        },
        {
            operation: 'profile-unlock',
            id: profileId,
            revision: '7',
            profile: { pin: '1234' },
        },
    ])('does not send a source revision for $operation', async (request) => {
        await requestSourceServer(request as unknown as SourceServerRequest);
        expect(
            (globalThis.fetch as jest.Mock).mock.calls[0][1].headers
        ).not.toHaveProperty('If-Match');
        expect(
            (globalThis.fetch as jest.Mock).mock.calls[0][1].headers
        ).not.toHaveProperty('If-None-Match');
    });

    it('does not parse a 304 list or a 204 profile delete response', async () => {
        const json = jest.fn().mockRejectedValue(new Error('empty'));
        globalThis.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                status: 304,
                headers: new Headers(),
                json,
            })
            .mockResolvedValueOnce({
                status: 204,
                headers: new Headers(),
                json,
            });
        await expect(
            requestSourceServer({ operation: 'profiles-list' })
        ).resolves.toEqual({ status: 304, etag: undefined });
        await expect(
            requestSourceServer({ operation: 'profile-delete', id: profileId })
        ).resolves.toEqual({ status: 204, etag: undefined });
        expect(json).not.toHaveBeenCalled();
        expect(
            sourceAuthorization(`${connection.apiUrl}/stalker`)
        ).toHaveProperty('Authorization');
    });

    it.each([
        ['wrong_pin', true],
        ['forbidden', false],
    ])(
        'keeps authorization for profile refusal %s only when it is a PIN refusal',
        async (code, authorized) => {
            globalThis.fetch = jest.fn().mockResolvedValue({
                status: 403,
                headers: new Headers(),
                json: async () => ({ code }),
            });
            await requestSourceServer({
                operation: 'profile-unlock',
                id: profileId,
                profile: { pin: '1234' },
            });
            expect(sourceAuthorization(`${connection.apiUrl}/stalker`)).toEqual(
                authorized
                    ? { Authorization: 'Bearer synthetic-nas-token' }
                    : {}
            );
        }
    );

    it('treats an unreadable 403 (a proxy page) as an access refusal, not downtime', async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 403,
            headers: new Headers(),
            json: async () => {
                throw new SyntaxError('Synthetic HTML page');
            },
        });
        await expect(
            requestSourceServer({
                operation: 'profile-unlock',
                id: profileId,
                profile: { pin: '1234' },
            })
        ).resolves.toEqual({ status: 403 });
        expect(sourceAuthorization(`${connection.apiUrl}/stalker`)).toEqual({});
    });

    it('keeps authorization for a PIN refusal returned by Electron IPC', async () => {
        window.electron = {
            sourceSyncRequest: jest.fn().mockResolvedValue({
                status: 403,
                body: { code: 'wrong_pin' },
            }),
        } as unknown as typeof window.electron;
        await requestSourceServer({
            operation: 'profile-unlock',
            id: profileId,
            profile: { pin: '1234' },
        });
        expect(
            sourceAuthorization(`${connection.apiUrl}/stalker`)
        ).toHaveProperty('Authorization');
    });

    it.each([
        ['30', 30],
        ['soon', undefined],
    ])('returns only valid Retry-After values', async (header, retryAfter) => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 200,
            headers: new Headers({ 'Retry-After': header }),
            json: async () => ({}),
        });
        await expect(
            requestSourceServer({ operation: 'profiles-list' })
        ).resolves.toEqual({
            status: 200,
            etag: undefined,
            ...(retryAfter === undefined ? {} : { retryAfter }),
            body: {},
        });
    });
});
