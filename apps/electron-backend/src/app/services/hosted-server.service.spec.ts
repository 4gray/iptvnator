import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { app, ipcMain, utilityProcess, type BrowserWindow } from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import {
    HOSTED_CLOUDFLARE_CONTROL,
    HOSTED_DEVICE_CONTROL,
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
import * as cloudflare from './hosted-cloudflare.service';
import {
    HOSTED_SERVER_ENABLED,
    HOSTED_SERVER_CONFIGURATIONS,
    HOSTED_SERVER_INSTANCE_ID,
    HOSTED_SERVER_LAN_ADDRESS,
    HOSTED_SERVER_MODE,
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
    HOSTED_SERVER_CONFIGURATIONS: 'HOSTED_SERVER_CONFIGURATIONS',
    HOSTED_SERVER_INSTANCE_ID: 'HOSTED_SERVER_INSTANCE_ID',
    HOSTED_SERVER_LAN_ADDRESS: 'HOSTED_SERVER_LAN_ADDRESS',
    HOSTED_SERVER_MODE: 'HOSTED_SERVER_MODE',
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
            postMessage: jest.fn<void, [unknown]>(() =>
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

    it('leaves a retired proxy stopped and keeps saved profiles for a manual restart', async () => {
        addAssets(join(directory, 'hosted-backend/main.cjs'), join(directory, 'hosted-pwa'));
        const proxy = {
            mode: 'proxy',
            origin: 'https://retired.example.test',
            address: '',
            certificatePath: '',
            keyPath: '',
        };
        const https = {
            mode: 'https',
            origin: 'https://library.example.test',
            address: lanAddress,
            certificatePath: join(directory, 'certificate.pem'),
            keyPath: join(directory, 'key.pem'),
        };
        settings.set(HOSTED_SERVER_ENABLED, true);
        settings.set(HOSTED_SERVER_MODE, proxy);
        settings.set(HOSTED_SERVER_CONFIGURATIONS, { https });
        expect(await restoreHostedServer()).toMatchObject({
            state: 'stopped',
            autoStart: false,
            savedConfigurations: { https },
        });
        expect(utilityProcess.fork).not.toHaveBeenCalled();
        expect(() => control({ start: true, configuration: proxy })).toThrow(
            'Invalid hosted server mode'
        );
        nextWorker(ready);
        expect(await control({ start: true, configuration: https })).toMatchObject({
            state: 'running',
            endpoint: https.origin,
            configuration: https,
        });
    });

    it.each(['open', 'paired', 'legacy-address'])(
        'restores a missing %s Home network interface on loopback and remembers it for the next launch',
        async (access) => {
            addAssets(
                join(directory, 'hosted-backend/main.cjs'),
                join(directory, 'hosted-pwa')
            );
            const address = '10.0.0.24';
            const paired = { mode: 'lan', address, access: 'paired' };
            const https = {
                mode: 'https',
                address: '',
                origin: 'https://library.example.test',
                certificatePath: join(directory, 'cert.pem'),
                keyPath: join(directory, 'key.pem'),
            };
            settings.set(HOSTED_SERVER_LAN_ADDRESS, address);
            settings.set(HOSTED_SERVER_CONFIGURATIONS, { https });
            if (access !== 'legacy-address')
                settings.set(HOSTED_SERVER_MODE, { ...paired, access });

            nextWorker(ready);
            expect(await restoreHostedServer()).toMatchObject({
                state: 'running',
                localUrl,
                endpoint: undefined,
                lanUrl: undefined,
                lanAddress: address,
                configuration: paired,
                savedConfigurations: { lan: paired, https },
            });
            const workerEnvironment = () =>
                jest.mocked(utilityProcess.fork).mock.lastCall?.[2]?.env;
            expect(workerEnvironment()).toMatchObject({
                IPTVNATOR_HOSTED_LAN: '',
                IPTVNATOR_HOSTED_MODE: JSON.stringify({
                    ...paired,
                    address: '',
                }),
            });
            expect(() =>
                control({ start: true, configuration: paired })
            ).toThrow('Invalid Home network');
            await stopHostedServerForRestart();

            jest.mocked(networkInterfaces).mockReturnValue({
                fixture: [
                    {
                        family: 'IPv4',
                        internal: false,
                        address,
                        cidr: address + '/24',
                        mac: '00:00:00:00:00:00',
                        netmask: '255.255.255.0',
                    },
                ],
            });
            nextWorker(ready);
            expect(await restoreHostedServer()).toMatchObject({
                state: 'running',
                endpoint: `http://${address}:${HOSTED_SERVER_PORT}`,
                savedConfigurations: { lan: paired, https },
            });
            expect(workerEnvironment()).toMatchObject({
                IPTVNATOR_HOSTED_LAN: address,
                IPTVNATOR_HOSTED_MODE: JSON.stringify(paired),
            });
        }
    );

    it.each(['10.256.0.1', '203.0.113.18'])(
        'refuses a saved LAN profile with invalid private address %s',
        async (address) => {
            addAssets(
                join(directory, 'hosted-backend/main.cjs'),
                join(directory, 'hosted-pwa')
            );
            settings.set(HOSTED_SERVER_MODE, {
                mode: 'lan',
                address,
                access: 'open',
            });
            expect(await restoreHostedServer()).toMatchObject({
                state: 'error',
                error: 'startup',
            });
            expect(utilityProcess.fork).not.toHaveBeenCalled();
        }
    );

    it('keeps separate mode profiles and the legacy LAN address across starts and restore', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {
            status: 401,
            headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://tunnel.example.test"' },
        }));
        const lan = { mode: 'lan', address: lanAddress, access: 'paired' };
        const tunnel = {
            mode: 'cloudflare',
            origin: 'https://tunnel.example.test',
            team: 'example-team',
            audience: 'a'.repeat(64),
            managed: false,
            certificatePath: '',
            keyPath: '',
        };
        const https = {
            mode: 'https',
            address: '',
            origin: 'https://custom.example.test',
            certificatePath: join(directory, 'cert.pem'),
            keyPath: join(directory, 'key.pem'),
        };

        settings.set(HOSTED_SERVER_MODE, lan);
        settings.set(HOSTED_SERVER_LAN_ADDRESS, lanAddress);
        nextWorker(ready);
        expect(await control({ start: true, configuration: tunnel })).toMatchObject({
            configuration: tunnel,
            lanAddress,
            savedConfigurations: { lan, cloudflare: tunnel },
        });
        nextWorker(ready);
        expect(await control({ start: true, configuration: https })).toMatchObject({
            configuration: https,
            lanAddress,
            savedConfigurations: { lan, cloudflare: tunnel, https },
        });
        expect(settings.get(HOSTED_SERVER_CONFIGURATIONS)).toEqual({ lan, cloudflare: tunnel, https });

        await stopHostedServerForRestart();
        nextWorker(ready);
        expect(await restoreHostedServer()).toMatchObject({
            state: 'running',
            mode: 'https',
            configuration: https,
            savedConfigurations: { lan, cloudflare: tunnel, https },
        });
    });

    it('stops a worker when its managed tunnel fails to start and can retry', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const configuration = {
            mode: 'cloudflare',
            origin: 'https://tunnel.example.test',
            team: 'example-team',
            audience: 'a'.repeat(64),
            managed: true,
            certificatePath: '',
            keyPath: '',
        };
        const connectorToken = 'synthetic_token_example';
        const connector = jest.spyOn(cloudflare, 'startHostedCloudflare');
        connector.mockResolvedValueOnce({
            state: 'error',
            savedToken: true,
            secureStorage: true,
        });
        connector.mockResolvedValueOnce({
            state: 'running',
            savedToken: true,
            secureStorage: true,
        });
        jest.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(null, { status: 403 })
        );
        const failedWorker = nextWorker(ready);
        const start = { start: true, configuration, connectorToken };
        expect(await control(start)).toMatchObject({
            state: 'error',
            error: 'connector',
        });
        expect(failedWorker.kill).toHaveBeenCalledTimes(1);
        expect(settings.get(HOSTED_SERVER_ENABLED)).toBeUndefined();
        expect(getHostedServerAccessCode()).toBe('');

        nextWorker(ready);
        expect(await control(start)).toMatchObject({
            state: 'running',
            endpoint: configuration.origin,
        });
        expect(connector.mock.calls).toEqual([
            [connectorToken],
            [connectorToken],
        ]);
        expect(settings.get(HOSTED_SERVER_MODE)).toEqual(configuration);
        expect(settings.get(HOSTED_SERVER_ENABLED)).toBe(true);
        expect(() => invoke(HOSTED_SERVER_ACCESS_CODE)).toThrow(
            'Server access code is unavailable'
        );
    });

    it('uses guarded loopback IPC for device pairing and management', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const fetchMock = jest.spyOn(globalThis, 'fetch');
        const invite = () =>
            invoke(HOSTED_DEVICE_CONTROL, { action: 'invite' });
        await expect(invite()).rejects.toThrow('Hosted server is unavailable');
        nextWorker(ready);
        await control({ start: true });
        await expect(invite()).rejects.toThrow('Hosted sharing is unavailable');
        expect(fetchMock).not.toHaveBeenCalled();
        await control('stop');
        nextWorker(ready);
        await control({ start: true, lanAddress });
        expect(() =>
            invoke(
                HOSTED_DEVICE_CONTROL,
                { action: 'list' },
                {
                    ...event,
                    senderFrame: {},
                }
            )
        ).toThrow('Invalid hosted server request');

        const inviteId = 'a'.repeat(43);
        const claimId = 'b'.repeat(43);
        const deviceId = '00000000-0000-4000-8000-000000000000';
        const expiresAt = '2030-01-01T12:00:00.000Z';
        const pending = {
            claimId,
            inviteId,
            name: 'Synthetic phone',
            confirmationCode: '012345',
        };
        const device = {
            id: deviceId,
            name: 'Synthetic tablet',
            canApprove: true,
        };
        fetchMock.mockResolvedValueOnce(Response.json({ inviteId, expiresAt }));
        fetchMock.mockResolvedValueOnce(
            Response.json({
                pending: [{ ...pending, claimSecret: 'synthetic-secret' }],
                devices: [{ ...device, token: 'synthetic-token' }],
            })
        );
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

        await expect(invite()).resolves.toEqual({
            url: `${lanUrl}/pair-device#${inviteId}`,
            expiresAt,
        });
        await expect(
            invoke(HOSTED_DEVICE_CONTROL, { action: 'list' })
        ).resolves.toEqual({ pending: [pending], devices: [device] });
        await expect(
            invoke(HOSTED_DEVICE_CONTROL, { action: 'approve', claimId })
        ).resolves.toBeUndefined();
        await expect(
            invoke(HOSTED_DEVICE_CONTROL, {
                action: 'set-device-approval',
                deviceId,
                canApprove: false,
            })
        ).resolves.toBeUndefined();
        await expect(
            invoke(HOSTED_DEVICE_CONTROL, { action: 'revoke', deviceId })
        ).resolves.toBeUndefined();
        await expect(
            invoke(HOSTED_DEVICE_CONTROL, {
                action: 'revoke',
                deviceId: '../devices',
            })
        ).rejects.toThrow('Invalid hosted device ID');
        await expect(
            invoke(HOSTED_DEVICE_CONTROL, {
                action: 'set-device-approval',
                deviceId,
                canApprove: 'false',
            })
        ).rejects.toThrow('Invalid hosted device approval setting');
        expect(
            fetchMock.mock.calls.map(([url, options]) => [
                url,
                options?.method,
                options?.body,
            ])
        ).toEqual([
            [`${localUrl}/api/v1/device-pairing/invite`, 'POST', undefined],
            [`${localUrl}/api/v1/devices`, undefined, undefined],
            [
                `${localUrl}/api/v1/device-pairing/approve`,
                'POST',
                JSON.stringify({ claimId }),
            ],
            [
                `${localUrl}/api/v1/devices/${deviceId}/approval`,
                'PUT',
                JSON.stringify({ canApprove: false }),
            ],
            [`${localUrl}/api/v1/devices/${deviceId}`, 'DELETE', undefined],
        ]);
        for (const [, options] of fetchMock.mock.calls) {
            expect(options).toMatchObject({
                headers: {
                    Authorization: `Bearer ${getHostedServerAccessCode()}`,
                },
                redirect: 'error',
            });
        }
    });

    it('keeps phone approval password management on guarded loopback IPC', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const worker = nextWorker(ready);
        await control({ start: true });
        const fetchMock = jest.spyOn(globalThis, 'fetch');
        const read = () =>
            invoke(HOSTED_DEVICE_CONTROL, { action: 'browser-settings' });
        const set = (password: unknown) =>
            invoke(HOSTED_DEVICE_CONTROL, {
                action: 'set-browser-password',
                password,
            });
        await expect(set('synthetic-passphrase')).rejects.toThrow(
            'Hosted HTTPS access is unavailable'
        );
        worker.postMessage.mockImplementation(
            (command?: { requestId: string; httpsOrigin: string }) => {
                if (typeof command === 'object' && command)
                    queueMicrotask(() =>
                        worker.emit('message', {
                            https: true,
                            requestId: command.requestId,
                            origin: command.httpsOrigin,
                        })
                    );
                else queueMicrotask(() => worker.emit('exit', 0));
            }
        );
        await control({ httpsOrigin: 'https://library.example.test' });
        for (const invalid of ['a'.repeat(11), 'a'.repeat(129), undefined]) {
            await expect(set(invalid)).rejects.toThrow(
                'Invalid hosted pairing password'
            );
        }
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValueOnce(
            Response.json({ passwordConfigured: true, secret: 'synthetic' })
        );
        await expect(read()).resolves.toEqual({ passwordConfigured: true });
        for (const password of ['synthetic-passphrase', null]) {
            fetchMock.mockResolvedValueOnce(
                new Response(null, { status: 204 })
            );
            await expect(set(password)).resolves.toBeUndefined();
            expect(fetchMock).toHaveBeenLastCalledWith(
                `${localUrl}/api/v1/device-pairing/browser-settings`,
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ password }),
                    headers: expect.objectContaining({
                        Authorization: `Bearer ${getHostedServerAccessCode()}`,
                    }),
                    redirect: 'error',
                })
            );
        }
    });

    it('inherits the parent environment and overrides hosted server settings', async () => {
        jest.replaceProperty(process, 'env', {
            SystemRoot: 'C:\\SyntheticWindows',
            PATH: 'C:\\SyntheticWindows\\System32',
            TEMP: directory,
            IPTVNATOR_STORAGE: 'local',
            IPTVNATOR_DATA_DIR: 'parent-data',
            IPTVNATOR_E2E_DATA_DIR: directory,
            IPTVNATOR_SOURCE_PROFILE: 'a'.repeat(64),
            IPTVNATOR_ACCESS_TOKEN: 'parent-token',
            IPTVNATOR_HOSTED_ASSETS: 'parent-assets',
            IPTVNATOR_HOSTED_LAN: '192.168.40.99',
            PORT: '9999',
        });
        const parentEnvironment = { ...process.env };
        const entry = join(directory, 'hosted-backend/main.cjs');
        const assets = join(directory, 'hosted-pwa');
        addAssets(entry, assets);
        nextWorker(ready);

        expect(await control({ start: true })).toMatchObject({
            state: 'running',
        });
        expect(utilityProcess.fork).toHaveBeenCalledWith(
            entry,
            [],
            expect.objectContaining({
                env: {
                    ...parentEnvironment,
                    IPTVNATOR_STORAGE: 'server',
                    IPTVNATOR_DATA_DIR: join(directory, 'hosted-server'),
                    IPTVNATOR_E2E_DATA_DIR: '',
                    IPTVNATOR_SOURCE_PROFILE: '',
                    IPTVNATOR_ACCESS_TOKEN: invoke(HOSTED_SERVER_ACCESS_CODE),
                    IPTVNATOR_HOSTED_ASSETS: assets,
                    IPTVNATOR_HOSTED_LAN: '',
                    IPTVNATOR_HOSTED_MODE: '',
                    PORT: String(HOSTED_SERVER_PORT),
                },
            })
        );
        expect(process.env).toEqual(parentEnvironment);
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
        expect(settings.get(HOSTED_SERVER_MODE)).toEqual({
            mode: 'lan',
            address: '',
            access: 'paired',
        });
        expect(settings.get(HOSTED_SERVER_INSTANCE_ID)).toBe(ready.instanceId);
        expect(getHostedServerAccessCode()).toBe(code);
        expect(() => invoke(HOSTED_SERVER_ACCESS_CODE)).toThrow(
            'Server access code is unavailable'
        );
        expect(await control('stop')).toMatchObject({
            state: 'stopped',
            autoStart: false,
        });
        expect(() => invoke(HOSTED_SERVER_ACCESS_CODE)).toThrow(
            'Server access code is unavailable'
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

    it('restarts a local-only worker on the selected LAN address and preserves its access code', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const firstWorker = nextWorker(ready);
        await control({ start: true });
        const code = invoke(HOSTED_SERVER_ACCESS_CODE);
        nextWorker(ready);

        const status = await control({ restart: true, lanAddress });

        expect(status).toMatchObject({
            state: 'running',
            localUrl,
            lanUrl,
            lanAddress,
            autoStart: true,
        });
        expect(firstWorker.postMessage).toHaveBeenCalledWith('stop');
        expect(utilityProcess.fork).toHaveBeenCalledTimes(2);
        expect(utilityProcess.fork).toHaveBeenLastCalledWith(
            expect.any(String),
            [],
            expect.objectContaining({
                env: expect.objectContaining({
                    IPTVNATOR_HOSTED_LAN: lanAddress,
                    IPTVNATOR_ACCESS_TOKEN: code,
                }),
            })
        );
        expect(settings.get(HOSTED_SERVER_LAN_ADDRESS)).toBe(lanAddress);
        expect(invoke(HOSTED_SERVER_ACCESS_CODE)).toBe(code);
    });

    it('restores the previous LAN binding when the requested address fails to start', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const replacementAddress = '192.168.40.6';
        const previousWorker = nextWorker(ready);
        await control({ start: true, lanAddress });
        jest.mocked(networkInterfaces).mockReturnValue({
            fixture: [lanAddress, replacementAddress].map((address) => ({
                address,
                family: 'IPv4',
                internal: false,
                cidr: `${address}/24`,
                netmask: '255.255.255.0',
                mac: '00:00:00:00:00:00',
            })),
        });
        nextWorker({ error: 'port' });
        nextWorker(ready);

        await expect(
            control({ restart: true, lanAddress: replacementAddress })
        ).rejects.toThrow(
            'LAN access could not be enabled; previous server settings restored'
        );

        expect(previousWorker.postMessage).toHaveBeenCalledWith('stop');
        expect(utilityProcess.fork).toHaveBeenCalledTimes(3);
        expect(settings.get(HOSTED_SERVER_LAN_ADDRESS)).toBe(lanAddress);
        expect(control('status')).toMatchObject({
            state: 'running',
            lanAddress,
            lanUrl,
        });
    });

    it('rejects LAN rebinding while HTTPS sharing is active', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const worker = nextWorker(ready);
        await control({ start: true });
        worker.postMessage.mockImplementation((command: unknown) => {
            if (
                typeof command === 'object' &&
                command &&
                'requestId' in command &&
                'httpsOrigin' in command
            )
                queueMicrotask(() =>
                    worker.emit('message', {
                        https: true,
                        requestId: command.requestId,
                        origin: command.httpsOrigin,
                    })
                );
            else queueMicrotask(() => worker.emit('exit', 0));
        });
        await control({ httpsOrigin: 'https://library.example.test' });

        await expect(control({ restart: true, lanAddress })).rejects.toThrow(
            'Stop HTTPS access before changing the LAN address'
        );
        expect(utilityProcess.fork).toHaveBeenCalledTimes(1);
        expect(worker.postMessage).not.toHaveBeenCalledWith('stop');
    });

    it('enables and stops HTTPS independently while preserving the running LAN worker and access code', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const worker = nextWorker(ready);
        await control({ start: true, lanAddress });
        const code = invoke(HOSTED_SERVER_ACCESS_CODE);
        worker.postMessage.mockImplementation((...args: unknown[]) => {
            const command = args[0] as
                { httpsOrigin: string; requestId: string } | string;
            queueMicrotask(() => {
                if (typeof command === 'string') worker.emit('exit', 0);
                else
                    worker.emit('message', {
                        https: true,
                        requestId: command.requestId,
                        origin: command.httpsOrigin,
                    });
            });
        });
        expect(
            await control({ httpsOrigin: 'https://library.example.test/' })
        ).toMatchObject({
            state: 'running',
            lanUrl,
            httpsOrigin: 'https://library.example.test',
        });
        expect(await control({ httpsOrigin: '' })).toMatchObject({
            state: 'running',
            lanUrl,
            httpsOrigin: '',
        });
        expect(utilityProcess.fork).toHaveBeenCalledTimes(1);
        expect(invoke(HOSTED_SERVER_ACCESS_CODE)).toBe(code);
        expect(() =>
            control({ httpsOrigin: 'http://library.example.test' })
        ).toThrow();
        expect(() =>
            control({
                httpsOrigin: 'https://user:password@library.example.test',
            })
        ).toThrow();
    });

    it('queues connector start behind an in-flight HTTPS shutdown', async () => {
        addAssets(
            join(directory, 'hosted-backend/main.cjs'),
            join(directory, 'hosted-pwa')
        );
        const worker = nextWorker(ready);
        await control({ start: true });
        let closeRequest:
            { httpsOrigin: string; requestId: string } | undefined;
        let closeStarted!: () => void;
        const closing = new Promise<void>((resolve) => {
            closeStarted = resolve;
        });
        worker.postMessage.mockImplementation((command: unknown) => {
            if (typeof command === 'string') {
                queueMicrotask(() => worker.emit('exit', 0));
                return;
            }
            const request = command as {
                httpsOrigin: string;
                requestId: string;
            };
            if (request.httpsOrigin) {
                queueMicrotask(() =>
                    worker.emit('message', {
                        https: true,
                        requestId: request.requestId,
                        origin: request.httpsOrigin,
                    })
                );
            } else {
                closeRequest = request;
                closeStarted();
            }
        });
        await control({ httpsOrigin: 'https://library.example.test' });
        const shutdown = control({ httpsOrigin: '' });
        await closing;
        let settled = false;
        const start = invoke(HOSTED_CLOUDFLARE_CONTROL, {
            start: true,
            token: 'synthetic_test_token_123456',
        });
        const outcome = start.then(
            () => {
                settled = true;
            },
            (error: Error) => {
                settled = true;
                return error;
            }
        );
        await Promise.resolve();
        expect(settled).toBe(false);
        worker.emit('message', {
            https: true,
            requestId: closeRequest?.requestId,
            origin: '',
        });
        await shutdown;
        expect((await outcome).message).toContain('ingress');
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
