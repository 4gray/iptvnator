import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActiveLocalTimeshiftSession } from './local-timeshift-state';

export async function waitForPlayableTimeshiftPlaylist(
    session: ActiveLocalTimeshiftSession,
    abortSignal: AbortSignal,
    timeoutMs: number,
    pollIntervalMs: number
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        throwIfTimeshiftAborted(abortSignal);
        if (await hasPlayablePlaylist(session.directory)) return;
        await Promise.race([
            abortableDelay(pollIntervalMs, abortSignal),
            session.processFailure.then((error) => Promise.reject(error)),
        ]);
    }
    throw new Error(
        'FFmpeg did not produce a playable timeshift playlist in time'
    );
}

export async function readTimeshiftBufferMetrics(
    directory: string
): Promise<{ bufferedDurationSeconds: number; bytesUsed: number }> {
    let bufferedDurationSeconds = 0;
    let bytesUsed = 0;
    try {
        const playlist = await readFile(join(directory, 'index.m3u8'), 'utf8');
        for (const match of playlist.matchAll(/^#EXTINF:([0-9.]+)/gm)) {
            bufferedDurationSeconds += Number(match[1]) || 0;
        }
        const fileNames = await readdir(directory);
        const fileStats = await Promise.all(
            fileNames.map((fileName) => stat(join(directory, fileName)))
        );
        bytesUsed = fileStats.reduce(
            (total, file) => total + (file.isFile() ? file.size : 0),
            0
        );
    } catch {
        // A segment can be pruned while metrics are being sampled.
    }
    return { bufferedDurationSeconds, bytesUsed };
}

export function throwIfTimeshiftAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('Local timeshift start was canceled');
}

async function hasPlayablePlaylist(directory: string): Promise<boolean> {
    try {
        const playlist = await readFile(join(directory, 'index.m3u8'), 'utf8');
        if (!playlist.startsWith('#EXTM3U')) return false;
        const mediaFiles = playlist
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'));
        const mediaFile = mediaFiles.at(-1);
        if (!mediaFile || !/^segment-\d+\.(?:ts|m4s|mp4)$/.test(mediaFile)) {
            return false;
        }
        return (await stat(join(directory, mediaFile))).isFile();
    } catch {
        return false;
    }
}

function abortableDelay(
    milliseconds: number,
    signal: AbortSignal
): Promise<void> {
    return new Promise((resolve, reject) => {
        const handleAbort = () => {
            clearTimeout(timer);
            reject(new Error('Local timeshift start was canceled'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', handleAbort);
            resolve();
        }, milliseconds);
        timer.unref?.();
        signal.addEventListener('abort', handleAbort, { once: true });
    });
}
