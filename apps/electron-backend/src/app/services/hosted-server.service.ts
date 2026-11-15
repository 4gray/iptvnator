import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import {
    ipcMain,
    utilityProcess,
    type BrowserWindow,
    type IpcMainInvokeEvent,
    type UtilityProcess,
} from 'electron';
import {
    HOSTED_SERVER_ACCESS_CODE,
    HOSTED_SERVER_CONTROL,
    HOSTED_SERVER_PORT,
    type HostedServerMode,
    type HostedServerStatus,
    type HostedServerWorkerMessage,
} from '@iptvnator/shared/interfaces';
import {
    HOSTED_SERVER_ENABLED,
    HOSTED_SERVER_LAN_ADDRESS,
    HOSTED_SERVER_MODE,
    HOSTED_SERVER_CONFIGURATIONS,
    HOSTED_SERVER_INSTANCE_ID,
    store,
} from './store.service';

import {
    getHostedServerAccessCode,
    HOSTED_SERVER_LOCAL_URL,
    setHostedServerSession,
} from './hosted-server-session';
import { legacyHostedControl } from './hosted-legacy-control';
import {
    hostedAccessCode,
    hostedDataDir,
    hostedWorkerPaths,
} from './hosted-server-files';
import { registerHostedDeviceEvents } from './hosted-device-control';
import { createHostedWorkerClient } from './hosted-worker-client';
import {
    checkHostedPublicRoute,
    validateHostedMode,
} from './hosted-mode-config';
import {
    registerHostedCloudflareEvents,
    stopHostedCloudflare,
    startHostedCloudflare,
    shutdownHostedCloudflare,
} from './hosted-cloudflare.service';
const PORT = HOSTED_SERVER_PORT;

let child: UtilityProcess | undefined;
let state: HostedServerStatus = { state: 'stopped' };
let transition = Promise.resolve();
let checkingRoute = false;

function privateAddresses(): string[] {
    return [
        ...new Set(
            Object.values(networkInterfaces()).flatMap((entries) =>
                (entries ?? [])
                    .filter(
                        ({ family, internal, address, cidr }) =>
                            family === 'IPv4' &&
                            !internal &&
                            cidr &&
                            /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
                                address
                            )
                    )
                    .map(({ address }) => address)
            )
        ),
    ];
}

function status(): HostedServerStatus {
    const { entry, assets } = hostedWorkerPaths();
    if (!existsSync(entry) || !existsSync(join(assets, 'index.html')))
        return { state: 'unavailable' };
    const availableAddresses = privateAddresses();
    const lanAddress = store.get(HOSTED_SERVER_LAN_ADDRESS, '') || undefined;
    const lanUrl =
        lanAddress && availableAddresses.includes(lanAddress)
            ? state.lanUrl
            : undefined;
    return {
        ...state,
        autoStart: store.get(HOSTED_SERVER_ENABLED, false),
        configuration: store.get(HOSTED_SERVER_MODE),
        savedConfigurations: store.get(HOSTED_SERVER_CONFIGURATIONS),
        availableAddresses,
        lanAddress,
        lanUrl,
        ...(state.mode === 'lan' ? { endpoint: lanUrl } : {}),
    };
}

