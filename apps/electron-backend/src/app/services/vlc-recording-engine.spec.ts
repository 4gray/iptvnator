import {
    existsSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { spawn } from 'node:child_process';
import { VlcRecordingEngine } from './vlc-recording-engine';
import { fakeProcess, recording } from './vlc-recording-engine.test-helpers';
import { store } from './store.service';

jest.mock('./embedded-mpv-native.service', () => ({
    embeddedMpvNativeService: {
        getDefaultRecordingFolder: jest.fn(),
    },
}));
jest.mock('./store.service', () => ({
    VLC_PLAYER_PATH: 'VLC_PLAYER_PATH',
    store: { get: jest.fn().mockReturnValue('') },
}));

describe('VlcRecordingEngine', () => {
    let directory: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'iptvnator-vlc-recording-'));
        (store.get as jest.Mock).mockReturnValue('');
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    it('rejects unsupported headers during request preflight', () => {
        const engine = new VlcRecordingEngine({
            probeProcess: jest.fn().mockReturnValue({ status: 0 }),
        });

        expect(
            engine.getSupportFor({
                ...recording(),
                playback: {
                    streamUrl: 'https://example.com/live',
                    title: 'News',
                    headers: { Authorization: 'Bearer secret' },
                },
            })
        ).toEqual(
            expect.objectContaining({
                supported: false,
                reason: expect.stringContaining('Authorization'),
            })
        );
    });

    it('validates fallback playback headers during request preflight', () => {
        const engine = new VlcRecordingEngine({
            probeProcess: jest.fn().mockReturnValue({ status: 0 }),
        });

        expect(
            engine.getSupportFor({
                ...recording(),
                playback: {
                    streamUrl: 'https://example.com/live',
                    title: 'News',
                    origin: 'https://example.com',
                },
            })
        ).toEqual(
            expect.objectContaining({
                supported: false,
                reason: expect.stringContaining('Origin'),
            })
        );
    });

    it('rechecks VLC after a previous availability probe failed', () => {
        const probeProcess = jest
            .fn()
            .mockReturnValueOnce({ status: 1 })
            .mockReturnValueOnce({ status: 0 });
        const engine = new VlcRecordingEngine({ probeProcess });

        expect(engine.getSupport().supported).toBe(false);
        expect(engine.getSupport()).toEqual({ supported: true });
        expect(probeProcess).toHaveBeenCalledTimes(2);
    });

    it('probes the VLC path configured in player settings', () => {
        (store.get as jest.Mock).mockReturnValue('/custom/VLC');
        const probeProcess = jest.fn().mockReturnValue({ status: 0 });
        const engine = new VlcRecordingEngine({ probeProcess });

        expect(engine.getSupport()).toEqual({ supported: true });
        expect(probeProcess).toHaveBeenCalledWith(
            '/custom/VLC',
            ['--version'],
            expect.objectContaining({ shell: false, timeout: 2_000 })
        );
    });

    it('starts a private VLC process and stops it with SIGINT', async () => {
        const childProcess = fakeProcess();
        const spawnProcess = jest.fn(() => {
            queueMicrotask(() => childProcess.emit('spawn'));
            return childProcess;
        }) as unknown as typeof spawn;
        const engine = new VlcRecordingEngine({
            resolveLaunchContext: () => ({
                mode: 'direct',
                playerPath: '/Applications/VLC.app/Contents/MacOS/VLC',
                command: '/Applications/VLC.app/Contents/MacOS/VLC',
                argsPrefix: [],
            }),
            spawnProcess,
            probeProcess: jest.fn().mockReturnValue({ status: 0 }),
            defaultRecordingDirectory: () => directory,
            stopTimeoutMs: 10,
        });

        const started = await engine.start(recording());
        if (process.platform !== 'win32') {
            expect(statSync(started.filePath).mode & 0o777).toBe(0o600);
        }
        writeFileSync(started.filePath, Buffer.from('mpeg-ts-data'));
        expect(started.filePath).toMatch(/Evening News-.*\.ts$/);
        expect(spawnProcess).toHaveBeenCalledWith(
            '/Applications/VLC.app/Contents/MacOS/VLC',
            expect.arrayContaining([`--sout-standard-dst=${started.filePath}`]),
            {
                shell: false,
                detached: false,
                stdio: ['pipe', 'ignore', 'ignore'],
            }
        );

        await expect(engine.stop('recording-1')).resolves.toEqual(
            expect.objectContaining({ filePath: started.filePath })
        );
        expect(childProcess.stdin?.write).toHaveBeenCalledWith('quit\n');
        const inputPath = (
            (spawnProcess as unknown as jest.Mock).mock.calls[0][1] as string[]
        ).at(-1);
        expect(inputPath).toBeDefined();
        expect(existsSync(inputPath as string)).toBe(false);
    });

    it('removes the reserved file when VLC cannot spawn', async () => {
        const process = fakeProcess();
        (process.stdin?.write as jest.Mock).mockReturnValue(true);
        const spawnProcess = jest.fn(() => {
            queueMicrotask(() =>
                process.emit('error', new Error('VLC is unavailable'))
            );
            return process;
        }) as unknown as typeof spawn;
        const engine = new VlcRecordingEngine({
            resolveLaunchContext: () => ({
                mode: 'direct',
                playerPath: 'vlc',
                command: 'vlc',
                argsPrefix: [],
            }),
            spawnProcess,
            probeProcess: jest.fn().mockReturnValue({ status: 0 }),
            defaultRecordingDirectory: () => directory,
        });

        await expect(engine.start(recording())).rejects.toThrow(
            'Failed to start VLC recording'
        );
        expect(readdirSync(directory)).toEqual([]);
    });

    it('removes the reserved file when command validation rejects headers', async () => {
        const engine = new VlcRecordingEngine({
            probeProcess: jest.fn().mockReturnValue({ status: 0 }),
            defaultRecordingDirectory: () => directory,
        });

        await expect(
            engine.start(
                recording({
                    requestHeaders: { Authorization: 'Bearer secret' },
                })
            )
        ).rejects.toThrow('Authorization');
        expect(readdirSync(directory)).toEqual([]);
    });

    it('reports an unexpected VLC exit to the scheduler', async () => {
        const process = fakeProcess();
        const spawnProcess = jest.fn(() => {
            queueMicrotask(() => process.emit('spawn'));
            return process;
        }) as unknown as typeof spawn;
        const failureHandler = jest.fn();
        const engine = new VlcRecordingEngine({
            resolveLaunchContext: () => ({
                mode: 'direct',
                playerPath: 'vlc',
                command: 'vlc',
                argsPrefix: [],
            }),
            spawnProcess,
            probeProcess: jest.fn().mockReturnValue({ status: 0 }),
            defaultRecordingDirectory: () => directory,
        });
        engine.setFailureHandler(failureHandler);

        const started = await engine.start(recording());
        writeFileSync(started.filePath, Buffer.from('partial-mpeg-ts'));
        process.emit('exit', 1, null);
        await Promise.resolve();

        expect(failureHandler).toHaveBeenCalledWith(
            'recording-1',
            expect.objectContaining({
                message: expect.stringContaining('code 1'),
            })
        );
        const inputPath = (
            (spawnProcess as unknown as jest.Mock).mock.calls[0][1] as string[]
        ).at(-1) as string;
        expect(existsSync(inputPath)).toBe(false);
    });
});
