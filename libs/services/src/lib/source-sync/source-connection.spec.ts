import {
    sourceAuthorization,
    verifySourceInstance,
    assertSourceRequestAllowed,
} from './source-authorization';
import {
    connectBrowserSourceServer,
    disconnectBrowserSourceConnection,
    forgetSavedBrowserSourceConnection,
    readSavedBrowserSourceConnection,
    saveBrowserSourceConnection,
} from './source-browser-settings';
import {
    CONNECTION_KEY,
    DISABLED_KEY,
    prepareSourceConnection,
    sourceConnection,
    sourceProfileName,
    tokenKey,
    sourceConnectionReadFailed,
    invalidateSourceVerification,
    sourceVerificationEpoch,
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

    it('keeps the token in the tab while a disconnected browser starts locally', async () => {
        const connection = {
            apiUrl: 'https://nas.test/api',
            instanceId: 'nas',
        };
        saveBrowserSourceConnection(connection, 'synthetic-token');
        await prepareSourceConnection();
        expect(disconnectBrowserSourceConnection()).toBe(true);

        const probe = jest.fn();
        globalThis.fetch = probe;
        await prepareSourceConnection(connection.apiUrl);
        expect(sourceProfileName()).toBe('iptvnator');
        expect(probe).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(tokenKey(connection))).toBe(
            'synthetic-token'
        );
        expect(readSavedBrowserSourceConnection()).toEqual({
            ...connection,
            hasToken: true,
        });

        forgetSavedBrowserSourceConnection();
        await prepareSourceConnection(connection.apiUrl);
        expect(probe).not.toHaveBeenCalled();
        expect(readSavedBrowserSourceConnection()).toBeNull();
        expect(sessionStorage.getItem(tokenKey(connection))).toBeNull();
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

    it('forgets a disconnected address when tab storage is denied', () => {
        const connection = {
            apiUrl: 'https://nas.test/api',
            instanceId: 'nas',
        };
        saveBrowserSourceConnection(connection, '');
        expect(disconnectBrowserSourceConnection()).toBe(true);
        const tabStorage = jest
            .spyOn(window, 'sessionStorage', 'get')
            .mockImplementation(() => {
                throw new DOMException('Storage denied', 'SecurityError');
            });
        try {
            expect(readSavedBrowserSourceConnection()).toEqual({
                ...connection,
                hasToken: false,
            });
            forgetSavedBrowserSourceConnection();
            expect(readSavedBrowserSourceConnection()).toBeNull();
        } finally {
            tabStorage.mockRestore();
        }
    });
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

    it('uses an isolated recovery namespace when native connection reads fail', async () => {
        window.electron = {
            sourceSyncConnection: () => {
                throw new Error('unreadable');
            },
        } as never;
        await prepareSourceConnection();
        expect(sourceConnectionReadFailed()).toBe(true);
        expect(sourceProfileName()).toBe('iptvnator-recovery');
    });

    it('does not accept an identity proof started before a newer outage', async () => {
        await prepareSourceConnection();
        const epoch = sourceVerificationEpoch();
        invalidateSourceVerification();
        expect(() => verifySourceInstance({}, null, epoch)).toThrow(
            'SOURCE_SYNC.OFFLINE'
        );
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
        expect(sourceAuthorization('https://nas.test/backend/xtream')).toEqual(
            {}
        );
        verifySourceInstance({
            service: 'iptvnator',
            apiVersion: 1,
            storage: 'server',
            instanceId: 'nas',
            capabilities: ['sources-v1'],
        });
        sessionStorage.setItem(
            tokenKey({ apiUrl: 'https://nas.test/backend', instanceId: 'nas' }),
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
    it('keeps the original profile when a legacy stateless proxy has no discovery endpoint', async () => {
        globalThis.fetch = jest
            .fn()
            .mockResolvedValue({ status: 404, ok: false });
        await prepareSourceConnection('https://proxy.test');
        expect(sourceConnection()).toBeNull();
        expect(sourceProfileName()).toBe('iptvnator');
        expect(localStorage.getItem('iptvnator:source-server')).toBeNull();
    });
    it('authorizes a bare backend root and leaves a confirmed stateless backend in standalone mode', async () => {
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({ apiUrl: 'https://nas.test', instanceId: 'nas' })
        );
        await prepareSourceConnection();
        sessionStorage.setItem(
            tokenKey({ apiUrl: 'https://nas.test', instanceId: 'nas' }),
            'root-token'
        );
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
        sessionStorage.setItem(tokenKey(connection), 'saved-secret');
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
    it('never reuses another instance token after a different tab replaces the saved connection at the same URL', async () => {
        const original = {
            apiUrl: 'https://nas.test/api',
            instanceId: 'original',
        };
        const info = {
            service: 'iptvnator',
            apiVersion: 1,
            storage: 'server',
            capabilities: ['sources-v1'],
        };
        saveBrowserSourceConnection(original, 'old-instance-secret');
        await prepareSourceConnection();
        verifySourceInstance({ ...info, instanceId: original.instanceId });
        const proxy = `${original.apiUrl}/xtream`;
        expect(sourceAuthorization(proxy)).toEqual({
            Authorization: 'Bearer old-instance-secret',
        });
        const replacement = { ...original, instanceId: 'replacement' };
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify(replacement)
        );
        await prepareSourceConnection();
        verifySourceInstance({ ...info, instanceId: replacement.instanceId });
        expect(sourceAuthorization(proxy)).toEqual({});
        saveBrowserSourceConnection(replacement, 'new-instance-secret');
        await prepareSourceConnection();
        verifySourceInstance({ ...info, instanceId: replacement.instanceId });
        expect(sourceAuthorization(proxy)).toEqual({
            Authorization: 'Bearer new-instance-secret',
        });
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
            expect(sessionStorage.getItem(tokenKey(pending))).toBeNull();
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

describe('browser server settings', () => {
    const connection = {
        apiUrl: 'https://nas.test/api',
        instanceId: 'nas',
    };
    const instance = {
        service: 'iptvnator',
        apiVersion: 1,
        storage: 'server',
        capabilities: ['sources-v1'],
        instanceId: connection.instanceId,
    };
    const token = 'synthetic-token';
    const originalFetch = globalThis.fetch;
    let fetchServer: jest.Mock;

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        fetchServer = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => instance,
        });
        globalThis.fetch = fetchServer;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('reuses the tab token only after the disconnected server proves its identity', async () => {
        saveBrowserSourceConnection(connection, token);
        disconnectBrowserSourceConnection();

        await connectBrowserSourceServer(
            connection.apiUrl,
            '',
            undefined,
            connection
        );

        expect(fetchServer).toHaveBeenNthCalledWith(
            1,
            `${connection.apiUrl}/v1/instance`,
            expect.not.objectContaining({ headers: expect.anything() })
        );
        expect(fetchServer).toHaveBeenNthCalledWith(
            2,
            `${connection.apiUrl}/v1/sources`,
            expect.objectContaining({
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-IPTVnator-Instance-Id': connection.instanceId,
                },
            })
        );
        expect(localStorage.getItem(CONNECTION_KEY)).toBe(
            JSON.stringify(connection)
        );
        expect(readSavedBrowserSourceConnection()).toBeNull();
    });

    it('clears the previous tab token when the user connects to a different server', async () => {
        saveBrowserSourceConnection(connection, token);
        disconnectBrowserSourceConnection();
        const next = { apiUrl: 'https://other.test/api', instanceId: 'other' };
        fetchServer.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ ...instance, instanceId: next.instanceId }),
        });

        await connectBrowserSourceServer(
            next.apiUrl,
            'other-token',
            undefined,
            null
        );

        expect(sessionStorage.getItem(tokenKey(connection))).toBeNull();
        expect(sessionStorage.getItem(tokenKey(next))).toBe('other-token');
    });

    it.each([401, 503])(
        'reports a protected connection check returning HTTP %s',
        async (status) => {
            fetchServer
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => instance,
                })
                .mockResolvedValueOnce({ ok: false, status });

            await expect(
                connectBrowserSourceServer(
                    connection.apiUrl,
                    token,
                    connection.instanceId,
                    null
                )
            ).rejects.toThrow(
                status === 401
                    ? 'SOURCE_SYNC.LOCKED'
                    : 'SOURCE_SYNC.CONNECTION_FAILED'
            );
            expect(localStorage.getItem(CONNECTION_KEY)).toBeNull();
        }
    );

    it.each([
        ['current', 'SOURCE_SYNC.INSTANCE_CHANGED'],
        ['saved', 'SOURCE_SYNC.SAVED_INSTANCE_CHANGED'],
    ])(
        'withholds credentials from a replacement for the %s server',
        async (mode, key) => {
            fetchServer.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ...instance, instanceId: 'replacement' }),
            });

            await expect(
                connectBrowserSourceServer(
                    connection.apiUrl,
                    token,
                    mode === 'current' ? connection.instanceId : undefined,
                    mode === 'saved' ? connection : null
                )
            ).rejects.toThrow(key);
            expect(fetchServer).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['/v1/instance', '/v1/sources'])(
        'does not restore a connection forgotten during %s',
        async (route) => {
            saveBrowserSourceConnection(connection, token);
            disconnectBrowserSourceConnection();
            fetchServer.mockImplementation(async (url: string) => {
                if (url.endsWith(route)) forgetSavedBrowserSourceConnection();
                return { ok: true, json: async () => instance };
            });

            await expect(
                connectBrowserSourceServer(
                    connection.apiUrl,
                    '',
                    undefined,
                    connection
                )
            ).rejects.toThrow('SOURCE_SYNC.SAVED_INSTANCE_CHANGED');
            expect(localStorage.getItem(CONNECTION_KEY)).toBeNull();
            expect(sessionStorage.getItem(tokenKey(connection))).toBeNull();
        }
    );

    it('can clear an unreadable active selection without enabling automatic discovery', () => {
        localStorage.setItem(CONNECTION_KEY, '{invalid');
        expect(disconnectBrowserSourceConnection(false)).toBe(false);
        expect(disconnectBrowserSourceConnection()).toBe(true);
        expect(localStorage.getItem(CONNECTION_KEY)).toBeNull();
        expect(localStorage.getItem(DISABLED_KEY)).toBe('1');
    });

    it('allows an explicit connection to replace an unreadable saved selection', async () => {
        localStorage.setItem(DISABLED_KEY, '{invalid');
        expect(readSavedBrowserSourceConnection()).toBeNull();

        await connectBrowserSourceServer(
            connection.apiUrl,
            token,
            undefined,
            null
        );

        expect(localStorage.getItem(CONNECTION_KEY)).toBe(
            JSON.stringify(connection)
        );
        expect(localStorage.getItem(DISABLED_KEY)).toBeNull();
    });
});