async function start(
    lanAddress: string,
    configuration?: HostedServerMode,
    connectorToken?: string
): Promise<void> {
    if (child || status().state === 'unavailable') return;
    state = { state: 'starting' };
    const lanHost = privateAddresses().includes(lanAddress) ? lanAddress : '';
    let failure: HostedServerStatus['error'] = 'startup';
    try {
        const { entry, assets } = hostedWorkerPaths();
        const code = hostedAccessCode();
        const process = utilityProcess.fork(entry, [], {
            env: {
                ...globalThis.process.env,
                IPTVNATOR_STORAGE: 'server',
                IPTVNATOR_DATA_DIR: hostedDataDir(),
                // The E2E data root would take precedence over the hosted directory.
                IPTVNATOR_E2E_DATA_DIR: '',
                IPTVNATOR_SOURCE_PROFILE: '',
                IPTVNATOR_ACCESS_TOKEN: code,
                IPTVNATOR_HOSTED_ASSETS: assets,
                IPTVNATOR_HOSTED_LAN: lanHost,
                IPTVNATOR_HOSTED_MODE: configuration
                    ? JSON.stringify(configuration)
                    : '',
                ...(configuration?.mode === 'cloudflare'
                    ? {
                          IPTVNATOR_CLOUDFLARE_ACCESS_ORIGIN:
                              configuration.origin,
                          IPTVNATOR_CLOUDFLARE_ACCESS_TEAM: configuration.team,
                          IPTVNATOR_CLOUDFLARE_ACCESS_AUDIENCE:
                              configuration.audience,
                      }
                    : {}),
                PORT: String(PORT),
            },
            stdio: 'ignore',
            serviceName: 'IPTVnator Hosted Server',
        });
        child = process;
        const instanceId = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error()), 20000);
            process.once('message', (message: HostedServerWorkerMessage) => {
                clearTimeout(timeout);
                if ('ready' in message) resolve(message.instanceId);
                else if ('error' in message) {
                    failure = message.error;
                    reject(new Error());
                }
            });
            process.once('exit', () => {
                clearTimeout(timeout);
                if (child !== process) return;
                child = undefined;
                setHostedServerSession();
                stopHostedCloudflare();
                if (state.state !== 'stopping')
                    state = { state: 'error', error: failure };
                reject(new Error());
            });
        });
        if (configuration?.mode === 'cloudflare' && configuration.managed) {
            failure = 'connector';
            const connector = await startHostedCloudflare(connectorToken);
            if (child !== process || connector.state !== 'running')
                throw new Error();
            failure = 'startup';
        }
        if (!configuration || configuration.mode === 'lan')
            store.set(HOSTED_SERVER_LAN_ADDRESS, lanAddress);
        if (configuration) {
            const previous = store.get(HOSTED_SERVER_MODE);
            store.set(HOSTED_SERVER_CONFIGURATIONS, {
                ...store.get(HOSTED_SERVER_CONFIGURATIONS),
                ...(previous ? { [previous.mode]: previous } : {}),
                [configuration.mode]: configuration,
            });
            store.set(HOSTED_SERVER_MODE, configuration);
        }
        if (configuration) store.set(HOSTED_SERVER_INSTANCE_ID, instanceId);
        store.set(HOSTED_SERVER_ENABLED, true);
        setHostedServerSession({
            instanceId,
            code,
            ...(configuration
                ? { request: createHostedWorkerClient(process) }
                : {}),
        });
        const lanUrl = lanHost ? `http://${lanHost}:${PORT}` : undefined;
        const endpoint =
            configuration && 'origin' in configuration
                ? configuration.origin
                : lanUrl;
        state = {
            state: 'running',
            localUrl: HOSTED_SERVER_LOCAL_URL,
            lanUrl,
            ...(configuration
                ? {
                      endpoint,
                      mode: configuration.mode,
                      lanAccess:
                          configuration.mode === 'lan'
                              ? configuration.access
                              : undefined,
                      httpsOrigin:
                          'origin' in configuration
                              ? configuration.origin
                              : undefined,
                      publicRoute:
                          configuration.mode === 'cloudflare'
                              ? 'unchecked'
                              : undefined,
                  }
                : {}),
        };
        verifyPublicRoute();
    } catch {
        if (configuration?.mode === 'cloudflare')
            await shutdownHostedCloudflare().catch(() => undefined);
        const failedProcess = child;
        if (failedProcess) {
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    resolve();
                }, 6000);
                failedProcess.once('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                failedProcess.kill();
            });
        }
        state = { state: 'error', error: failure };
    }
}

function verifyPublicRoute(): void {
    if (checkingRoute || state.mode !== 'cloudflare' || !state.endpoint) return;
    const worker = child;
    checkingRoute = true;
    void checkHostedPublicRoute(state.endpoint)
        .then((publicRoute) => {
            if (worker === child && state.state === 'running')
                state = { ...state, publicRoute };
        })
        .finally(() => {
            checkingRoute = false;
        });
}

async function shutdownWorker(): Promise<void> {
    const connector = shutdownHostedCloudflare();
    void connector.catch(() => undefined);
    const process = child;
    if (process) {
        state = { state: 'stopping' };
        try {
            await new Promise<void>((resolve, reject) => {
                const onExit = () => {
                    clearTimeout(forceStop);
                    clearTimeout(deadline);
                    resolve();
                };
                const forceStop = setTimeout(() => process.kill(), 6000);
                const deadline = setTimeout(() => {
                    process.off('exit', onExit);
                    reject(new Error('Hosted worker did not stop'));
                }, 8000);
                process.once('exit', onExit);
                try {
                    process.postMessage('stop');
                } catch {
                    process.kill();
                }
            });
        } catch (error) {
            setHostedServerSession();
            state = { state: 'error', error: 'startup' };
            throw error;
        }
    }
    state = { state: 'stopped' };
    await connector;
}

