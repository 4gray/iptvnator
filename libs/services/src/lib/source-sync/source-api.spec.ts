import {
    sourceAuthorization,
    verifySourceInstance,
} from './source-authorization';
import type { SourceServerRequest } from '@iptvnator/shared/interfaces';
import { requestSourceServer } from './source-api';
import { prepareSourceConnection } from './source-connection';
import { saveBrowserSourceConnection } from './source-browser-settings';

describe('source transport identity revocation', () => {
    const originalFetch = globalThis.fetch;
    const originalElectron = window.electron;
    const connection = { apiUrl: 'https://nas.test/api', instanceId: 'nas' };
    const instance = {
        service: 'iptvnator',
        apiVersion: 1,
        storage: 'server',
        instanceId: 'nas',
        capabilities: ['sources-v1'],
    };
    beforeEach(async () => {
        Reflect.deleteProperty(window, 'electron');
        saveBrowserSourceConnection(connection, 'synthetic-nas-token');
        await prepareSourceConnection();
        verifySourceInstance(instance);
    });
    afterEach(async () => {
        localStorage.clear();
        sessionStorage.clear();
        await prepareSourceConnection();
        window.electron = originalElectron;
        globalThis.fetch = originalFetch;
    });

    for (const failure of ['network', 'gateway', 'invalid-json']) {
        it.each([
            'create',
            'update',
            'delete',
            'clear',
            'list',
            'get',
        ] as const)(
            `revokes saved authorization after a %s ${failure} failure, including direct imports`,
            async (operation) => {
                globalThis.fetch =
                    failure === 'network'
                        ? jest
                              .fn()
                              .mockRejectedValue(
                                  new TypeError(
                                      'network with private request data'
                                  )
                              )
                        : jest.fn().mockResolvedValue({
                              status: failure === 'gateway' ? 502 : 200,
                              headers: new Headers({
                                  'content-type':
                                      failure === 'gateway'
                                          ? 'text/html'
                                          : 'application/json',
                              }),
                              json: async () => {
                                  throw new SyntaxError('invalid body');
                              },
                          });
                const request: SourceServerRequest = {
                    operation,
                    id: 'source',
                };
                expect(
                    sourceAuthorization(`${connection.apiUrl}/stalker`)
                ).toHaveProperty('Authorization');
                await expect(requestSourceServer(request)).rejects.toThrow(
                    'SOURCE_SYNC.OFFLINE'
                );
                expect(
                    sourceAuthorization(`${connection.apiUrl}/stalker`)
                ).toEqual({});
            }
        );
    }
    it.each([401, 409])(
        'revokes authorization for direct source status %s without requiring a service caller',
        async (status) => {
            globalThis.fetch = jest.fn().mockResolvedValue({
                status,
                headers: new Headers(),
                json: async () => ({ code: 'instance_changed' }),
            });
            await requestSourceServer({ operation: 'create', id: 'source' });
            expect(sourceAuthorization(`${connection.apiUrl}/xtream`)).toEqual(
                {}
            );
        }
    );
    it('keeps a logical source conflict from being treated as a server outage', async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 412,
            headers: new Headers(),
            json: async () => ({ code: 'conflict' }),
        });
        expect(
            (await requestSourceServer({ operation: 'update', id: 'source' }))
                .status
        ).toBe(412);
        expect(
            sourceAuthorization(`${connection.apiUrl}/xtream`)
        ).toHaveProperty('Authorization');
    });
    it('revokes authorization for a JSON server-side failure too', async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({
            status: 500,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ code: 'storage_error' }),
        });
        await expect(
            requestSourceServer({ operation: 'delete', id: 'source' })
        ).rejects.toThrow('SOURCE_SYNC.OFFLINE');
        expect(sourceAuthorization(`${connection.apiUrl}/xtream`)).toEqual({});
    });
    it('returns unsupported discovery without parsing legacy HTML and revokes the old proof', async () => {
        const json = jest.fn().mockRejectedValue(new Error('HTML is not JSON'));
        globalThis.fetch = jest
            .fn()
            .mockResolvedValue({ status: 404, headers: new Headers(), json });
        expect(
            (await requestSourceServer({ operation: 'instance' })).status
        ).toBe(404);
        expect(json).not.toHaveBeenCalled();
        expect(sourceAuthorization(`${connection.apiUrl}/xtream`)).toEqual({});
    });
});
