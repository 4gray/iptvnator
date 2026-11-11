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
        jest.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
        ingress = true;
        registerHostedCloudflareEvents(
            () => ({ webContents: sender }) as never,
            () => ingress
        );
    });
    afterEach(() => {
        stopHostedCloudflare();
        rmSync(dir, { recursive: true, force: true });
    });
    it('rejects untrusted frames and missing ingress', () => {
        expect(() => invoke('status', { sender, senderFrame: {} })).toThrow();
        ingress = false;
        expect(() => invoke({ start: true, token })).toThrow('ingress');
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
        const result = await invoke({ start: true, token });
        expect(result).toMatchObject({ state: 'running', savedToken: true });
        const [, args, options] = jest.mocked(spawn).mock.calls.at(-1)!;
        expect(args).toEqual(['tunnel', '--no-autoupdate', 'run']);
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
        expect(invoke('stop')).toMatchObject({ state: 'stopping' });
        processChild.emit('exit', 0);
        expect(invoke('status')).toMatchObject({ state: 'stopped' });
        expect(invoke('forget')).toMatchObject({ savedToken: false });
    });
    it('refuses credential storage when encryption is unavailable', () => {
        jest.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
        expect(() => invoke({ start: true, token })).toThrow(
            'Secure credential'
        );
    });
    it('reports a missing bundled executable', () => {
        jest.mocked(app).isPackaged = false;
        expect(invoke('status')).toMatchObject({ state: 'unavailable' });
        expect(() => invoke({ start: true, token })).toThrow('unavailable');
        jest.mocked(app).isPackaged = true;
    });
});
