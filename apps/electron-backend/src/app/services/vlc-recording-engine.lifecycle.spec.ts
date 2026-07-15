import type { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VlcRecordingEngine } from './vlc-recording-engine';
import { fakeProcess, recording } from './vlc-recording-engine.test-helpers';

jest.mock('./embedded-mpv-native.service', () => ({
    embeddedMpvNativeService: {
        getDefaultRecordingFolder: jest.fn(),
    },
}));
jest.mock('./store.service', () => ({
    VLC_PLAYER_PATH: 'VLC_PLAYER_PATH',
    store: { get: jest.fn().mockReturnValue('') },
}));

describe('VLC recording process lifecycle', () => {
    let directory: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'iptvnator-vlc-recording-'));
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    function createEngine(process: ReturnType<typeof fakeProcess>) {
        const spawnProcess = jest.fn(() => {
            queueMicrotask(() => process.emit('spawn'));
            return process;
        }) as unknown as typeof spawn;
        return new VlcRecordingEngine({
            resolveLaunchContext: () => ({
                mode: 'direct',
                playerPath: 'vlc',
                command: 'vlc',
                argsPrefix: [],
            }),
            spawnProcess,
            probeProcess: jest.fn().mockReturnValue({ status: 0 }),
            defaultRecordingDirectory: () => directory,
            stopTimeoutMs: 5,
        });
    }

    it('escalates to SIGKILL when VLC ignores the graceful quit command', async () => {
        const process = fakeProcess();
        (process.stdin?.write as jest.Mock).mockReturnValue(true);
        (process.kill as jest.Mock).mockImplementation((signal: string) => {
            if (signal === 'SIGKILL') {
                (process as unknown as { exitCode: number | null }).exitCode =
                    0;
                queueMicrotask(() => process.emit('exit', 0, null));
            }
            return true;
        });
        const engine = createEngine(process);

        const started = await engine.start(recording());
        writeFileSync(started.filePath, Buffer.from('mpeg-ts-data'));
        await engine.stop('recording-1');

        expect(process.stdin?.write).toHaveBeenCalledWith('quit\n');
        expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('falls back to a signal when the VLC control pipe fails', async () => {
        const process = fakeProcess();
        (process.stdin?.write as jest.Mock).mockReturnValue(true);
        const engine = createEngine(process);
        const started = await engine.start(recording());
        writeFileSync(started.filePath, Buffer.from('mpeg-ts-data'));

        const stopping = engine.stop('recording-1');
        process.stdin?.emit('error', new Error('EPIPE'));

        await expect(stopping).resolves.toEqual(
            expect.objectContaining({ filePath: started.filePath })
        );
        expect(process.kill).toHaveBeenCalledWith(
            globalThis.process.platform === 'win32' ? 'SIGTERM' : 'SIGINT'
        );
    });
});
