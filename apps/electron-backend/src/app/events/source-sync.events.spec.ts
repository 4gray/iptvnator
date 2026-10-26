import { app, ipcMain } from 'electron';
import {
    SOURCE_SYNC_CONFIGURE,
    SOURCE_SYNC_CONNECTION,
    SOURCE_SYNC_DISCONNECT,
    SOURCE_SYNC_REQUEST,
} from '@iptvnator/shared/interfaces/ipc-commands';
import {
    readSourceServerConfig,
    saveSourceServerConfig,
    clearSourceServerConfig,
    sourceServerToken,
} from '../services/source-server-config';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import {
    registerSourceSyncEvents,
    sourceServerRequest,
} from './source-sync.events';

jest.mock('electron', () => ({
    app: { relaunch: jest.fn(), exit: jest.fn() },
    ipcMain: { on: jest.fn(), handle: jest.fn() },
    powerMonitor: { on: jest.fn() },
    BrowserWindow: { getAllWindows: jest.fn(() => []) },
}));
jest.mock('../services/source-server-config', () => ({
    readSourceServerConfig: jest.fn(),
    saveSourceServerConfig: jest.fn(),
    clearSourceServerConfig: jest.fn(),
    sourceServerToken: jest.fn(() => 'synthetic-nas-token'),
}));
jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: jest.fn(),
}));

const connection = {
    apiUrl: 'https://nas.test/iptvnator/api',
    instanceId: 'nas',
    encryptedToken: 'protected',
};
const instance = {
    service: 'iptvnator',
    apiVersion: 1,
    storage: 'server',
    instanceId: 'nas',
    capabilities: ['sources-v1'],
};
function handler(channel: string) {
    const entry = (ipcMain.handle as jest.Mock).mock.calls.find(
        ([name]) => name === channel
    );
    if (!entry) throw new Error(`Missing IPC handler: ${channel}`);
    return entry[1] as (...args: unknown[]) => Promise<unknown>;
}

