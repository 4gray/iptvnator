import {
    prepareSourceConnection,
    sourceAuthorization,
    sourceConnection,
    sourceProfileName,
    tokenKey,
    sourceConnectionReadFailed,
    verifySourceInstance,
    assertSourceRequestAllowed,
    saveBrowserSourceConnection,
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

    it.each([
        '{broken',
        'null',
        '{"apiUrl":"file:///tmp/api","instanceId":"nas"}',
        '{"apiUrl":"https://nas.test"}',
    ])(
        'keeps bootstrap available when saved configuration is invalid: %s',
        async (raw) => {
            localStorage.setItem('iptvnator:source-server', raw);
            await expect(prepareSourceConnection()).resolves.toBeUndefined();
            expect(sourceConnection()).toBeNull();
            expect(sourceConnectionReadFailed()).toBe(true);
            expect(localStorage.getItem('iptvnator:source-server')).toBe(raw);
        }
    );
    it('keeps standalone bootstrap available when browser storage is denied', async () => {
        const denied = jest
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('SecurityError');
            });
        try {
            await expect(prepareSourceConnection()).resolves.toBeUndefined();
            expect(sourceConnection()).toBeNull();
            expect(sourceConnectionReadFailed()).toBe(true);
        } finally {
            denied.mockRestore();
        }
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
        expect(sourceAuthorization('https://nas.test/v1/sources')).toEqual({});
        verifySourceInstance({
            service: 'iptvnator',
            apiVersion: 1,
            storage: 'server',
            instanceId: 'nas',
            capabilities: ['sources-v1'],
        });
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
    it('blocks source and provider secrets before verification and after an instance replacement', async () => {
        const connection = {
            apiUrl: 'https://nas.test/api',
            instanceId: 'nas',
        };
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify(connection)
        );
        sessionStorage.setItem(tokenKey(connection.apiUrl), 'saved-secret');
        await prepareSourceConnection();
        const proxy = 'https://nas.test/api/xtream';
        expect(sourceAuthorization(proxy)).toEqual({});
        expect(() => assertSourceRequestAllowed(proxy)).toThrow(
            'SOURCE_SYNC.INSTANCE_CHANGED'
        );
        expect(() =>
            assertSourceRequestAllowed('https://provider.test/stream')
        ).not.toThrow();
        const instance = {
            service: 'iptvnator',
            apiVersion: 1,
            storage: 'server',
            instanceId: 'nas',
            capabilities: ['sources-v1'],
        };
        verifySourceInstance(instance);
        expect(sourceAuthorization(proxy)).toEqual({
            Authorization: 'Bearer saved-secret',
        });
        expect(() => assertSourceRequestAllowed(proxy)).not.toThrow();
        expect(() =>
            verifySourceInstance({ ...instance, instanceId: 'other' })
        ).toThrow('SOURCE_SYNC.INSTANCE_CHANGED');
        expect(sourceAuthorization(proxy)).toEqual({});
        expect(() => assertSourceRequestAllowed(proxy)).toThrow(
            'SOURCE_SYNC.INSTANCE_CHANGED'
        );
        verifySourceInstance(instance);
        expect(() => assertSourceRequestAllowed(proxy)).not.toThrow();
        await prepareSourceConnection();
        expect(sourceAuthorization(proxy)).toEqual({});
    });
    it.each(['connect', 'disconnect'])(
        'does not undo a newer %s when a pending selection resolves',
        (action) => {
            const pending = {
                apiUrl: 'https://old.test/api',
                instanceId: 'pending:https://old.test/api',
            };
            const newer = { apiUrl: 'https://new.test/api', instanceId: 'new' };
            if (action === 'connect')
                saveBrowserSourceConnection(newer, 'new-token');
            else localStorage.setItem('iptvnator:source-server-disabled', '1');
            const before = localStorage.getItem('iptvnator:source-server');
            saveBrowserSourceConnection(
                { ...pending, instanceId: 'resolved-old' },
                'old-token',
                pending
            );
            expect(localStorage.getItem('iptvnator:source-server')).toBe(
                before
            );
            expect(
                localStorage.getItem('iptvnator:source-server-disabled')
            ).toBe(action === 'disconnect' ? '1' : null);
            expect(sessionStorage.getItem(tokenKey(pending.apiUrl))).toBeNull();
        }
    );
    it('promotes a pending selection only while it remains selected', () => {
        const pending = {
            apiUrl: 'https://old.test/api',
            instanceId: 'pending:https://old.test/api',
        };
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify(pending)
        );
        saveBrowserSourceConnection(
            { ...pending, instanceId: 'resolved' },
            'old-token',
            pending
        );
        expect(
            JSON.parse(localStorage.getItem('iptvnator:source-server')!)
        ).toEqual({ ...pending, instanceId: 'resolved' });
    });
    it.each(['connect', 'disconnect'])(
        'retains a newer %s while the initial runtime probe is in flight',
        async (action) => {
            let release!: () => void;
            globalThis.fetch = jest.fn(
                () =>
                    new Promise((resolve) => {
                        release = () =>
                            resolve({
                                ok: true,
                                json: async () => ({
                                    service: 'iptvnator',
                                    apiVersion: 1,
                                    storage: 'server',
                                    instanceId: 'old',
                                    capabilities: ['sources-v1'],
                                }),
                            });
                    })
            ) as unknown as typeof fetch;
            const probing = prepareSourceConnection('https://old.test/api');
            const newer = { apiUrl: 'https://new.test/api', instanceId: 'new' };
            if (action === 'connect')
                saveBrowserSourceConnection(newer, 'new-token');
            else localStorage.setItem('iptvnator:source-server-disabled', '1');
            release();
            await probing;
            expect(sourceConnection()).toEqual(
                action === 'connect' ? newer : null
            );
            expect(
                localStorage.getItem('iptvnator:source-server-disabled')
            ).toBe(action === 'disconnect' ? '1' : null);
            expect(sourceAuthorization('https://old.test/api/xtream')).toEqual(
                {}
            );
        }
    );
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
