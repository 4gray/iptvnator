import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { PersistedRecordingItem } from '@iptvnator/shared/interfaces';

export function recording(
    overrides: Partial<PersistedRecordingItem> = {}
): PersistedRecordingItem {
    return {
        id: 'recording-1',
        playlistId: 'playlist-1',
        sourceType: 'm3u',
        channelId: 'news',
        channelName: 'News',
        title: 'Evening News',
        streamUrl: 'https://example.com/private-token',
        requestHeaders: {
            'User-Agent': 'IPTVnator test',
            Referer: 'https://example.com/',
        },
        scheduledStartAt: '2026-07-14T18:00:00.000Z',
        scheduledEndAt: '2026-07-14T19:00:00.000Z',
        paddingBeforeSeconds: 0,
        paddingAfterSeconds: 0,
        status: 'scheduled',
        ...overrides,
    };
}

export function fakeProcess(): ChildProcess {
    const child = new EventEmitter() as ChildProcess;
    const stdin = Object.assign(new EventEmitter(), {
        writable: true,
        write: jest.fn().mockImplementation(() => {
            (child as unknown as { exitCode: number | null }).exitCode = 0;
            queueMicrotask(() => child.emit('exit', 0, null));
            return true;
        }),
        end: jest.fn(),
    });
    Object.assign(child, {
        exitCode: null,
        killed: false,
        stdin,
        kill: jest.fn().mockImplementation(() => {
            (child as unknown as { exitCode: number | null }).exitCode = 0;
            queueMicrotask(() => child.emit('exit', 0, null));
            return true;
        }),
    });
    return child;
}
