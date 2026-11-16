import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { app, ipcMain, safeStorage } from 'electron';
import { getIptvnatorDataRoot } from '@iptvnator/shared/database/path-utils';
import { HOSTED_CLOUDFLARE_CONTROL } from '@iptvnator/shared/interfaces';
import {
    registerHostedCloudflareEvents,
    shutdownHostedCloudflare,
    stopHostedCloudflare,
} from './hosted-cloudflare.service';

jest.mock('electron', () => ({
    app: { isPackaged: true },
    ipcMain: { handle: jest.fn() },
    safeStorage: {
        isEncryptionAvailable: jest.fn(() => true),
        getSelectedStorageBackend: jest.fn(() => 'kwallet'),
        encryptString: jest.fn((s: string) => Buffer.from(`encrypted:${s}`)),
        decryptString: jest.fn((b: Buffer) =>
            b.toString().replace('encrypted:', '')
        ),
    },
}));
jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
jest.mock('@iptvnator/shared/database/path-utils', () => ({
    getIptvnatorDataRoot: jest.fn(),
}));
// The executable availability check is independent of the credential file.
jest.mock('node:fs', () => ({
    ...jest.requireActual('node:fs'),
    existsSync: jest.fn((p: string) =>
        p.includes('cloudflared')
            ? true
            : jest.requireActual('node:fs').existsSync(p)
    ),
}));

