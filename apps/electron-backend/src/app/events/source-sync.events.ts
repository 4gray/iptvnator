import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import {
    SOURCE_SYNC_CAPABILITY,
    type ServerInstanceInfo,
    type SourceServerRequest,
    type SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    normalizeSourceServerUrl,
    validateSource,
} from '@iptvnator/shared/interfaces/source-definition';
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
import { SourceServerTransport } from './source-server-transport';

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
        case 'activity-context':
            return { path: `/v1/activity/sources/${id}`, method: 'GET' };
        case 'activity-list':
            return {
                path: `/v1/activity/sources/${id}/items${request.cursor ? '?cursor=' + encodeURIComponent(request.cursor) : ''}`,
                method: 'GET',
            };
        case 'activity-read':
            return { path: '/v1/activity/read', method: 'POST' };
        case 'activity-apply':
            return { path: '/v1/activity/operations', method: 'POST' };
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
                    ...((request.activity ?? request.source)
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
                data: request.activity ?? request.source,
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

export function registerSourceSyncEvents(prepareRestart: () => void): void {
    const transport = new SourceServerTransport(sourceServerRequest);
    powerMonitor.on('resume', () => {
        for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(SOURCE_SYNC_RESUME);
    });
    ipcMain.on(SOURCE_SYNC_CONNECTION, (event) => {
        try {
            const config = readSourceServerConfig();
            event.returnValue = config
                ? { apiUrl: config.apiUrl, instanceId: config.instanceId }
                : null;
        } catch {
            event.returnValue = { error: 'SOURCE_SYNC.INCOMPATIBLE' };
        }
    });
    ipcMain.handle(
        SOURCE_SYNC_REQUEST,
        async (_event, request: SourceServerRequest) => {
            const config = readSourceServerConfig();
            if (!config) throw new Error('SOURCE_SYNC.OFFLINE');
            return transport.execute(config, request, () =>
                sourceServerToken(config)
            );
        }
    );
    ipcMain.handle(
        SOURCE_SYNC_CONFIGURE,
        async (_event, url: string, token: string, restart: boolean) => {
            let configured: ReturnType<typeof readSourceServerConfig> = null;
            try {
                configured = readSourceServerConfig();
            } catch {
                if (!restart) throw new Error('SOURCE_SYNC.INCOMPATIBLE');
            }
            const apiUrl =
                configured?.apiUrl === url.replace(/\/$/, '')
                    ? configured.apiUrl
                    : normalizeSourceServerUrl(url);
            if (typeof token !== 'string' || token.length > 8192)
                throw new Error('Invalid access token');
            const probe = await sourceServerRequest(apiUrl, token, {
                operation: 'instance',
            });
            if ([401, 403].includes(probe.status))
                throw new Error('SOURCE_SYNC.LOCKED');
            if (probe.status >= 500)
                throw new Error('SOURCE_SYNC.CONNECTION_FAILED');
            const instance = probe.body as ServerInstanceInfo;
            if (
                probe.status !== 200 ||
                instance?.service !== 'iptvnator' ||
                instance.apiVersion !== 1 ||
                instance.storage !== 'server' ||
                !instance.instanceId ||
                !Array.isArray(instance.capabilities) ||
                !instance.capabilities.includes(SOURCE_SYNC_CAPABILITY)
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
            const check = await sourceServerRequest(
                apiUrl,
                token,
                { operation: 'list' },
                instance.instanceId
            );
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
            const needsRestart =
                !configured ||
                configured.apiUrl !== apiUrl ||
                configured.instanceId !== instance.instanceId;
            if (restart && needsRestart) {
                // app.exit() skips will-quit, where ordinary quits tear down
                // managed players and the database worker.
                prepareRestart();
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
        prepareRestart();
        app.relaunch();
        app.exit();
    });
}
