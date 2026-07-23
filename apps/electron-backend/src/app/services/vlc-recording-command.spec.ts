import {
    existsSync,
    mkdtempSync,
    readFileSync,
    statSync,
    utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersistedRecordingItem } from '@iptvnator/shared/interfaces';
import {
    cleanupStaleVlcRecordingInputs,
    prepareVlcRecordingCommand,
} from './vlc-recording-command';

function recording(
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

describe('VLC recording command', () => {
    it('builds a headless MPEG-TS remux command with safe HTTP headers', () => {
        const prepared = prepareVlcRecordingCommand(
            recording(),
            '/Recordings with spaces/news.ts'
        );
        try {
            expect(prepared.args).toEqual(
                expect.arrayContaining([
                    '--intf=dummy',
                    '--sout=#standard',
                    '--sout-standard-access=file',
                    '--sout-standard-mux=ts',
                    '--sout-standard-dst=/Recordings with spaces/news.ts',
                    prepared.inputFilePath,
                ])
            );
            expect(prepared.args).not.toContain(
                'https://example.com/private-token'
            );
            expect(prepared.args).not.toContain('--dummy-quiet');
            expect(readFileSync(prepared.inputFilePath, 'utf8')).toContain(
                '#EXTVLCOPT:http-user-agent=IPTVnator test\n#EXTVLCOPT:http-referrer=https://example.com/\nhttps://example.com/private-token'
            );
            if (process.platform !== 'win32') {
                expect(statSync(prepared.inputFilePath).mode & 0o777).toBe(
                    0o600
                );
            }
        } finally {
            prepared.cleanup();
        }
    });

    it('rejects headers that VLC 3 cannot forward reliably', () => {
        expect(() =>
            prepareVlcRecordingCommand(
                recording({
                    requestHeaders: {
                        Authorization: 'Bearer secret',
                        Origin: 'https://example.com',
                    },
                }),
                '/recordings/news.ts'
            )
        ).toThrow('Authorization, Origin');
    });

    it('removes stale private input playlists left after a crash', () => {
        const staleDirectory = mkdtempSync(
            join(tmpdir(), 'iptvnator-vlc-legacy-')
        );
        const oldDate = new Date('2026-07-12T00:00:00.000Z');
        utimesSync(staleDirectory, oldDate, oldDate);

        cleanupStaleVlcRecordingInputs(
            new Date('2026-07-14T00:00:00.000Z').getTime()
        );

        expect(existsSync(staleDirectory)).toBe(false);
    });

    it('does not block startup when the temp root cannot be read', () => {
        expect(() =>
            cleanupStaleVlcRecordingInputs(
                Date.now(),
                1,
                join(tmpdir(), 'iptvnator-missing-temp-root')
            )
        ).not.toThrow();
    });
});
