jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
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
import {
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    VLC_PLAYER_PATH,
    VLC_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import { openMpvPlayer, shutdownMpvSession } from './mpv-session.service';
import { openVlcPlayer, shutdownVlcSession } from './vlc-session.service';

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
