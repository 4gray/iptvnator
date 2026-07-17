import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LocalTimeshiftService } from './local-timeshift.service';
import type { LocalTimeshiftFailure } from './local-timeshift.types';
import {
    fakeFfmpegProcess,
    fakeTimeshiftHttpServer,
    type FakeFfmpegProcess,
    waitUntil,
} from './local-timeshift.test-helpers';

describe('LocalTimeshiftService lifecycle', () => {
    let root: string;
    let processes: FakeFfmpegProcess[];
    let producePlaylist: boolean;
    let exitAfterPlaylistCode: number | undefined;
    let spawnProcess: jest.Mock<
        ChildProcess,
        [string, readonly string[], SpawnOptions]
    >;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'iptvnator-timeshift-lifecycle-'));
        processes = [];
        producePlaylist = true;
        exitAfterPlaylistCode = undefined;
        spawnProcess = jest.fn((_command, args, _options) => {
            void _options;
            const child = fakeFfmpegProcess(
                args.at(-1) as string,
                producePlaylist
            );
            processes.push(child);
            if (exitAfterPlaylistCode !== undefined) {
                queueMicrotask(() =>
                    child.emitUnexpectedExit(exitAfterPlaylistCode as number)
                );
            }
            return child;
        });
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('cancels a start race, kills FFmpeg, and removes partial output', async () => {
        producePlaylist = false;
        const service = createService();
        const startPromise = service.start(request('owner-race'));
        const rejection = expect(startPromise).rejects.toThrow(
            'Local timeshift start was canceled'
        );
        await waitUntil(() => spawnProcess.mock.calls.length === 1);
        const sessionDirectory = dirname(
            spawnProcess.mock.calls[0][1].at(-1) as string
        );

        await service.stopForOwner('owner-race');
        await rejection;

        expect(processes[0].kill).toHaveBeenCalledWith('SIGTERM');
        expect(existsSync(sessionDirectory)).toBe(false);
        expect(readdirSync(root)).toEqual([]);
    });

    it('does not wait for the active-session grace window when canceling a pending start', async () => {
        producePlaylist = false;
        const terminateProcess = jest.fn(
            async (child: ChildProcess, gracefulTimeoutMs: number) => {
                child.kill('SIGKILL');
                expect(gracefulTimeoutMs).toBe(0);
            }
        );
        const service = new LocalTimeshiftService({
            resolveFfmpeg: () => '/test/bin/ffmpeg',
            spawnProcess,
            terminateProcess,
            createHttpServer: async () => fakeTimeshiftHttpServer(),
            defaultBufferDirectory: () => root,
            pollIntervalMs: 5,
            startTimeoutMs: 500,
            stopTimeoutMs: 10_000,
        });
        const startPromise = service.start(request('owner-fast-cancel'));
        const rejection = expect(startPromise).rejects.toThrow(
            'Local timeshift start was canceled'
        );
        await waitUntil(() => spawnProcess.mock.calls.length === 1);

        await service.stopForOwner('owner-fast-cancel');
        await rejection;

        expect(terminateProcess).toHaveBeenCalledWith(processes[0], 0);
        expect(readdirSync(root)).toEqual([]);
    });

    it('cleans up and reports an unexpected FFmpeg exit', async () => {
        const failures: LocalTimeshiftFailure[] = [];
        const service = createService((failure) => failures.push(failure));
        const session = await service.start(request('owner-exit'));
        const sessionDirectory = dirname(
            spawnProcess.mock.calls[0][1].at(-1) as string
        );

        processes[0].emitUnexpectedExit(23);
        await waitUntil(() => failures.length === 1);

        expect(failures[0].sessionId).toBe(session.id);
        expect(failures[0].ownerId).toBe('owner-exit');
        expect(failures[0].error.message).toBe(
            'FFmpeg timeshift process exited unexpectedly (code 23)'
        );
        expect(failures[0].error.message).not.toContain('private-source-token');
        expect(failures[0].error.message).not.toContain(root);
        expect(existsSync(sessionDirectory)).toBe(false);
        expect(
            await service.getSession(session.id, 'owner-exit')
        ).toBeUndefined();
    });

    it('rejects when FFmpeg exits at the playable startup boundary', async () => {
        const failures: LocalTimeshiftFailure[] = [];
        const service = createService((failure) => failures.push(failure));
        exitAfterPlaylistCode = 12;
        const startPromise = service.start(request('owner-startup-exit'));
        const rejection = expect(startPromise).rejects.toThrow(
            'FFmpeg timeshift process exited unexpectedly (code 12)'
        );

        await rejection;

        expect(failures).toEqual([]);
        expect(readdirSync(root)).toEqual([]);
    });

    it('lets a replacement start proceed while the previous teardown is in flight', async () => {
        const service = createService();
        const first = await service.start(request('owner-zap'));
        const slowChild = processes[0];
        // Simulate an FFmpeg process that survives SIGTERM and SIGKILL for a
        // while; the fake's default kill() would exit immediately.
        (slowChild.kill as jest.Mock).mockImplementation(() => true);

        await service.stopForOwner('owner-zap');
        const second = await service.start(request('owner-zap'));

        expect(second.id).not.toBe(first.id);
        expect(slowChild.kill).toHaveBeenCalledWith('SIGTERM');
        expect(slowChild.exitCode).toBeNull();

        slowChild.emitUnexpectedExit(0);
        const firstDirectory = dirname(
            spawnProcess.mock.calls[0][1].at(-1) as string
        );
        await waitUntil(() => !existsSync(firstDirectory));
        await service.shutdown();
        expect(readdirSync(root)).toEqual([]);
    });

    it('kills and removes every active session during shutdown', async () => {
        const service = createService();
        await service.start(request('owner-a'));
        await service.start(request('owner-b'));

        await service.shutdown();

        expect(processes).toHaveLength(2);
        expect(processes[0].kill).toHaveBeenCalledWith('SIGTERM');
        expect(processes[1].kill).toHaveBeenCalledWith('SIGTERM');
        expect(readdirSync(root)).toEqual([]);
    });

    function createService(
        failureHandler?: (failure: LocalTimeshiftFailure) => void
    ): LocalTimeshiftService {
        return new LocalTimeshiftService({
            resolveFfmpeg: () => '/test/bin/ffmpeg',
            spawnProcess,
            createHttpServer: async () => fakeTimeshiftHttpServer(),
            defaultBufferDirectory: () => root,
            failureHandler,
            pollIntervalMs: 5,
            startTimeoutMs: 500,
            stopTimeoutMs: 50,
        });
    }
});

function request(ownerId: string) {
    return {
        ownerId,
        sourceUrl: 'https://example.com/live.m3u8?token=private-source-token',
        requestHeaders: { Authorization: 'Bearer private-header-token' },
        maxDurationMinutes: 5,
    };
}