function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = transition.then(operation);
    transition = result.then(
        () => undefined,
        () => undefined
    );
    return result;
}

function run(operation: () => Promise<void>): Promise<HostedServerStatus> {
    return enqueue(operation).then(status);
}

export function restoreHostedServer(): Promise<HostedServerStatus> {
    return run(async () => {
        const address = store.get(HOSTED_SERVER_LAN_ADDRESS, '');
        const saved = store.get(HOSTED_SERVER_MODE);
        if (saved?.mode === 'proxy') {
            store.set(HOSTED_SERVER_ENABLED, false);
            return;
        }
        const configuration = saved ?? {
            mode: 'lan' as const,
            address: privateAddresses().includes(address) ? address : '',
            access: 'paired' as const,
        };
        try {
            const mode = validateHostedMode(configuration, privateAddresses());
            await start(mode.mode === 'lan' ? mode.address : '', mode);
        } catch {
            state = { state: 'error', error: 'startup' };
        }
    });
}

export function stopHostedServerForRestart(): Promise<HostedServerStatus> {
    return run(shutdownWorker);
}

export function stopHostedServerOnQuit(): void {
    stopHostedCloudflare();
    child?.kill();
}

export function registerHostedServerEvents(
    getWindow: () => BrowserWindow | null
): void {
    registerHostedCloudflareEvents(
        getWindow,
        () =>
            !state.mode &&
            state.state === 'running' &&
            !!state.httpsOrigin &&
            !state.httpsError,
        enqueue
    );
    const checkSender = (event: IpcMainInvokeEvent) => {
        if (
            event.sender !== getWindow()?.webContents ||
            event.senderFrame !== event.sender.mainFrame
        )
            throw new Error('Invalid hosted server request');
    };
    registerHostedDeviceEvents(checkSender, status, enqueue);
    ipcMain.handle(HOSTED_SERVER_CONTROL, (event, command: unknown) => {
        checkSender(event);
        if (command === 'status') {
            verifyPublicRoute();
            return status();
        }
        if (command === 'stop')
            return run(async () => {
                store.set(HOSTED_SERVER_ENABLED, false);
                await shutdownWorker();
            });
        if (
            command &&
            typeof command === 'object' &&
            'start' in command &&
            command.start === true
        ) {
            if ('configuration' in command) {
                const mode = validateHostedMode(
                    command.configuration,
                    privateAddresses()
                );
                const token =
                    'connectorToken' in command
                        ? command.connectorToken
                        : undefined;
                if (
                    token !== undefined &&
                    (typeof token !== 'string' ||
                        !/^[A-Za-z0-9_+/=-]{16,8192}$/.test(token) ||
                        mode.mode !== 'cloudflare' ||
                        !mode.managed)
                )
                    throw new Error('Invalid tunnel token');
                return run(async () => {
                    await shutdownWorker();
                    await start(
                        mode.mode === 'lan' ? mode.address : '',
                        mode,
                        typeof token === 'string' ? token : undefined
                    );
                });
            }
            const address = 'lanAddress' in command ? command.lanAddress : '';
            if (
                typeof address !== 'string' ||
                (address && !privateAddresses().includes(address))
            )
                throw new Error('Invalid hosted server address');
            return run(() => start(address));
        }
        const result = legacyHostedControl(command, {
            state: () => state,
            setState: (value) => {
                state = value;
            },
            worker: () => child,
            availableAddresses: privateAddresses,
            savedAddress: () => store.get(HOSTED_SERVER_LAN_ADDRESS, ''),
            stop: shutdownWorker,
            start,
            run,
        });
        if (result) return result;
        throw new Error('Invalid hosted server command');
    });
    ipcMain.handle(HOSTED_SERVER_ACCESS_CODE, (event) => {
        checkSender(event);
        if (state.state !== 'running' || state.mode)
            throw new Error('Server access code is unavailable');
        return getHostedServerAccessCode();
    });
}
