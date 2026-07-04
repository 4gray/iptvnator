/**
 * Instance reuse, process exit, and spawn-error coverage for the VLC session
 * service. Pure helpers and launch-argument construction live in
 * `vlc-session.service.spec.ts`.
 */
jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('net', () => ({
    createConnection: jest.fn(),
    createServer: jest.fn(),
}));

jest.mock('../app', () => ({
    __esModule: true,
    default: {
        mainWindow: null,
    },
}));

jest.mock('../services/store.service', () => ({
    VLC_PLAYER_ARGUMENTS: 'VLC_PLAYER_ARGUMENTS',
    VLC_PLAYER_PATH: 'VLC_PLAYER_PATH',
    VLC_REUSE_INSTANCE: 'VLC_REUSE_INSTANCE',
    store: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createConnection, createServer } from 'net';
import {
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import { externalPlayerSessions } from './external-player-runtime';
import { openVlcPlayer, shutdownVlcSession } from './vlc-session.service';

const spawnMock = spawn as unknown as jest.Mock;
const streamUrl = 'https://example.com/stream.m3u8';
const rcWrites: string[] = [];

function createMockChildProcess(): ChildProcess {
    return Object.assign(new EventEmitter(), {
        killed: false,
        kill: jest.fn(() => true),
        stderr: null,
        stdout: null,
        unref: jest.fn(),
    }) as unknown as ChildProcess;
}

async function waitForSpawnCallCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (spawnMock.mock.calls.length >= count) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Expected ${count} player spawn calls`);
}

function mockStoreValues(values: Record<string, unknown>): void {
    (store.get as unknown as jest.Mock).mockImplementation(
        (key: string, fallback?: unknown) =>
            key in values ? values[key] : fallback
    );
}

function installRcSocketMock(behavior: 'ack' | 'error'): void {
    (createConnection as unknown as jest.Mock).mockImplementation(() => {
        const socket = Object.assign(new EventEmitter(), {
            destroyed: false,
            write: jest.fn((data: string) => {
                rcWrites.push(data);
                setImmediate(() => socket.emit('data', Buffer.from('> ')));
                return true;
            }),
            destroy: jest.fn(() => {
                socket.destroyed = true;
            }),
        });
        setImmediate(() => {
            if (behavior === 'error') {
                socket.emit('error', new Error('rc connect failed'));
            } else {
                socket.emit('connect');
            }
        });
        return socket;
    });
}

async function openTrackedVlcInstance(proc: ChildProcess): Promise<void> {
    spawnMock.mockReturnValueOnce(proc);
    const openPromise = openVlcPlayer({ title: 'First', url: streamUrl });
    await waitForSpawnCallCount(1);
    proc.emit('spawn');
    await openPromise;
}

describe('vlc-session.service process lifecycle', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        rcWrites.length = 0;
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        (createServer as unknown as jest.Mock).mockImplementation(() => ({
            unref: jest.fn(),
            on: jest.fn(),
            listen: (_port: number, _host: string, cb: () => void) => cb(),
            address: () => ({ port: 43210 }),
            close: (cb?: () => void) => cb?.(),
        }));
        mockStoreValues({
            [VLC_PLAYER_PATH]: '/usr/bin/vlc',
            [VLC_REUSE_INSTANCE]: false,
        });
    });

    afterEach(() => {
        // Drop any process tracked for reuse so tests stay isolated.
        shutdownVlcSession();
        consoleErrorSpy.mockRestore();
    });

    describe('instance reuse', () => {
        beforeEach(() => {
            mockStoreValues({
                [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                [VLC_REUSE_INSTANCE]: true,
            });
        });

        it('reuses the tracked VLC instance through RC commands', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            installRcSocketMock('ack');

            const session = await openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
                referer: 'https://ref.example',
            });

            expect(spawnMock).toHaveBeenCalledTimes(1);
            expect(rcWrites).toEqual([
                'clear\n',
                'add https://example.com/two.m3u8 ' +
                    ':http-referrer=https://ref.example :meta-title=Second\n',
            ]);
            expect(session.status).toBe('opened');
        });

        it('kills the stale instance and spawns fresh when RC reuse fails', async () => {
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);
            installRcSocketMock('error');

            const freshProc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(freshProc);
            const openPromise = openVlcPlayer({
                title: 'Second',
                url: 'https://example.com/two.m3u8',
            });
            await waitForSpawnCallCount(2);
            freshProc.emit('spawn');
            const session = await openPromise;

            expect(proc.kill).toHaveBeenCalled();
            expect(session.status).toBe('opened');
        });
    });

    describe('process exit handling', () => {
        it('marks the session closed on a clean exit', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);
            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await openPromise;

            proc.emit('exit', 0);
            expect(externalPlayerSessions.getSession(session.id)?.status).toBe(
                'closed'
            );
        });

        it('marks the session as errored on an unexpected exit code', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);
            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            proc.emit('spawn');
            const session = await openPromise;

            proc.emit('exit', 2);
            const updated = externalPlayerSessions.getSession(session.id);
            expect(updated?.status).toBe('error');
            expect(updated?.error).toContain('exit code: 2');
        });

        it('retries without the RC interface when VLC exits with code 1', async () => {
            mockStoreValues({
                [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                [VLC_REUSE_INSTANCE]: true,
            });
            const proc = createMockChildProcess();
            await openTrackedVlcInstance(proc);

            const retryProc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(retryProc);
            proc.emit('exit', 1);
            await waitForSpawnCallCount(2);

            const retryArgs = spawnMock.mock.calls[1][1] as string[];
            expect(retryArgs.join(' ')).not.toContain('--extraintf');
            expect(retryArgs.join(' ')).not.toContain('--rc-host');
            // Retry processes are never tracked for reuse.
            expect(spawnMock.mock.calls[1][2]).toMatchObject({
                detached: true,
                stdio: 'ignore',
            });
            expect(retryProc.unref).toHaveBeenCalled();
        });
    });

    describe('spawn error handling', () => {
        it('rejects with an actionable error when VLC fails to start', async () => {
            const proc = createMockChildProcess();
            spawnMock.mockReturnValueOnce(proc);
            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            const sessionId = externalPlayerSessions.getActiveSessionId();
            await waitForSpawnCallCount(1);

            proc.emit('error', new Error('boom'));

            await expect(openPromise).rejects.toThrow(
                "Failed to start VLC player: boom. Make sure VLC is installed and the path '/usr/bin/vlc' is correct."
            );
            expect(
                externalPlayerSessions.getSession(sessionId as string)?.status
            ).toBe('error');
        });

        it('retries without the RC interface after a start error', async () => {
            mockStoreValues({
                [VLC_PLAYER_PATH]: '/usr/bin/vlc',
                [VLC_REUSE_INSTANCE]: true,
            });
            const proc = createMockChildProcess();
            const retryProc = createMockChildProcess();
            spawnMock
                .mockReturnValueOnce(proc)
                .mockReturnValueOnce(retryProc);

            const openPromise = openVlcPlayer({ title: 'S', url: streamUrl });
            await waitForSpawnCallCount(1);
            proc.emit('error', new Error('rc unsupported'));
            await waitForSpawnCallCount(2);

            const retryArgs = spawnMock.mock.calls[1][1] as string[];
            expect(retryArgs.join(' ')).not.toContain('--extraintf');
            retryProc.emit('spawn');
            const session = await openPromise;
            expect(session.status).toBe('opened');
        });
    });
});
