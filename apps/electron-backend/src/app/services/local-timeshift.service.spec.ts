import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LocalTimeshiftService } from './local-timeshift.service';
import {
    fakeFfmpegProcess,
    fakeTimeshiftHttpServer,
    type FakeFfmpegProcess,
} from './local-timeshift.test-helpers';

describe('LocalTimeshiftService', () => {
    let root: string;
    let processes: FakeFfmpegProcess[];
    let spawnProcess: jest.Mock<
        ChildProcess,
        [string, readonly string[], SpawnOptions]
    >;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'iptvnator-timeshift-service-'));
        processes = [];
        spawnProcess = jest.fn((_command, args, _options) => {
            void _options;
            const child = fakeFfmpegProcess(args.at(-1) as string);
            processes.push(child);
            return child;
        });
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('reports unsupported cleanly when FFmpeg cannot be resolved', async () => {
        const service = new LocalTimeshiftService({
            resolveFfmpeg: () => undefined,
            spawnProcess,
            defaultBufferDirectory: () => root,
        });

        expect(service.getSupport()).toEqual({
            supported: false,
            reason: 'FFmpeg is not available for local timeshift',
        });
        await expect(service.start(request())).rejects.toThrow(
            'FFmpeg is not available for local timeshift'
        );
        expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('starts without a shell and returns no source URL or filesystem path', async () => {
        const service = createService();
        const session = await service.start(request());

        expect(spawnProcess).toHaveBeenCalledWith(
            '/test/bin/ffmpeg',
            expect.any(Array),
            {
                shell: false,
                detached: false,
                stdio: 'ignore',
                windowsHide: true,
            }
        );
        expect(session.playbackUrl).toMatch(
            /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/index\.m3u8$/
        );
        expect(session.bufferedDurationSeconds).toBe(4);
        const publicJson = JSON.stringify(session);
        expect(publicJson).not.toContain('private-source-token');
        expect(publicJson).not.toContain(root);

        await expect(service.stop(session.id, 'other-owner')).rejects.toThrow(
            'Local timeshift session was not found'
        );
        await service.stop(session.id, 'owner-1');
    });

    it('kills FFmpeg and removes the session directory on stop', async () => {
        const service = createService();
        const session = await service.start(request());
        const outputPath = spawnProcess.mock.calls[0][1].at(-1) as string;
        const sessionDirectory = dirname(outputPath);

        await service.stop(session.id, 'owner-1');

        expect(processes[0].kill).toHaveBeenCalledWith('SIGTERM');
        expect(existsSync(sessionDirectory)).toBe(false);
        expect(await service.getSession(session.id, 'owner-1')).toBeUndefined();
    });

    it('keeps each session bound to one owner', async () => {
        const service = createService();
        const session = await service.start(request());

        await expect(service.start(request())).rejects.toThrow(
            'Local timeshift is already active for this owner'
        );
        expect(
            await service.getSession(session.id, 'other-owner')
        ).toBeUndefined();

        await service.stopForOwner('owner-1');
        expect(readdirSync(root)).toEqual([]);
    });

    function createService(): LocalTimeshiftService {
        return new LocalTimeshiftService({
            resolveFfmpeg: () => '/test/bin/ffmpeg',
            spawnProcess,
            createHttpServer: async () => fakeTimeshiftHttpServer(),
            defaultBufferDirectory: () => root,
            pollIntervalMs: 5,
            startTimeoutMs: 500,
            stopTimeoutMs: 50,
        });
    }
});

function request() {
    return {
        ownerId: 'owner-1',
        sourceUrl: 'https://example.com/live.m3u8?token=private-source-token',
        requestHeaders: { Authorization: 'Bearer private-header-token' },
        maxDurationMinutes: 5,
    };
}
