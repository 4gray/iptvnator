import { basename, join } from 'node:path';
import { closeSync, mkdirSync, openSync, statSync, unlinkSync } from 'node:fs';
import type { RecordingEngineResult } from './recording-engine';

export function reserveRecordingTargetPath(
    directory: string,
    title: string,
    now: Date = new Date()
): string {
    mkdirSync(directory, { recursive: true });
    const baseName = sanitizeRecordingFileName(title);
    const timestamp = formatRecordingTimestamp(now);
    let candidate = join(directory, `${baseName}-${timestamp}.ts`);
    let suffix = 2;

    while (true) {
        try {
            const fd = openSync(candidate, 'wx', 0o600);
            closeSync(fd);
            return candidate;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
                candidate = join(
                    directory,
                    `${baseName}-${timestamp}-${suffix}.ts`
                );
                suffix += 1;
                continue;
            }

            throw error;
        }
    }
}

export function releaseReservedRecordingTargetPath(targetPath: string): void {
    try {
        unlinkSync(targetPath);
    } catch {
        // Ignore cleanup failures; the recording start error is more useful.
    }
}

export function recordingResultForPath(
    filePath: string
): RecordingEngineResult {
    let bytesRecorded: number | null = null;
    try {
        bytesRecorded = statSync(filePath).size;
    } catch {
        bytesRecorded = null;
    }
    return {
        fileName: basename(filePath),
        filePath,
        bytesRecorded,
    };
}

function sanitizeRecordingFileName(title: string): string {
    const normalized = title
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\p{Cc}/gu, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return (normalized || 'IPTVnator recording').slice(0, 120);
}

function formatRecordingTimestamp(date: Date): string {
    const parts = [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
    ].map((part) => String(part).padStart(2, '0'));

    return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}
