import {
    prepareSourceConnection,
    sourceAuthorization,
    sourceConnection,
    sourceProfileName,
    tokenKey,
} from './source-connection';

describe('source server selection and authorization', () => {
    const originalElectron = window.electron;
    const originalFetch = globalThis.fetch;
    beforeEach(() => {
        Reflect.deleteProperty(window, 'electron');
        localStorage.clear();
        sessionStorage.clear();
    });
    afterEach(() => {
        window.electron = originalElectron;
        globalThis.fetch = originalFetch;
    });

    it('preserves an explicitly configured bare backend URL and scopes its token to the API path', async () => {
        globalThis.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                service: 'iptvnator',
                apiVersion: 1,
                storage: 'server',
                instanceId: 'nas',
                capabilities: ['sources-v1'],
            }),
        })) as unknown as typeof fetch;
        await prepareSourceConnection('https://nas.test/backend');
        expect(sourceConnection()?.apiUrl).toBe('https://nas.test/backend');
        expect(sourceProfileName()).toBe('iptvnator-server:nas');
        sessionStorage.setItem(
            tokenKey('https://nas.test/backend'),
            'synthetic-nas-token'
        );
        expect(
            sourceAuthorization('https://nas.test/backend/v1/sources')
        ).toEqual({ Authorization: 'Bearer synthetic-nas-token' });
        expect(
            sourceAuthorization('https://provider.test/backend/xtream')
        ).toEqual({});
        expect(
            sourceAuthorization('https://nas.test/backend-other/xtream')
        ).toEqual({});
        expect(
            sourceAuthorization('http://nas.test/backend/v1/sources')
        ).toEqual({});
    });
    it('keeps a known server selected when it is offline instead of switching to the local library', async () => {
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({
                apiUrl: 'https://nas.test/api',
                instanceId: 'saved',
            })
        );
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline'));
        await prepareSourceConnection('/api');
        expect(sourceConnection()).toEqual({
            apiUrl: 'https://nas.test/api',
            instanceId: 'saved',
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
    it('authorizes a bare backend root and leaves a confirmed stateless backend in standalone mode', async () => {
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({ apiUrl: 'https://nas.test', instanceId: 'nas' })
        );
        await prepareSourceConnection();
        sessionStorage.setItem(tokenKey('https://nas.test'), 'root-token');
        expect(sourceAuthorization('https://nas.test/v1/sources')).toEqual({
            Authorization: 'Bearer root-token',
        });
        localStorage.clear();
        globalThis.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                service: 'iptvnator',
                apiVersion: 1,
                storage: 'none',
            }),
        })) as unknown as typeof fetch;
        await prepareSourceConnection('https://nas.test');
        expect(sourceConnection()).toBeNull();
        expect(sourceProfileName()).toBe('iptvnator');
    });
    it('persists a pending server profile when first discovery fails', async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline'));
        await prepareSourceConnection('https://nas.test/api');
        expect(sourceConnection()?.instanceId).toBe(
            'pending:https://nas.test/api'
        );
        expect(
            JSON.parse(localStorage.getItem('iptvnator:source-server')!)
        ).toEqual(sourceConnection());
    });
});
