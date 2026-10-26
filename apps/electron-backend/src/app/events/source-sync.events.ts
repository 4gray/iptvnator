import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import {
    normalizeSourceServerUrl,
    SOURCE_SYNC_CAPABILITY,
    validateSource,
    type ServerInstanceInfo,
    type SourceServerRequest,
    type SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    SOURCE_SYNC_CONNECTION,
    SOURCE_SYNC_CONFIGURE,
    SOURCE_SYNC_DISCONNECT,
    SOURCE_SYNC_REQUEST,
    SOURCE_SYNC_RESUME,
} from '@iptvnator/shared/interfaces/ipc-commands';
import {
    readSourceServerConfig,
    saveSourceServerConfig,
    clearSourceServerConfig,
    sourceServerToken,
} from '../services/source-server-config';
import { requestWithValidatedRedirects } from '../util/validated-axios';

function route(request: SourceServerRequest): { path: string; method: string } {
    const id = encodeURIComponent(request.id ?? '');
    switch (request.operation) {
        case 'instance':
            return { path: '/v1/instance', method: 'GET' };
        case 'list':
            return { path: '/v1/sources', method: 'GET' };
        case 'get':
            return { path: `/v1/sources/${id}`, method: 'GET' };
        case 'create':
            return { path: `/v1/sources/${id}`, method: 'PUT' };
        case 'update':
            return { path: `/v1/sources/${id}`, method: 'PATCH' };
        case 'delete':
            return { path: `/v1/sources/${id}`, method: 'DELETE' };
        case 'clear':
            return { path: '/v1/sources', method: 'DELETE' };
        default:
            throw new Error('Invalid source operation');
    }
}

export async function sourceServerRequest(
    apiUrl: string,
    token: string,
    request: SourceServerRequest,
    instanceId?: string
): Promise<SourceServerResponse> {
    const target = route(request);
    if (request.source) validateSource(request.source);
    try {
        const response = await requestWithValidatedRedirects(
            `${apiUrl}${target.path}`,
            {
                method: target.method,
                timeout: ['get', 'create', 'update'].includes(request.operation)
                    ? 120000
                    : 15000,
                maxContentLength: 64 * 1024 * 1024,
                maxBodyLength: 64 * 1024 * 1024,
                validateStatus: () => true,
                headers: {
                    ...(instanceId
                        ? { 'X-IPTVnator-Instance-Id': instanceId }
                        : {}),
                    ...(token && request.operation !== 'instance'
                        ? { Authorization: `Bearer ${token}` }
                        : {}),
                    ...(request.source
                        ? { 'Content-Type': 'application/json' }
                        : {}),
                    ...(request.operation === 'create'
                        ? { 'If-None-Match': '*' }
                        : {}),
                    ...(request.revision
                        ? {
                              [request.operation === 'list'
                                  ? 'If-None-Match'
                                  : 'If-Match']: request.revision,
                          }
                        : {}),
                },
                data: request.source,
            },
            {
                allowPrivateNetworks: true,
                pinAllowedPrivateNetworkHosts: true,
                allowPrivateNetworkRedirects: false,
            },
            0
        );
        return {
            status: response.status,
            etag: response.headers['etag'],
            body: response.data,
        };
    } catch {
        // Axios errors carry request headers and provider credentials in data.
        throw new Error('SOURCE_SYNC.OFFLINE');
    }
}

export function registerSourceSyncEvents(): void {
    powerMonitor.on('resume', () => {
        for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(SOURCE_SYNC_RESUME);
    });
    ipcMain.on(SOURCE_SYNC_CONNECTION, (event) => {
        const config = readSourceServerConfig();
        event.returnValue = config
            ? { apiUrl: config.apiUrl, instanceId: config.instanceId }
            : null;
    });
    ipcMain.handle(
        SOURCE_SYNC_REQUEST,
        async (_event, request: SourceServerRequest) => {
            const config = readSourceServerConfig();
            if (!config) throw new Error('SOURCE_SYNC.OFFLINE');
            return sourceServerRequest(
                config.apiUrl,
                sourceServerToken(config),
                request,
                config.instanceId
            );
        }
    );
    ipcMain.handle(
        SOURCE_SYNC_CONFIGURE,
        async (_event, url: string, token: string, restart: boolean) => {
            const configured = readSourceServerConfig();
            const apiUrl =
                configured?.apiUrl === url.replace(/\/$/, '')
                    ? configured.apiUrl
                    : normalizeSourceServerUrl(url);
            if (typeof token !== 'string' || token.length > 8192)
                throw new Error('Invalid access token');
            const probe = await sourceServerRequest(apiUrl, token, {
                operation: 'instance',
            });
            const instance = probe.body as ServerInstanceInfo;
            if (
                probe.status !== 200 ||
                instance?.service !== 'iptvnator' ||
                instance.apiVersion !== 1 ||
                instance.storage !== 'server' ||
                !instance.instanceId ||
                !instance.capabilities?.includes(SOURCE_SYNC_CAPABILITY)
            ) {
                throw new Error('SOURCE_SYNC.INCOMPATIBLE');
            }
            if (
                !restart &&
                configured &&
                configured.instanceId !== instance.instanceId
            ) {
                throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
            }
            const check = await sourceServerRequest(apiUrl, token, {
                operation: 'list',
            });
            if (check.status !== 200)
                throw new Error(
                    check.status === 401
                        ? 'SOURCE_SYNC.LOCKED'
                        : 'SOURCE_SYNC.REQUEST_FAILED'
                );
            const persisted = saveSourceServerConfig(
                { apiUrl, instanceId: instance.instanceId },
                token
            );
            if (restart) {
                app.relaunch();
                app.exit();
            }
            return {
                apiUrl,
                instanceId: instance.instanceId,
                tokenPersisted: persisted,
            };
        }
    );
    ipcMain.handle(SOURCE_SYNC_DISCONNECT, () => {
        clearSourceServerConfig();
        app.relaunch();
        app.exit();
    });
}
