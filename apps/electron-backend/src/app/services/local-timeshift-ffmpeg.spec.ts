import type { SpawnSyncReturns } from 'node:child_process';
import {
    buildLocalTimeshiftFfmpegArgs,
    ffmpegCandidates,
    localTimeshiftListSize,
    resolveFfmpegCommand,
    serializeFfmpegHeaders,
} from './local-timeshift-ffmpeg';

function probeResult(status: number | null): SpawnSyncReturns<Buffer> {
    return {
        pid: 1,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status,
        signal: null,
    };
}

describe('local timeshift FFmpeg command', () => {
    it('builds a bounded four-second sliding HLS copy command', () => {
        const args = buildLocalTimeshiftFfmpegArgs({
            sourceUrl: 'https://stream.example/live.m3u8?token=secret',
            requestHeaders: {
                Authorization: 'Bearer private',
                Referer: 'https://portal.example/',
            },
            maxDurationMinutes: 5,
            outputDirectory: '/tmp/timeshift-session',
        });

        expect(args).toEqual(
            expect.arrayContaining([
                '-nostdin',
                '-probesize',
                '2500000',
                '-analyzeduration',
                '2000000',
                '-i',
                'https://stream.example/live.m3u8?token=secret',
                '-c',
                'copy',
                '-hls_time',
                '4',
                '-hls_init_time',
                '1',
                '-hls_list_size',
                '75',
                '-hls_flags',
                'delete_segments+temp_file+omit_endlist+independent_segments',
                '-hls_segment_filename',
                '/tmp/timeshift-session/segment-%09d.ts',
                '/tmp/timeshift-session/index.m3u8',
            ])
        );
        expect(args[args.indexOf('-headers') + 1]).toBe(
            'Authorization: Bearer private\r\n' +
                'Referer: https://portal.example/\r\n'
        );
    });

    it('rounds the list size up so the configured window is not shortened', () => {
        expect(localTimeshiftListSize(1)).toBe(15);
        expect(localTimeshiftListSize(1.01)).toBe(16);
        expect(() => localTimeshiftListSize(0)).toThrow(
            'Invalid local timeshift duration'
        );
    });

    it.each([
        [{ 'X-Test\r\nInjected': 'yes' }],
        [{ 'X-Test': 'yes\nInjected: true' }],
        [{ 'Bad Header': 'yes' }],
        [{ 'X-Test': '\0' }],
    ])('rejects unsafe input headers', (headers) => {
        expect(() => serializeFfmpegHeaders(headers)).toThrow(
            'Invalid local timeshift HTTP header'
        );
    });

    it('rejects line breaks in the input URL', () => {
        expect(() =>
            buildLocalTimeshiftFfmpegArgs({
                sourceUrl: 'https://example.com/live\n-header',
                maxDurationMinutes: 5,
                outputDirectory: '/tmp/session',
            })
        ).toThrow('Invalid local timeshift source URL');
    });

    it('probes PATH first and returns the first working command', () => {
        const probe = jest
            .fn()
            .mockReturnValueOnce(probeResult(1))
            .mockReturnValueOnce(probeResult(0));

        const command = resolveFfmpegCommand({
            env: {},
            platform: 'darwin',
            probe,
        });

        expect(command).toBe('/opt/homebrew/bin/ffmpeg');
        expect(probe.mock.calls[0]).toEqual([
            'ffmpeg',
            ['-version'],
            {
                shell: false,
                stdio: 'ignore',
                timeout: 2_000,
                windowsHide: true,
            },
        ]);
    });

    it('returns undefined when every known FFmpeg command fails', () => {
        const probe = jest.fn().mockReturnValue(probeResult(127));

        expect(
            resolveFfmpegCommand({ env: {}, platform: 'linux', probe })
        ).toBeUndefined();
        expect(probe).toHaveBeenCalledTimes(
            ffmpegCandidates('linux', {}).length
        );
    });
});
