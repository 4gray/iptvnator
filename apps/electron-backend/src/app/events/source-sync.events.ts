import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import { Agent } from 'node:https';
import { getCACertificates } from 'node:tls';
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
    SOURCE_SYNC_FORGET,
    SOURCE_SYNC_SAVED_CONNECTION,
    SOURCE_SYNC_REQUEST,
    SOURCE_SYNC_RESUME,
} from '@iptvnator/shared/interfaces/ipc-commands';
import {
    readSourceServerConfig,
    readSavedSourceServerConfig,
    saveSourceServerConfig,
    clearSourceServerConfig,
    disconnectSourceServerConfig,
    sourceServerToken,
} from '../services/source-server-config';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import { SourceServerTransport } from './source-server-transport';
import {
    getHostedServerAccessCode,
    getHostedServerInstanceId,
    hostedWorkerRequest,
    HOSTED_SERVER_LOCAL_URL,
} from '../services/hosted-server-session';
import { HOSTED_SERVER_INSTANCE_ID, store } from '../services/store.service';
import {
    parseRetryAfter,
    profileRequestTarget,
} from './source-sync-profile-route';
import { sourceRequestRoute as route } from './source-sync-request-route';

export async function sourceServerRequest(
    apiUrl: string,
    token: string,
    request: SourceServerRequest,
    instanceId?: string,
    useHosted = false
): Promise<SourceServerResponse> {
    const profileTarget = profileRequestTarget(request);
    const target = profileTarget ?? route(request);
    if (request.source) validateSource(request.source);
    const body = profileTarget
        ? profileTarget.body
        : request.operation === 'tmdb-transfer'
          ? request.tmdbTransfer?.request
          : (request.history ??
            request.favorite ??
            request.activity ??
            request.source);
    const revisionHeaders =
        profileTarget?.headers ??
        (request.revision
            ? {
                  [request.operation === 'list' ? 'If-None-Match' : 'If-Match']:
                      request.revision,
              }
            : {});
    if (apiUrl === HOSTED_SERVER_LOCAL_URL + '/api') {
        const hostedInstance = store.get(HOSTED_SERVER_INSTANCE_ID);
        if (useHosted || (instanceId && instanceId === hostedInstance)) {
            const worker = hostedWorkerRequest(
                instanceId ? { apiUrl, instanceId } : undefined
            );
            if (!worker) throw new Error('SOURCE_SYNC.OFFLINE');
            try {
                const { retryAfter: workerRetryAfter, ...response } =
                    await worker({
                        ...target,
                        headers: {
                            ...(instanceId
                                ? { 'X-IPTVnator-Instance-Id': instanceId }
                                : {}),
                            ...(request.operation === 'create'
                                ? { 'If-None-Match': '*' }
                                : {}),
                            ...revisionHeaders,
                        },
                        body,
                    });
                const retryAfter = parseRetryAfter(workerRetryAfter);
                return {
                    ...response,
                    ...(retryAfter !== undefined ? { retryAfter } : {}),
                };
            } catch {
                throw new Error('SOURCE_SYNC.OFFLINE');
            }
        }
    }
    try {
        const response = await requestWithValidatedRedirects(
            `${apiUrl}${target.path}`,
            {
                method: target.method,
                agentFactory: {
                    createHttpsAgent: (lookup) =>
                        new Agent({
                            lookup,
                            ca: [
                                ...getCACertificates('default'),
                                ...getCACertificates('system'),
                            ],
                        }),
                },
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
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                    ...(request.operation === 'create'
                        ? { 'If-None-Match': '*' }
                        : {}),
                    ...revisionHeaders,
                },
                data: body,
            },
            {
                allowPrivateNetworks: true,
                pinAllowedPrivateNetworkHosts: true,
                allowPrivateNetworkRedirects: false,
            },
            0
        );
        const retryAfter = parseRetryAfter(response.headers['retry-after']);
        return {
            status: response.status,
            etag: response.headers['etag'],
            ...(retryAfter !== undefined ? { retryAfter } : {}),
            body: response.data,
        };
    } catch {
        // Axios errors carry request headers and provider credentials in data.
        throw new Error('SOURCE_SYNC.OFFLINE');
    }
}

