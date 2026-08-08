jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

// Passthrough by default (the VLC specs bind a real ephemeral port via
// createServer); individual tests override createConnection to capture the
// JSON IPC traffic of a reused mpv instance.
jest.mock('net', () => ({
    ...jest.requireActual('net'),
    createConnection: jest.fn((...args: unknown[]) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        jest.requireActual('net').createConnection(...(args as [any]))
    ),
}));

jest.mock('../app', () => ({
    __esModule: true,
    default: {
        mainWindow: null,
    },
}));

jest.mock('../services/store.service', () => ({
    MPV_PLAYER_ARGUMENTS: 'MPV_PLAYER_ARGUMENTS',
    MPV_PLAYER_PATH: 'MPV_PLAYER_PATH',
    MPV_REUSE_INSTANCE: 'MPV_REUSE_INSTANCE',
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
import { createConnection } from 'net';
import {
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import { externalPlayerSessions } from './external-player-runtime';
import { openMpvPlayer, shutdownMpvSession } from './mpv-session.service';
import { openVlcPlayer, shutdownVlcSession } from './vlc-session.service';

function createMockChildProcess(): ChildProcess {
    return Object.assign(new EventEmitter(), {
        exitCode: null,
        killed: false,
        kill: jest.fn(() => true),
        signalCode: null,
        stderr: null,
        stdout: null,
        unref: jest.fn(),
    }) as unknown as ChildProcess;
}

async function waitForSpawnCallCount(count: number): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if ((spawn as unknown as jest.Mock).mock.calls.length >= count) {
            return;
        }

        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }

    throw new Error(`Expected ${count} player spawn calls`);
}

function mockStoreValues(values: Record<string, unknown>): void {
    (store.get as unknown as jest.Mock).mockImplementation(
        (key: string, fallback?: unknown) =>
            key in values ? values[key] : fallback
    );
}

describe('external player shutdown on app quit', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('kills the stored reusable MPV process on shutdown', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });

        await openMpvPlayer({
            title: 'Reusable MPV stream',
            url: 'https://example.com/live.m3u8',
        });

        expect(proc.kill).not.toHaveBeenCalled();

        shutdownMpvSession();

        expect(proc.kill).toHaveBeenCalledTimes(1);

        // The stored process reference is cleared, so a second shutdown
        // must not attempt another kill.
        shutdownMpvSession();
        expect(proc.kill).toHaveBeenCalledTimes(1);
    });

    it('escapes commas in http header fields passed to mpv', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: false,
        });

        await openMpvPlayer({
            title: 'Stalker live stream',
            url: 'https://portal.example/ch/1234',
            headers: {
                'X-User-Agent':
                    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
            },
        });

        const args = (spawn as unknown as jest.Mock).mock
            .calls[0][1] as string[];
        const headerArg = args.find((arg) =>
            arg.startsWith('--http-header-fields=')
        );

        // mpv parses the option as a comma-separated list; the comma inside
        // the MAG user agent must arrive escaped or the header is truncated
        // and Stalker portals reject the stream with HTTP 400.
        expect(headerArg).toContain('(KHTML\\, like Gecko) MAG250');
        expect(headerArg).not.toContain('(KHTML, like Gecko)');
    });

    it('escapes commas in http header fields on the reused-instance IPC path', async () => {
        // Reset any reusable instance a previous test may have left behind so
        // the first launch below spawns rather than reuses.
        shutdownMpvSession();

        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: true,
        });

        // First launch spawns the reusable instance and records its IPC socket.
        await openMpvPlayer({
            title: 'First stream',
            url: 'https://portal.example/ch/1',
        });

        // Capture the JSON IPC traffic of the second, reused launch.
        const written: string[] = [];
        (createConnection as unknown as jest.Mock).mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                write: jest.fn((chunk: string) => written.push(chunk)),
                end: jest.fn(),
                destroy: jest.fn(),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        });

        await openMpvPlayer({
            title: 'Stalker live stream',
            url: 'https://portal.example/ch/1234',
            headers: {
                'X-User-Agent':
                    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
            },
        });

        const commands = written.map(
            (chunk) =>
                JSON.parse(chunk.trim()).command as Array<string | number>
        );
        const setHeaderFields = commands.find(
            (command) =>
                command[0] === 'set_property' &&
                command[1] === 'http-header-fields'
        );

        // The value must survive the JSON IPC transport with the mpv escape
        // intact: mpv re-parses the property as a comma-separated stringlist
        // on its side, so an unescaped comma truncates the MAG user agent.
        expect(setHeaderFields).toBeDefined();
        expect(setHeaderFields?.[2]).toContain('(KHTML\\, like Gecko) MAG250');
        expect(setHeaderFields?.[2]).not.toContain('(KHTML, like Gecko)');

        shutdownMpvSession();
    });

    it('does not track non-reusable MPV processes for shutdown', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: false,
        });

        await openMpvPlayer({
            title: 'Detached MPV stream',
            url: 'https://example.com/live.m3u8',
        });

        expect(proc.unref).toHaveBeenCalled();

        shutdownMpvSession();

        expect(proc.kill).not.toHaveBeenCalled();
    });

    it('waits for a detached MPV process to exit before closing its session', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: false,
        });
        const session = await openMpvPlayer({
            title: 'Detached MPV stream',
            url: 'https://example.com/live.m3u8',
        });

        let closeSettled = false;
        const closePromise = externalPlayerSessions
            .closeSession(session.id)
            .then((closed) => {
                closeSettled = true;
                return closed;
            });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(proc.kill).toHaveBeenCalledTimes(1);
        expect(closeSettled).toBe(false);

        Object.defineProperty(proc, 'exitCode', { value: 0 });
        proc.emit('exit', 0);

        await expect(closePromise).resolves.toMatchObject({
            id: session.id,
            status: 'closed',
        });
    });

    it('kills the stored reusable VLC process on shutdown', async () => {
        const proc = createMockChildProcess();
        (spawn as unknown as jest.Mock).mockReturnValue(proc);
        mockStoreValues({
            [VLC_PLAYER_PATH]: '/usr/bin/vlc',
            [VLC_REUSE_INSTANCE]: true,
        });

        const openPromise = openVlcPlayer({
            title: 'Reusable VLC stream',
            url: 'https://example.com/live.m3u8',
        });

        await waitForSpawnCallCount(1);
        proc.emit('spawn');
        await openPromise;

        expect(proc.kill).not.toHaveBeenCalled();

        shutdownVlcSession();

        expect(proc.kill).toHaveBeenCalledTimes(1);

        shutdownVlcSession();
        expect(proc.kill).toHaveBeenCalledTimes(1);
    });
});
