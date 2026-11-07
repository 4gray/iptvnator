import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { app, ipcMain, utilityProcess, type BrowserWindow } from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import {
    HOSTED_SERVER_ACCESS_CODE,
    HOSTED_SERVER_CONTROL,
    HOSTED_SERVER_PORT,
    type HostedServerWorkerMessage,
} from '@iptvnator/shared/interfaces';
import {
    registerHostedServerEvents,
    restoreHostedServer,
    stopHostedServerForRestart,
    stopHostedServerOnQuit,
} from './hosted-server.service';
import { getHostedServerAccessCode } from './hosted-server-session';
import {
    HOSTED_SERVER_ENABLED,
    HOSTED_SERVER_LAN_ADDRESS,
    store,
} from './store.service';

jest.mock('electron', () => ({
    app: { isPackaged: true, getAppPath: jest.fn() },
    ipcMain: { handle: jest.fn() },
    utilityProcess: { fork: jest.fn() },
}));
jest.mock('node:os', () => ({
    ...jest.requireActual('node:os'),
    networkInterfaces: jest.fn(),
}));
jest.mock('@iptvnator/shared/database/path-utils', () => ({
    getIptvnatorDataRoot: jest.fn(),
}));
jest.mock('./store.service', () => ({
    HOSTED_SERVER_ENABLED: 'HOSTED_SERVER_ENABLED',
    HOSTED_SERVER_LAN_ADDRESS: 'HOSTED_SERVER_LAN_ADDRESS',
    store: { get: jest.fn(), set: jest.fn() },
}));

const lanAddress = '192.168.40.5';
const localUrl = `http://127.0.0.1:${HOSTED_SERVER_PORT}`;
const lanUrl = `http://${lanAddress}:${HOSTED_SERVER_PORT}`;
const ready = { ready: true, instanceId: 'synthetic-instance' } as const;

