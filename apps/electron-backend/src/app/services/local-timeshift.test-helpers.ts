import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LocalTimeshiftHttpServer } from './local-timeshift-http-server';

export interface FakeFfmpegProcess extends ChildProcess {
    emitUnexpectedExit(code: number): void;
}

export function fakeFfmpegProcess(
    outputPlaylistPath: string,
    producePlaylist = true
): FakeFfmpegProcess {
    const child = new EventEmitter() as FakeFfmpegProcess;
    Object.assign(child, {
        exitCode: null,
        killed: false,
        kill: jest.fn().mockImplementation(() => {
            setExitCode(child, 0);
            queueMicrotask(() => child.emit('exit', 0, null));
            return true;
        }),
        emitUnexpectedExit: (code: number) => {
            setExitCode(child, code);
            child.emit('exit', code, null);
        },
    });
    queueMicrotask(() => {
        child.emit('spawn');
        if (producePlaylist) writePlayablePlaylist(outputPlaylistPath);
    });
    return child;
}

export function writePlayablePlaylist(outputPlaylistPath: string): void {
    const directory = dirname(outputPlaylistPath);
    writeFileSync(join(directory, 'segment-000000000.ts'), 'video');
    writeFileSync(
        outputPlaylistPath,
        '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4.000,\nsegment-000000000.ts\n'
    );
}

export function fakeTimeshiftHttpServer(): LocalTimeshiftHttpServer {
    return {
        playbackUrl: 'http://127.0.0.1:54321/test-http-token/index.m3u8',
        close: jest.fn().mockResolvedValue(undefined),
    };
}

export async function waitUntil(
    condition: () => boolean,
    timeoutMs = 2_000
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error('Condition timed out');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

function setExitCode(child: ChildProcess, exitCode: number): void {
    Object.defineProperty(child, 'exitCode', {
        configurable: true,
        value: exitCode,
        writable: true,
    });
}
