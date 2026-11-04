jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('net', () => ({ createConnection: jest.fn() }));
jest.mock('../app', () => ({
    __esModule: true,
    default: { mainWindow: null },
}));
jest.mock('../services/store.service', () => ({
    MPV_PLAYER_ARGUMENTS: 'MPV_PLAYER_ARGUMENTS',
    MPV_PLAYER_PATH: 'MPV_PLAYER_PATH',
    MPV_REUSE_INSTANCE: 'MPV_REUSE_INSTANCE',
    store: { get: jest.fn(), set: jest.fn() },
}));

import { EventEmitter } from 'events';
import {
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    store,
} from '../services/store.service';
import * as runtime from './external-player-runtime';
import { stopPositionPolling } from './mpv-position-polling';
import { openMpvPlayer } from './mpv-session.service';
import {
    createConnectionMock,
    createMockChildProcess,
    spawnMock,
} from './mpv-session.test-helpers';

describe('MPV position polling ownership', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        (store.get as jest.Mock).mockImplementation(
            (key: string, fallback?: unknown) =>
                ({
                    [MPV_PLAYER_PATH]: '/usr/bin/mpv',
                    [MPV_REUSE_INSTANCE]: false,
                })[key] ?? fallback
        );
        createConnectionMock.mockImplementation(() => {
            const socket = Object.assign(new EventEmitter(), {
                destroy: jest.fn(),
                write: jest.fn((request: string) => {
                    const { command } = JSON.parse(request);
                    setImmediate(() =>
                        socket.emit(
                            'data',
                            Buffer.from(
                                JSON.stringify({
                                    data: command[1] === 'time-pos' ? 42 : 120,
                                }) + '\n'
                            )
                        )
                    );
                }),
            });
            setImmediate(() => socket.emit('connect'));
            return socket;
        });
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        stopPositionPolling();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it.each([
        ['exit', 0],
        ['error', 0],
        ['exit', 7_000],
        ['error', 7_000],
    ] as const)(
        'keeps the replacement poll after an old %s at %i ms',
        async (event, elapsed) => {
            const sendPosition = jest.spyOn(
                runtime,
                'sendPlaybackPositionUpdate'
            );
            const oldProcess = createMockChildProcess();
            const replacementProcess = createMockChildProcess();
            spawnMock
                .mockReturnValueOnce(oldProcess)
                .mockReturnValueOnce(replacementProcess);
            const contentInfo = {
                playlistId: 'playlist-1',
                contentXtreamId: 1,
                contentType: 'vod' as const,
            };
            const first = openMpvPlayer({
                title: 'First stream',
                url: 'https://example.com/one.m3u8',
                contentInfo,
            });
            await jest.advanceTimersByTimeAsync(100);
            await first;
            const second = openMpvPlayer({
                title: 'Replacement stream',
                url: 'https://example.com/two.m3u8',
                contentInfo: { ...contentInfo, contentXtreamId: 2 },
            });
            await jest.advanceTimersByTimeAsync(100);
            const replacement = await second;
            await jest.advanceTimersByTimeAsync(elapsed);
            sendPosition.mockClear();

            oldProcess.emit(
                event,
                event === 'exit' ? 0 : new Error('old child')
            );
            await jest.advanceTimersByTimeAsync(7_100);

            expect(sendPosition).toHaveBeenCalledWith(
                replacement.id,
                { ...contentInfo, contentXtreamId: 2 },
                { positionSeconds: 42, durationSeconds: 120 }
            );

            replacementProcess.emit('exit', 0);
            sendPosition.mockClear();
            await jest.advanceTimersByTimeAsync(10_000);
            expect(sendPosition).not.toHaveBeenCalled();
        }
    );
});
