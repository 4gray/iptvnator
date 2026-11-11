import { spawn, type ChildProcess } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
    app,
    ipcMain,
    safeStorage,
    type BrowserWindow,
    type IpcMainInvokeEvent,
} from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import {
    HOSTED_CLOUDFLARE_CONTROL,
    type HostedCloudflareStatus,
} from '@iptvnator/shared/interfaces';

const credential = () =>
    join(getIptvnatorDataRoot(), 'hosted-server', 'cloudflare-token.enc');
const executable = () =>
    join(
        process.resourcesPath,
        'cloudflared',
        process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
    );
let child: ChildProcess | undefined;
let phase: HostedCloudflareStatus['state'] = 'stopped';

function secureStorageAvailable(): boolean {
    return (
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== 'linux' ||
            safeStorage.getSelectedStorageBackend() !== 'basic_text')
    );
}
function status(): HostedCloudflareStatus {
    return {
        state:
            !app.isPackaged || !existsSync(executable())
                ? 'unavailable'
                : phase,
        savedToken: existsSync(credential()),
        secureStorage: secureStorageAvailable(),
    };
}
function saveToken(token: string): void {
    if (!secureStorageAvailable())
        throw new Error('Secure credential storage is unavailable');
    if (!/^[A-Za-z0-9_+/=-]{16,8192}$/.test(token))
        throw new Error('Invalid tunnel token');
    mkdirSync(join(getIptvnatorDataRoot(), 'hosted-server'), {
        recursive: true,
        mode: 0o700,
    });
    writeFileSync(credential(), safeStorage.encryptString(token), {
        mode: 0o600,
    });
}
function readToken(): string {
    if (!secureStorageAvailable())
        throw new Error('Secure credential storage is unavailable');
    try {
        return safeStorage.decryptString(readFileSync(credential()));
    } catch {
        throw new Error('Saved tunnel token is unavailable');
    }
}
export function stopHostedCloudflare(): void {
    if (child) {
        phase = 'stopping';
        child.kill();
    } else {
        phase = 'stopped';
    }
}
function connectorEnvironment(secret: string): NodeJS.ProcessEnv {
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) => !/^(TUNNEL_|CLOUDFLARED_|NO_AUTOUPDATE$)/i.test(key)
        )
    );
    return { ...env, TUNNEL_TOKEN: secret };
}
function start(token?: string): Promise<HostedCloudflareStatus> {
    if (child) throw new Error('Connector is already running or stopping');
    if (status().state === 'unavailable')
        throw new Error('Bundled connector is unavailable');
    if (token !== undefined) saveToken(token);
    const secret = token ?? readToken();
    const config = join(
        getIptvnatorDataRoot(),
        'hosted-server',
        'cloudflare-config.yml'
    );
    // Avoid loading unrelated settings or logging destinations from the user's home directory.
    writeFileSync(config, '{}\n', { mode: 0o600 });
    phase = 'starting';
    return new Promise((resolve) => {
        let processChild: ChildProcess;
        try {
            processChild = spawn(
                executable(),
                ['tunnel', '--config', config, '--no-autoupdate', 'run'],
                {
                    env: connectorEnvironment(secret),
                    stdio: 'ignore',
                    windowsHide: true,
                }
            );
        } catch {
            phase = 'error';
            resolve(status());
            return;
        }
        child = processChild;
        processChild.once('spawn', () => {
            if (child === processChild && phase === 'starting')
                phase = 'running';
            resolve(status());
        });
        processChild.once('error', () => {
            if (child === processChild) {
                child = undefined;
                phase = 'error';
            }
            resolve(status());
        });
        processChild.once('exit', () => {
            if (child === processChild) {
                child = undefined;
                phase = phase === 'stopping' ? 'stopped' : 'error';
            }
        });
    });
}
export function registerHostedCloudflareEvents(
    getWindow: () => BrowserWindow | null,
    ingressActive: () => boolean,
    enqueue: <T>(operation: () => T | Promise<T>) => Promise<T>
): void {
    ipcMain.handle(
        HOSTED_CLOUDFLARE_CONTROL,
        (event: IpcMainInvokeEvent, command: unknown) => {
            if (
                event.sender !== getWindow()?.webContents ||
                event.senderFrame !== event.sender.mainFrame
            )
                throw new Error('Invalid connector request');
            return enqueue(() => {
                if (command === 'status') return status();
                if (command === 'stop') {
                    stopHostedCloudflare();
                    return status();
                }
                if (command === 'forget') {
                    if (child) throw new Error('Stop the connector first');
                    rmSync(credential(), { force: true });
                    return status();
                }
                if (
                    command &&
                    typeof command === 'object' &&
                    'start' in command &&
                    command.start === true
                ) {
                    if (!ingressActive())
                        throw new Error('Hosted HTTPS ingress is unavailable');
                    const token =
                        'token' in command ? command.token : undefined;
                    if (token !== undefined && typeof token !== 'string')
                        throw new Error('Invalid tunnel token');
                    return start(typeof token === 'string' ? token : undefined);
                }
                throw new Error('Invalid connector command');
            });
        }
    );
}