describe('desktop hosted server lifecycle', () => {
    let directory: string;
    const mainFrame = {};
    const webContents = { mainFrame };
    const event = { sender: webContents, senderFrame: mainFrame };
    const settings = new Map<string, unknown>();

    const invoke = (channel: string, command?: unknown, sender = event) => {
        const registration = jest
            .mocked(ipcMain.handle)
            .mock.calls.find(([name]) => name === channel);
        if (!registration)
            throw new Error('Hosted server IPC was not registered');
        return registration[1](
            sender as Parameters<(typeof registration)[1]>[0],
            command
        );
    };
    const control = (command: unknown) =>
        invoke(HOSTED_SERVER_CONTROL, command);

    function addAssets(entry: string, assets: string) {
        mkdirSync(dirname(entry), { recursive: true });
        mkdirSync(assets, { recursive: true });
        writeFileSync(entry, '');
        writeFileSync(
            join(assets, 'index.html'),
            '<title>Synthetic PWA</title>'
        );
    }

    function nextWorker(message?: HostedServerWorkerMessage) {
        const worker = Object.assign(new EventEmitter(), {
            postMessage: jest.fn(() =>
                queueMicrotask(() => worker.emit('exit', 0))
            ),
            kill: jest.fn(() => {
                queueMicrotask(() => worker.emit('exit', 1));
                return true;
            }),
        });
        jest.mocked(utilityProcess.fork).mockImplementationOnce(() => {
            queueMicrotask(() =>
                message
                    ? worker.emit('message', message)
                    : worker.emit('exit', 1)
            );
            return worker as unknown as ReturnType<typeof utilityProcess.fork>;
        });
        return worker;
    }

    beforeEach(() => {
        jest.resetAllMocks();
        settings.clear();
        directory = mkdtempSync(join(tmpdir(), 'iptvnator-hosted-unit-'));
        jest.mocked(getIptvnatorDataRoot).mockReturnValue(directory);
        jest.mocked(app.getAppPath).mockReturnValue(directory);
        jest.replaceProperty(app, 'isPackaged', true);
        jest.mocked(networkInterfaces).mockReturnValue({
            fixture: [
                {
                    address: lanAddress,
                    family: 'IPv4',
                    internal: false,
                    cidr: `${lanAddress}/24`,
                    netmask: '255.255.255.0',
                    mac: '00:00:00:00:00:00',
                },
                {
                    address: '203.0.113.5',
                    family: 'IPv4',
                    internal: false,
                    cidr: '203.0.113.5/24',
                    netmask: '255.255.255.0',
                    mac: '00:00:00:00:00:00',
                },
            ],
        });
        (store.get as jest.Mock).mockImplementation((key, fallback) =>
            settings.has(key) ? settings.get(key) : fallback
        );
        (store.set as jest.Mock).mockImplementation((key, value) =>
            settings.set(key, value)
        );
        registerHostedServerEvents(
            () => ({ webContents }) as unknown as BrowserWindow
        );
    });

    afterEach(async () => {
        await stopHostedServerForRestart();
        jest.restoreAllMocks();
        rmSync(directory, { recursive: true, force: true });
    });

    it('starts only once for concurrent requests and restores the same local access code', async () => {
        const entry = join(directory, 'hosted-backend/main.cjs');
        const assets = join(directory, 'hosted-pwa');
        addAssets(entry, assets);
        const worker = nextWorker(ready);

        const [status, repeated] = await Promise.all([
            control({ start: true }),
            control({ start: true }),
        ]);
        expect(status).toMatchObject({
            state: 'running',
            localUrl,
            autoStart: true,
        });
        expect(repeated).toEqual(status);
        expect(status.lanUrl).toBeUndefined();
        expect(utilityProcess.fork).toHaveBeenCalledTimes(1);
        const code = invoke(HOSTED_SERVER_ACCESS_CODE);
        expect(code).toMatch(/^[a-f0-9]{20}$/);
        expect(utilityProcess.fork).toHaveBeenCalledWith(
            entry,
            [],
            expect.objectContaining({
                env: expect.objectContaining({
                    IPTVNATOR_HOSTED_ASSETS: assets,
                    IPTVNATOR_ACCESS_TOKEN: code,
                    IPTVNATOR_HOSTED_LAN: '',
                }),
            })
        );
        expect(
            getHostedServerAccessCode({
                apiUrl: localUrl + '/api',
                instanceId: ready.instanceId,
            })
        ).toBe(code);
        expect(
            getHostedServerAccessCode({
                apiUrl: localUrl + '/api',
                instanceId: 'different-instance',
            })
        ).toBe('');
        expect(
            getHostedServerAccessCode({
                apiUrl: 'https://fixture.test/api',
                instanceId: ready.instanceId,
            })
        ).toBe('');

        expect(await stopHostedServerForRestart()).toMatchObject({
            state: 'stopped',
            autoStart: true,
        });
        expect(worker.postMessage).toHaveBeenCalledWith('stop');
        expect(getHostedServerAccessCode()).toBe('');
        nextWorker(ready);
        expect(await restoreHostedServer()).toMatchObject({ state: 'running' });
        expect(invoke(HOSTED_SERVER_ACCESS_CODE)).toBe(code);
        expect(await control('stop')).toMatchObject({
            state: 'stopped',
            autoStart: false,
        });
        expect(() => invoke(HOSTED_SERVER_ACCESS_CODE)).toThrow(
            'Server is unavailable'
        );
    });

    it('exposes the chosen private address only while it remains assigned', async () => {
        const entry = join(directory, 'web-backend/main.cjs');
        const assets = join(directory, 'hosted-pwa/browser');
        addAssets(entry, assets);
        jest.replaceProperty(app, 'isPackaged', false);
        jest.mocked(app.getAppPath).mockReturnValue(
            join(directory, 'electron-backend')
        );
        mkdirSync(app.getAppPath());
        expect(control('status')).toMatchObject({
            availableAddresses: [lanAddress],
        });
        expect(() =>
            control({ start: true, lanAddress: '203.0.113.5' })
        ).toThrow('Invalid hosted server address');
        expect(() => control({ start: true, lanAddress: 42 })).toThrow(
            'Invalid hosted server address'
        );
        const worker = nextWorker(ready);
        expect(await control({ start: true, lanAddress })).toMatchObject({
            lanUrl,
            lanAddress,
        });
        expect(settings.get(HOSTED_SERVER_LAN_ADDRESS)).toBe(lanAddress);
        jest.mocked(networkInterfaces).mockReturnValue({});
        expect(control('status').lanUrl).toBeUndefined();
        const exited = new Promise<void>((resolve) =>
            worker.once('exit', resolve)
        );
        stopHostedServerOnQuit();
        await exited;
        expect(getHostedServerAccessCode()).toBe('');
    });

    it.each([
        ['port conflict', { error: 'port' }, 'port'],
        ['worker exit before readiness', undefined, 'startup'],
    ] as const)(
        'reports a %s and lets the user disable automatic hosting',
        async (_label, message, error) => {
            addAssets(
                join(directory, 'hosted-backend/main.cjs'),
                join(directory, 'hosted-pwa')
            );
            settings.set(HOSTED_SERVER_ENABLED, true);
            nextWorker(message);
            expect(await restoreHostedServer()).toMatchObject({
                state: 'error',
                error,
                autoStart: true,
            });
            expect(await control('stop')).toMatchObject({
                state: 'stopped',
                autoStart: false,
            });
            expect(getHostedServerAccessCode()).toBe('');
        }
    );

    it('does not start without packaged assets or with an invalid saved access code', async () => {
        expect(await control({ start: true })).toEqual({
            state: 'unavailable',
        });
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const hostedDir = join(directory, 'hosted-server');
        mkdirSync(hostedDir);
        writeFileSync(join(hostedDir, 'access-code'), 'invalid');
        expect(await control({ start: true })).toMatchObject({
            state: 'error',
            error: 'startup',
            autoStart: false,
        });
        expect(utilityProcess.fork).not.toHaveBeenCalled();
    });

    it('rejects foreign windows, child frames and unsupported commands', () => {
        expect(() =>
            invoke(
                HOSTED_SERVER_CONTROL,
                { start: true },
                { ...event, sender: { mainFrame } }
            )
        ).toThrow('Invalid hosted server request');
        expect(() =>
            invoke(HOSTED_SERVER_ACCESS_CODE, undefined, {
                ...event,
                senderFrame: {},
            })
        ).toThrow('Invalid hosted server request');
        expect(() => control('restart')).toThrow(
            'Invalid hosted server command'
        );
        expect(utilityProcess.fork).not.toHaveBeenCalled();
    });
});