export function registerSourceSyncEvents(
    prepareRestart: () => void | Promise<void>
): void {
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
    ipcMain.on(SOURCE_SYNC_SAVED_CONNECTION, (event) => {
        const saved = readSavedSourceServerConfig();
        event.returnValue = saved
            ? {
                  apiUrl: saved.apiUrl,
                  instanceId: saved.instanceId,
                  hasToken: Boolean(
                      saved.encryptedToken || getHostedServerAccessCode(saved)
                  ),
              }
            : null;
    });
    ipcMain.handle(
        SOURCE_SYNC_REQUEST,
        async (_event, request: SourceServerRequest) => {
            profileRequestTarget(request);
            const config = readSourceServerConfig();
            if (!config) throw new Error('SOURCE_SYNC.OFFLINE');
            if (request.operation === 'tmdb-transfer') {
                const expected = request.tmdbTransfer?.connection;
                if (
                    expected?.apiUrl !== config.apiUrl ||
                    expected.instanceId !== config.instanceId
                )
                    return { status: 409, body: { code: 'instance_changed' } };
            }
            return transport.execute(config, request, () =>
                sourceServerToken(config)
            );
        }
    );
    ipcMain.handle(
        SOURCE_SYNC_CONFIGURE,
        async (
            _event,
            url: string,
            token: string,
            restart: boolean,
            savedInstanceIdOrHosted?: string | true
        ) => {
            const useHosted = savedInstanceIdOrHosted === true;
            const savedInstanceId =
                typeof savedInstanceIdOrHosted === 'string'
                    ? savedInstanceIdOrHosted
                    : undefined;
            let configured: ReturnType<typeof readSourceServerConfig> = null;
            try {
                configured = readSourceServerConfig();
            } catch {
                if (!restart) throw new Error('SOURCE_SYNC.INCOMPATIBLE');
            }
            const saved =
                !configured && restart ? readSavedSourceServerConfig() : null;
            const input = url.replace(/\/$/, '');
            const apiUrl =
                configured?.apiUrl === input || saved?.apiUrl === input
                    ? input
                    : normalizeSourceServerUrl(url);
            if (typeof token !== 'string' || token.length > 8192)
                throw new Error('Invalid access token');
            if (
                useHosted &&
                (apiUrl !== HOSTED_SERVER_LOCAL_URL + '/api' ||
                    !hostedWorkerRequest())
            )
                throw new Error('SOURCE_SYNC.OFFLINE');
            const previousInstance =
                configured?.apiUrl === apiUrl
                    ? configured.instanceId
                    : undefined;
            const hosted =
                useHosted ||
                (apiUrl === HOSTED_SERVER_LOCAL_URL + '/api' &&
                    !!previousInstance &&
                    (configured?.hosted === true ||
                        previousInstance ===
                            store.get(HOSTED_SERVER_INSTANCE_ID))) ||
                (savedInstanceId !== undefined &&
                    saved?.apiUrl === apiUrl &&
                    saved.hosted === true &&
                    apiUrl === HOSTED_SERVER_LOCAL_URL + '/api');
            const probe = await sourceServerRequest(
                apiUrl,
                token,
                {
                    operation: 'instance',
                },
                useHosted || (hosted && savedInstanceId !== undefined)
                    ? getHostedServerInstanceId()
                    : previousInstance,
                hosted
            );
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
            if (savedInstanceId !== undefined) {
                if (
                    !saved ||
                    saved.apiUrl !== apiUrl ||
                    saved.instanceId !== savedInstanceId ||
                    instance.instanceId !== savedInstanceId
                )
                    throw new Error('SOURCE_SYNC.SAVED_INSTANCE_CHANGED');
                token = sourceServerToken(saved);
            }
            const check = await sourceServerRequest(
                apiUrl,
                token,
                { operation: 'list' },
                instance.instanceId,
                hosted
            );
            if (check.status !== 200)
                throw new Error(
                    check.status === 401
                        ? 'SOURCE_SYNC.LOCKED'
                        : 'SOURCE_SYNC.REQUEST_FAILED'
                );
            if (saved && savedInstanceId !== undefined) {
                const latest = readSavedSourceServerConfig();
                if (
                    latest?.apiUrl !== saved.apiUrl ||
                    latest.instanceId !== saved.instanceId ||
                    latest.encryptedToken !== saved.encryptedToken
                )
                    throw new Error('SOURCE_SYNC.SAVED_INSTANCE_CHANGED');
            }
            const persisted = saveSourceServerConfig(
                {
                    apiUrl,
                    instanceId: instance.instanceId,
                    ...(hosted ? { hosted: true } : {}),
                },
                token
            );
            const needsRestart =
                !configured ||
                configured.apiUrl !== apiUrl ||
                configured.instanceId !== instance.instanceId;
            if (restart && needsRestart) {
                // app.exit() skips will-quit, where ordinary quits tear down
                // managed players and the database worker.
                await prepareRestart();
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
    ipcMain.handle(SOURCE_SYNC_DISCONNECT, async () => {
        disconnectSourceServerConfig();
        await prepareRestart();
        app.relaunch();
        app.exit();
    });
    ipcMain.handle(SOURCE_SYNC_FORGET, () => {
        if (readSavedSourceServerConfig()) clearSourceServerConfig();
    });
}