describe('native source transport and connection IPC', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (readSourceServerConfig as jest.Mock).mockReturnValue(connection);
        (requestWithValidatedRedirects as jest.Mock).mockResolvedValue({
            status: 200,
            headers: { etag: '"revision"' },
            data: instance,
        });
        registerSourceSyncEvents();
    });

    it('uses the configured API path, scopes credentials and pins redirects for LAN connections', async () => {
        const result = await handler(SOURCE_SYNC_REQUEST)(
            {},
            { operation: 'delete', id: 'source/id', revision: '"old"' }
        );
        expect(result).toEqual({
            status: 200,
            etag: '"revision"',
            body: instance,
        });
        expect(requestWithValidatedRedirects).toHaveBeenCalledWith(
            'https://nas.test/iptvnator/api/v1/sources/source%2Fid',
            expect.objectContaining({
                method: 'DELETE',
                headers: {
                    Authorization: 'Bearer synthetic-nas-token',
                    'If-Match': '"old"',
                    'X-IPTVnator-Instance-Id': 'nas',
                },
            }),
            {
                allowPrivateNetworks: true,
                pinAllowedPrivateNetworkHosts: true,
                allowPrivateNetworkRedirects: false,
            },
            0
        );
    });

    it('blocks an open import after detecting a replacement instance, then recovers through an anonymous probe', async () => {
        const send = handler(SOURCE_SYNC_REQUEST);
        const source = {
            id: 'imported',
            title: 'Private source',
            kind: 'xtream',
            serverUrl: 'https://provider.test',
            username: 'private-user',
            password: 'private-password',
        };
        (requestWithValidatedRedirects as jest.Mock).mockResolvedValue({
            status: 200,
            headers: {},
            data: { ...instance, instanceId: 'replacement' },
        });
        await send({}, { operation: 'instance' });
        await expect(
            send({}, { operation: 'create', id: source.id, source })
        ).rejects.toThrow('SOURCE_SYNC.INSTANCE_CHANGED');
        expect(sourceServerToken).not.toHaveBeenCalled();
        for (const [url, options] of (
            requestWithValidatedRedirects as jest.Mock
        ).mock.calls) {
            expect(url).toBe(`${connection.apiUrl}/v1/instance`);
            expect(options.headers).not.toHaveProperty('Authorization');
            expect(options.data).toBeUndefined();
        }
        (requestWithValidatedRedirects as jest.Mock)
            .mockResolvedValueOnce({ status: 200, headers: {}, data: instance })
            .mockResolvedValueOnce({ status: 200, headers: {}, data: source });
        await expect(
            send({}, { operation: 'create', id: source.id, source })
        ).resolves.toMatchObject({ body: source });
        expect(sourceServerToken).toHaveBeenCalledTimes(1);
        const calls = (requestWithValidatedRedirects as jest.Mock).mock.calls;
        expect(calls.at(-2)[0]).toBe(`${connection.apiUrl}/v1/instance`);
        expect(calls.at(-2)[1].headers).not.toHaveProperty('Authorization');
        expect(calls.at(-1)[1]).toMatchObject({
            data: source,
            headers: { Authorization: 'Bearer synthetic-nas-token' },
        });
    });

    it('does not let a late successful probe restore authorization after a newer identity failure', async () => {
        const send = handler(SOURCE_SYNC_REQUEST);
        let finish!: (value: unknown) => void;
        (requestWithValidatedRedirects as jest.Mock)
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finish = resolve;
                    })
            )
            .mockResolvedValue({
                status: 200,
                headers: {},
                data: { ...instance, instanceId: 'replacement' },
            });
        const oldProbe = send({}, { operation: 'instance' });
        await send({}, { operation: 'instance' });
        finish({ status: 200, headers: {}, data: instance });
        await expect(oldProbe).rejects.toThrow('SOURCE_SYNC.OFFLINE');
        await expect(send({}, { operation: 'list' })).rejects.toThrow(
            'SOURCE_SYNC.INSTANCE_CHANGED'
        );
        expect(sourceServerToken).not.toHaveBeenCalled();
        expect(
            (requestWithValidatedRedirects as jest.Mock).mock.calls.every(
                ([url]) => url.endsWith('/v1/instance')
            )
        ).toBe(true);
    });

    it.each(['network', 'unauthorized', 'gateway', 'instance-changed'])(
        'revokes native authorization after a %s source request failure',
        async (failure) => {
            const send = handler(SOURCE_SYNC_REQUEST);
            await send({}, { operation: 'instance' });
            const network = requestWithValidatedRedirects as jest.Mock;
            if (failure === 'network')
                network.mockRejectedValueOnce(new Error('synthetic outage'));
            else
                network.mockResolvedValueOnce({
                    status:
                        failure === 'unauthorized'
                            ? 401
                            : failure === 'gateway'
                              ? 503
                              : 409,
                    headers: {},
                    data: { code: 'instance_changed' },
                });
            await send({}, { operation: 'list' }).catch(() => undefined);
            jest.clearAllMocks();
            network.mockResolvedValue({
                status: 200,
                headers: {},
                data: { ...instance, instanceId: 'replacement' },
            });
            await expect(send({}, { operation: 'list' })).rejects.toThrow(
                'SOURCE_SYNC.INSTANCE_CHANGED'
            );
            expect(sourceServerToken).not.toHaveBeenCalled();
            expect(network).toHaveBeenCalledTimes(1);
            expect(network.mock.calls[0][0]).toBe(
                `${connection.apiUrl}/v1/instance`
            );
            expect(network.mock.calls[0][1].headers).not.toHaveProperty(
                'Authorization'
            );
        }
    );

    it('returns a recovery error over synchronous IPC and accepts an explicit repair connection', async () => {
        (readSourceServerConfig as jest.Mock).mockImplementation(() => {
            throw new Error('bad JSON with credentials');
        });
        const sync = (ipcMain.on as jest.Mock).mock.calls.find(
            ([name]) => name === SOURCE_SYNC_CONNECTION
        )![1];
        const event = { returnValue: undefined };
        sync(event);
        expect(event.returnValue).toEqual({
            error: 'SOURCE_SYNC.INCOMPATIBLE',
        });
        await expect(
            handler(SOURCE_SYNC_CONFIGURE)({}, connection.apiUrl, '', false)
        ).rejects.toThrow('SOURCE_SYNC.INCOMPATIBLE');
        await handler(SOURCE_SYNC_CONFIGURE)({}, connection.apiUrl, '', true);
        expect(saveSourceServerConfig).toHaveBeenCalled();
        expect(app.relaunch).toHaveBeenCalled();
    });

    it('rejects arbitrary operations and non-source runtime fields before making a request', async () => {
        await expect(
            sourceServerRequest(connection.apiUrl, 'token', {
                operation: 'arbitrary',
            } as never)
        ).rejects.toThrow('Invalid source operation');
        await expect(
            sourceServerRequest(connection.apiUrl, 'token', {
                operation: 'create',
                source: {
                    id: 'x',
                    title: 'x',
                    kind: 'm3u-text',
                    rawM3u: '#EXTM3U',
                    favorites: [],
                },
            } as never)
        ).rejects.toThrow('Invalid source field');
        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
    });

    it('strips transport errors that may contain headers and provider credentials', async () => {
        (requestWithValidatedRedirects as jest.Mock).mockRejectedValueOnce(
            new Error('Authorization: Bearer synthetic-nas-token')
        );
        await expect(
            sourceServerRequest(connection.apiUrl, 'token', {
                operation: 'list',
            })
        ).rejects.toThrow(/^SOURCE_SYNC.OFFLINE$/);
    });

    it('checks the public instance identity without disclosing a saved token', async () => {
        await sourceServerRequest(connection.apiUrl, 'saved-token', {
            operation: 'instance',
        });
        expect(
            (requestWithValidatedRedirects as jest.Mock).mock.calls[0][1]
                .headers
        ).not.toHaveProperty('Authorization');
    });

    it('validates the server and access token before persisting and restarting', async () => {
        const result = await handler(SOURCE_SYNC_CONFIGURE)(
            {},
            'https://nas.test/iptvnator',
            'new-token',
            true
        );
        expect(result).toMatchObject({
            apiUrl: connection.apiUrl,
            instanceId: 'nas',
        });
        expect(saveSourceServerConfig).toHaveBeenCalledWith(
            { apiUrl: connection.apiUrl, instanceId: 'nas' },
            'new-token'
        );
        expect(app.relaunch).toHaveBeenCalledTimes(1);
        expect(app.exit).toHaveBeenCalledTimes(1);
    });

    it('keeps the current profile when sign-in reaches a replacement database', async () => {
        (requestWithValidatedRedirects as jest.Mock).mockResolvedValueOnce({
            status: 200,
            headers: {},
            data: { ...instance, instanceId: 'replacement' },
        });
        await expect(
            handler(SOURCE_SYNC_CONFIGURE)(
                {},
                connection.apiUrl,
                'token',
                false
            )
        ).rejects.toThrow('SOURCE_SYNC.INSTANCE_CHANGED');
        expect(saveSourceServerConfig).not.toHaveBeenCalled();
        expect(app.relaunch).not.toHaveBeenCalled();
    });

    it('keeps rejected credentials out of persisted configuration', async () => {
        (requestWithValidatedRedirects as jest.Mock)
            .mockResolvedValueOnce({ status: 200, headers: {}, data: instance })
            .mockResolvedValueOnce({ status: 401, headers: {}, data: {} });
        await expect(
            handler(SOURCE_SYNC_CONFIGURE)(
                {},
                connection.apiUrl,
                'wrong-token',
                true
            )
        ).rejects.toThrow('SOURCE_SYNC.LOCKED');
        expect(saveSourceServerConfig).not.toHaveBeenCalled();
    });

    it('exposes only public connection selection and disconnects without source deletion', async () => {
        const event = { returnValue: undefined as unknown };
        const read = (ipcMain.on as jest.Mock).mock.calls.find(
            ([name]) => name === SOURCE_SYNC_CONNECTION
        )![1];
        read(event);
        expect(event.returnValue).toEqual({
            apiUrl: connection.apiUrl,
            instanceId: 'nas',
        });
        await handler(SOURCE_SYNC_DISCONNECT)();
        expect(clearSourceServerConfig).toHaveBeenCalledTimes(1);
        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
    });
});
