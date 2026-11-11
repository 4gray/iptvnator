import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import {
    app,
    ipcMain,
    utilityProcess,
    type BrowserWindow,
    type IpcMainInvokeEvent,
    type UtilityProcess,
} from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import {
    HOSTED_SERVER_ACCESS_CODE,
    HOSTED_SERVER_CONTROL,
    HOSTED_SERVER_PORT,
    type HostedServerStatus,
    type HostedServerWorkerMessage,
} from '@iptvnator/shared/interfaces';
import {
    HOSTED_SERVER_ENABLED,
    HOSTED_SERVER_LAN_ADDRESS,
    store,
} from './store.service';

import {
    getHostedServerAccessCode,
    HOSTED_SERVER_LOCAL_URL,
    setHostedServerSession,
} from './hosted-server-session';
const PORT = HOSTED_SERVER_PORT;
const dataDir = () => join(getIptvnatorDataRoot(), 'hosted-server');

function accessCode(): string {
    const dir = dataDir();
    const filename = join(dir, 'access-code');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        writeFileSync(filename, randomBytes(10).toString('hex'), {
            flag: 'wx',
            mode: 0o600,
            flush: true,
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const token = readFileSync(filename, 'utf8');
    if (!/^[a-f0-9]{20}$/.test(token))
        throw new Error('Invalid hosted access code');
    return token;
}

function paths() {
    const root = app.getAppPath();
    return app.isPackaged
        ? {
              entry: join(root, 'hosted-backend/main.cjs'),
              assets: join(root, 'hosted-pwa'),
          }
        : {
              entry: join(root, '../web-backend/main.cjs'),
              assets: join(root, '../hosted-pwa/browser'),
          };
}

let child: UtilityProcess | undefined;
let state: HostedServerStatus = { state: 'stopped' };
let transition = Promise.resolve();

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
    const { entry, assets } = paths();
    if (!existsSync(entry) || !existsSync(join(assets, 'index.html')))
        return { state: 'unavailable' };
    const availableAddresses = privateAddresses();
    const lanAddress = store.get(HOSTED_SERVER_LAN_ADDRESS, '') || undefined;
    return {
        ...state,
        autoStart: store.get(HOSTED_SERVER_ENABLED, false),
        availableAddresses,
        lanAddress,
        lanUrl:
            lanAddress && availableAddresses.includes(lanAddress)
                ? state.lanUrl
                : undefined,
    };
}

async function start(lanAddress: string): Promise<void> {
    if (child || status().state === 'unavailable') return;
    state = { state: 'starting' };
    const lanHost = privateAddresses().includes(lanAddress) ? lanAddress : '';
    let failure: HostedServerStatus['error'] = 'startup';
    try {
        const { entry, assets } = paths();
        const code = accessCode();
        const process = utilityProcess.fork(entry, [], {
            env: {
                ...globalThis.process.env,
                IPTVNATOR_STORAGE: 'server',
                IPTVNATOR_DATA_DIR: dataDir(),
                // The E2E data root would take precedence over the hosted directory.
                IPTVNATOR_E2E_DATA_DIR: '',
                IPTVNATOR_SOURCE_PROFILE: '',
                IPTVNATOR_ACCESS_TOKEN: code,
                IPTVNATOR_HOSTED_ASSETS: assets,
                IPTVNATOR_HOSTED_LAN: lanHost,
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
                else {
                    failure = message.error;
                    reject(new Error());
                }
            });
            process.once('exit', () => {
                clearTimeout(timeout);
                if (child !== process) return;
                child = undefined;
                setHostedServerSession();
                if (state.state !== 'stopping')
                    state = { state: 'error', error: failure };
                reject(new Error());
            });
        });
        store.set(HOSTED_SERVER_LAN_ADDRESS, lanAddress);
        store.set(HOSTED_SERVER_ENABLED, true);
        setHostedServerSession({ instanceId, code });
        state = {
            state: 'running',
            localUrl: HOSTED_SERVER_LOCAL_URL,
            ...(lanHost ? { lanUrl: `http://${lanHost}:${PORT}` } : {}),
        };
    } catch {
        child?.kill();
        state = { state: 'error', error: failure };
    }
}

async function shutdownWorker(): Promise<void> {
    const process = child;
    if (process) {
        state = { state: 'stopping' };
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => process.kill(), 6000);
            process.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
            process.postMessage('stop');
        });
    }
    state = { state: 'stopped' };
}

function run(operation: () => Promise<void>): Promise<HostedServerStatus> {
    const result = transition.then(operation);
    transition = result.catch(() => undefined);
    return result.then(status);
}

export function restoreHostedServer(): Promise<HostedServerStatus> {
    return run(() => start(store.get(HOSTED_SERVER_LAN_ADDRESS, '')));
}

export function stopHostedServerForRestart(): Promise<HostedServerStatus> {
    return run(shutdownWorker);
}

export function stopHostedServerOnQuit(): void {
    child?.kill();
}

export function registerHostedServerEvents(
    getWindow: () => BrowserWindow | null
): void {
    const checkSender = (event: IpcMainInvokeEvent) => {
        if (
            event.sender !== getWindow()?.webContents ||
            event.senderFrame !== event.sender.mainFrame
        )
            throw new Error('Invalid hosted server request');
    };
    ipcMain.handle(HOSTED_SERVER_CONTROL, (event, command: unknown) => {
        checkSender(event);
        if (command === 'status') return status();
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
            const address = 'lanAddress' in command ? command.lanAddress : '';
            if (
                typeof address !== 'string' ||
                (address && !privateAddresses().includes(address))
            )
                throw new Error('Invalid hosted server address');
            return run(() => start(address));
        }
        throw new Error('Invalid hosted server command');
    });
    ipcMain.handle(HOSTED_SERVER_ACCESS_CODE, (event) => {
        checkSender(event);
        if (state.state !== 'running') throw new Error('Server is unavailable');
        return getHostedServerAccessCode();
    });
}