describe('hosted Cloudflare connector', () => {
    let dir: string;
    let ingress: boolean;
    const frame = {};
    const sender = { mainFrame: frame };
    const event = { sender, senderFrame: frame };
    const token = 'synthetic_test_token_123456';
    const invoke = (command: unknown, context = event) => {
        const handler = jest
            .mocked(ipcMain.handle)
            .mock.calls.find(
                ([channel]) => channel === HOSTED_CLOUDFLARE_CONTROL
            )![1];
        return handler(context as never, command);
    };
    beforeEach(() => {
        Object.defineProperty(process, 'resourcesPath', {
            value: tmpdir(),
            configurable: true,
        });
        dir = mkdtempSync(join(tmpdir(), 'iptv-connector-'));
        jest.mocked(getIptvnatorDataRoot).mockReturnValue(dir);
        jest.mocked(ipcMain.handle).mockClear();
        jest.mocked(spawn).mockReset();
        jest.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
        ingress = true;
        registerHostedCloudflareEvents(
            () => ({ webContents: sender }) as never,
            () => ingress,
            (operation) => Promise.resolve().then(operation)
        );
    });
    afterEach(() => {
        stopHostedCloudflare();
        rmSync(dir, { recursive: true, force: true });
    });
    it('rejects untrusted frames and missing ingress', async () => {
        expect(() => invoke('status', { sender, senderFrame: {} })).toThrow();
        ingress = false;
        await expect(invoke({ start: true, token })).rejects.toThrow('ingress');
        expect(spawn).not.toHaveBeenCalled();
    });
    it('encrypts the token, keeps it out of arguments, and stops on request', async () => {
        const processChild = Object.assign(new EventEmitter(), {
            kill: jest.fn(),
        });
        jest.mocked(spawn).mockImplementationOnce(() => {
            queueMicrotask(() => processChild.emit('spawn'));
            return processChild as never;
        });
        process.env.TUNNEL_LOGFILE = 'synthetic-log';
        process.env.TUNNEL_LOGLEVEL = 'debug';
        process.env.TUNNEL_TOKEN_FILE = 'synthetic-token-file';
        const result = await invoke({ start: true, token });
        delete process.env.TUNNEL_LOGFILE;
        delete process.env.TUNNEL_LOGLEVEL;
        delete process.env.TUNNEL_TOKEN_FILE;
        expect(result).toMatchObject({ state: 'running', savedToken: true });
        const [, args, options] = jest.mocked(spawn).mock.calls.at(-1)!;
        expect(args).toEqual([
            'tunnel',
            '--config',
            join(dir, 'hosted-server', 'cloudflare-config.yml'),
            '--no-autoupdate',
            'run',
        ]);
        expect(
            readFileSync(
                join(dir, 'hosted-server', 'cloudflare-config.yml'),
                'utf8'
            )
        ).toBe('{}\n');
        expect(options?.env).not.toHaveProperty('TUNNEL_LOGFILE');
        expect(options?.env).not.toHaveProperty('TUNNEL_LOGLEVEL');
        expect(options?.env).not.toHaveProperty('TUNNEL_TOKEN_FILE');
        expect(options).toMatchObject({
            env: { TUNNEL_TOKEN: token },
            stdio: 'ignore',
            windowsHide: true,
        });
        expect(
            readFileSync(
                join(dir, 'hosted-server', 'cloudflare-token.enc'),
                'utf8'
            )
        ).toBe(`encrypted:${token}`);
        expect(await invoke('stop')).toMatchObject({ state: 'stopping' });
        processChild.emit('exit', 0);
        expect(await invoke('status')).toMatchObject({ state: 'stopped' });
        expect(await invoke('forget')).toMatchObject({ savedToken: false });
    });
    it('refuses credential storage when encryption is unavailable', async () => {
        jest.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
        await expect(invoke({ start: true, token })).rejects.toThrow(
            'Secure credential'
        );
    });
    it('clears an old process error when stopped', async () => {
        const processChild = Object.assign(new EventEmitter(), {
            kill: jest.fn(),
        });
        jest.mocked(spawn).mockImplementationOnce(() => {
            queueMicrotask(() =>
                processChild.emit('error', new Error('synthetic failure'))
            );
            return processChild as never;
        });
        expect(await invoke({ start: true, token })).toMatchObject({
            state: 'error',
        });
        expect(await invoke('stop')).toMatchObject({ state: 'stopped' });
    });
    it('reports a missing bundled executable', async () => {
        const packaging = jest.replaceProperty(app, 'isPackaged', false);
        try {
            expect(await invoke('status')).toMatchObject({ state: 'unavailable' });
            await expect(invoke({ start: true, token })).rejects.toThrow(
                'unavailable'
            );
        } finally {
            packaging.restore();
        }
    });

    it('reuses encrypted credentials and waits for the connector to close on shutdown', async () => {
        const child = Object.assign(new EventEmitter(), { kill: jest.fn() });
        jest.mocked(spawn).mockImplementation(() => {
            queueMicrotask(() => child.emit('spawn'));
            return child as never;
        });
        await expect(invoke({ start: true })).rejects.toThrow(
            'Saved tunnel token'
        );
        await expect(invoke({ start: true, token: 123 })).rejects.toThrow(
            'Invalid tunnel token'
        );
        await expect(invoke({ start: true, token: 'short' })).rejects.toThrow(
            'Invalid tunnel token'
        );
        await expect(invoke('unknown')).rejects.toThrow(
            'Invalid connector command'
        );
        await invoke({ start: true, token });
        await expect(invoke('forget')).rejects.toThrow(
            'Stop the connector first'
        );
        await expect(invoke({ start: true })).rejects.toThrow(
            'already running'
        );
        const shutdown = shutdownHostedCloudflare();
        expect(child.kill).toHaveBeenCalledTimes(1);
        child.emit('exit', 0);
        child.emit('close', 0);
        await expect(shutdown).resolves.toBeUndefined();

        await invoke({ start: true });
        expect(safeStorage.decryptString).toHaveBeenCalledWith(
            Buffer.from(`encrypted:${token}`)
        );
        expect(jest.mocked(spawn).mock.lastCall?.[2]).toMatchObject({
            env: { TUNNEL_TOKEN: token },
        });
        child.emit('exit', 1);
        expect(await invoke('status')).toMatchObject({ state: 'error' });
        await expect(shutdownHostedCloudflare()).resolves.toBeUndefined();
    });

    it('reports a synchronous spawn failure without leaving an active connector', async () => {
        jest.mocked(spawn).mockImplementationOnce(() => {
            throw new Error('synthetic spawn failure');
        });
        await expect(invoke({ start: true, token })).resolves.toMatchObject({
            state: 'error',
        });
        await expect(invoke('forget')).resolves.toMatchObject({
            savedToken: false,
        });
    });
});
