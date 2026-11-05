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
import * as runtime from './external-player-runtime';
import * as vlcRc from './vlc-rc';
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

async function openVlc(info = contentInfo): Promise<ChildProcess> {
    const proc = createMockChildProcess();
    spawnMock.mockReturnValueOnce(proc);
    const opening = openVlcPlayer({
        title: 'Movie',
        url: 'https://example.com/movie.mp4',
        contentInfo: info,
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(proc.listenerCount('spawn')).toBeGreaterThan(0);
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
        jest.clearAllTimers();
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

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('VLC in-flight polling ownership', () => {
    const snapshot = { positionSeconds: 42, durationSeconds: 120 };
    const nextContent = { ...contentInfo, contentXtreamId: 8 };
    let processes: ChildProcess[];
    let updates: jest.SpyInstance;
    let snapshots: jest.SpyInstance;
    let states: jest.SpyInstance;

    async function open(info = contentInfo) {
        const proc = await openVlc(info);
        processes.push(proc);
        return proc;
    }

    async function expectNextSessionPolling() {
        await jest.advanceTimersByTimeAsync(3_500);
        expect(updates).toHaveBeenCalledWith(
            runtime.externalPlayerSessions.getActiveSessionId(),
            nextContent,
            snapshot
        );
    }

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        processes = [];
        snapshots = jest
            .spyOn(vlcRc, 'getVlcPlaybackSnapshot')
            .mockResolvedValue(snapshot);
        states = jest
            .spyOn(vlcRc, 'getVlcPlaybackState')
            .mockResolvedValue('stopped');
        updates = jest
            .spyOn(runtime, 'sendPlaybackPositionUpdate')
            .mockImplementation();
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
        processes.forEach(exitProcess);
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('drops a snapshot awaited by the replaced session', async () => {
        const pending = deferred<typeof snapshot>();
        snapshots.mockReturnValueOnce(pending.promise);
        const old = await open();
        await jest.advanceTimersByTimeAsync(3_500);
        await open(nextContent);
        pending.resolve(snapshot);
        await jest.advanceTimersByTimeAsync(0);
        exitProcess(old);
        expect(updates).not.toHaveBeenCalled();
        await expectNextSessionPolling();
    });

    it('does not query state after an obsolete null snapshot', async () => {
        const pending = deferred<null>();
        snapshots.mockReturnValueOnce(pending.promise);
        await open();
        await jest.advanceTimersByTimeAsync(3_500);
        await open(nextContent);
        pending.resolve(null);
        await jest.advanceTimersByTimeAsync(0);
        expect(states).not.toHaveBeenCalled();
        await expectNextSessionPolling();
    });

    it('ignores an obsolete stopped reply without closing the old session or cancelling the new delay', async () => {
        const pending = deferred<string>();
        snapshots.mockResolvedValueOnce(null);
        states.mockReturnValueOnce(pending.promise);
        await open();
        const oldId = runtime.externalPlayerSessions.getActiveSessionId()!;
        await jest.advanceTimersByTimeAsync(3_500);
        expect(states).toHaveBeenCalledTimes(1);
        await open(nextContent);
        pending.resolve('stopped');
        await jest.advanceTimersByTimeAsync(0);
        expect(runtime.externalPlayerSessions.getSession(oldId)?.status).toBe(
            'opened'
        );
        await expectNextSessionPolling();
    });

    it.each(['snapshot', 'state'])(
        'ignores an obsolete %s rejection',
        async (stage) => {
            const pending = deferred<never>();
            if (stage === 'snapshot')
                snapshots.mockReturnValueOnce(pending.promise);
            else {
                snapshots.mockResolvedValueOnce(null);
                states.mockReturnValueOnce(pending.promise);
            }
            await open();
            await jest.advanceTimersByTimeAsync(3_500);
            await open(nextContent);
            pending.reject(new Error('Synthetic RC failure'));
            await jest.advanceTimersByTimeAsync(0);
            await expectNextSessionPolling();
        }
    );

    it('keeps the new polling delay when the replaced child exits', async () => {
        const old = await open();
        await open(nextContent);
        exitProcess(old);
        await expectNextSessionPolling();
    });

    it('drops an in-flight snapshot after the current child exits', async () => {
        const pending = deferred<typeof snapshot>();
        snapshots.mockReturnValueOnce(pending.promise);
        const proc = await open();
        await jest.advanceTimersByTimeAsync(3_500);
        exitProcess(proc);
        pending.resolve(snapshot);
        await jest.advanceTimersByTimeAsync(10_000);
        expect(updates).not.toHaveBeenCalled();
        expect(snapshots).toHaveBeenCalledTimes(1);
    });

    it('invalidates a pending poll when a launch error retries without RC', async () => {
        jest.spyOn(console, 'error').mockImplementation();
        const pending = deferred<typeof snapshot>();
        snapshots.mockReturnValueOnce(pending.promise);
        const proc = await open();
        await jest.advanceTimersByTimeAsync(3_500);
        const retry = createMockChildProcess();
        processes.push(retry);
        spawnMock.mockReturnValueOnce(retry);
        proc.emit('error', new Error('Synthetic RC launch failure'));
        retry.emit('spawn');
        pending.resolve(snapshot);
        await jest.advanceTimersByTimeAsync(10_000);
        expect(updates).not.toHaveBeenCalled();
        expect(snapshots).toHaveBeenCalledTimes(1);
    });

    it('still closes and stops the current session on a stopped reply', async () => {
        snapshots.mockResolvedValue(null);
        await open();
        const id = runtime.externalPlayerSessions.getActiveSessionId()!;
        await jest.advanceTimersByTimeAsync(10_000);
        expect(runtime.externalPlayerSessions.getSession(id)?.status).toBe(
            'closed'
        );
        expect(snapshots).toHaveBeenCalledTimes(1);
    });
});
