/**
 * Position polling of external players must not outlive the player. Both
 * services wait before the first poll so the player can open its control
 * channel; a player that exits during that wait must not leave an interval
 * polling a dead socket or port for the rest of the app session.
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
import { createConnection, createServer } from 'net';
import type { PlayerContentInfo } from '@iptvnator/shared/interfaces';
import {
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import { openMpvPlayer } from './mpv-session.service';
import { openVlcPlayer } from './vlc-session.service';

const spawnMock = spawn as unknown as jest.Mock;
const createConnectionMock = createConnection as unknown as jest.Mock;
const contentInfo: PlayerContentInfo = {
    playlistId: 'playlist-1',
    contentXtreamId: 7,
    contentType: 'vod',
};

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

function exitProcess(proc: ChildProcess): void {
    Object.defineProperty(proc, 'exitCode', { value: 0 });
    proc.emit('exit', 0);
}

/** A control connection that never answers; each poll just records itself. */
function installSilentConnection(): void {
    createConnectionMock.mockImplementation(() =>
        Object.assign(new EventEmitter(), {
            destroyed: false,
            destroy: jest.fn(),
            end: jest.fn(),
            setEncoding: jest.fn(),
            write: jest.fn(() => true),
        })
    );
}

function mockStoreValues(values: Record<string, unknown>): void {
    (store.get as unknown as jest.Mock).mockImplementation(
        (key: string, fallback?: unknown) =>
            key in values ? values[key] : fallback
    );
}

async function openMpv(): Promise<ChildProcess> {
    const proc = createMockChildProcess();
    spawnMock.mockReturnValueOnce(proc);
    const opening = openMpvPlayer({
        title: 'Movie',
        url: 'https://example.com/movie.mp4',
        contentInfo,
    });
    await jest.advanceTimersByTimeAsync(100);
    await opening;
    return proc;
}

async function openVlc(): Promise<ChildProcess> {
    const proc = createMockChildProcess();
    spawnMock.mockReturnValueOnce(proc);
    const opening = openVlcPlayer({
        title: 'Movie',
        url: 'https://example.com/movie.mp4',
        contentInfo,
    });
    while (spawnMock.mock.calls.length === 0) {
        await jest.advanceTimersByTimeAsync(0);
    }
    proc.emit('spawn');
    await opening;
    return proc;
}

describe('external player position polling lifetime', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation();
        installSilentConnection();
        (createServer as unknown as jest.Mock).mockImplementation(() => ({
            unref: jest.fn(),
            on: jest.fn(),
            listen: (_port: number, _host: string, cb: () => void) => cb(),
            address: () => ({ port: 43210 }),
            close: (cb?: () => void) => cb?.(),
        }));
        mockStoreValues({
            [MPV_PLAYER_PATH]: '/usr/bin/mpv',
            [MPV_REUSE_INSTANCE]: false,
            [VLC_PLAYER_PATH]: '/usr/bin/vlc',
            [VLC_REUSE_INSTANCE]: false,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('polls MPV once the start delay has passed', async () => {
        const proc = await openMpv();
        createConnectionMock.mockClear();

        await jest.advanceTimersByTimeAsync(7_000);

        expect(createConnectionMock).toHaveBeenCalled();
        exitProcess(proc);
    });

    it('never polls MPV when it exits before the first poll', async () => {
        const proc = await openMpv();
        exitProcess(proc);
        createConnectionMock.mockClear();

        await jest.advanceTimersByTimeAsync(30_000);

        expect(createConnectionMock).not.toHaveBeenCalled();
    });

    it('polls VLC once the start delay has passed', async () => {
        const proc = await openVlc();
        createConnectionMock.mockClear();

        await jest.advanceTimersByTimeAsync(4_000);

        expect(createConnectionMock).toHaveBeenCalledWith(
            expect.objectContaining({ port: 43210 })
        );
        exitProcess(proc);
    });

    it('never polls VLC when it exits before the first poll', async () => {
        const proc = await openVlc();
        exitProcess(proc);
        createConnectionMock.mockClear();

        await jest.advanceTimersByTimeAsync(30_000);

        expect(createConnectionMock).not.toHaveBeenCalled();
    });
});
