import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Express } from 'express';

/** Entirely local synthetic media. IDs exercise initial manifest and segment failures. */
export function installLiveFormatFixture(app: Express): void {
    app.get('/live/live-fallback/live-fallback/:file', (request, response) => {
        const file = String(request.params['file']);
        response.set('Cache-Control', 'no-store');
        response.set('X-Fixture-User-Agent', request.get('user-agent') ?? '');
        if (file.endsWith('.m3u8')) {
            if (file === '10001.m3u8') {
                response.status(403).end();
                return;
            }
            response
                .type('application/vnd.apple.mpegurl')
                .send(
                    [
                        '#EXTM3U',
                        '#EXT-X-VERSION:3',
                        '#EXT-X-TARGETDURATION:6',
                        '#EXT-X-MEDIA-SEQUENCE:0',
                        '#EXTINF:6,',
                        file === '10003.m3u8'
                            ? 'delayed-segment.ts'
                            : 'denied-segment.ts',
                        '#EXT-X-ENDLIST',
                        '',
                    ].join('\n')
                );
            return;
        }
        if (file === 'delayed-segment.ts') {
            const timer = setTimeout(() => response.status(403).end(), 1500);
            response.on('close', () => clearTimeout(timer));
            return;
        }
        if (file === 'denied-segment.ts' || file === '10002.ts') {
            response.status(403).end();
            return;
        }
        response
            .type('video/mp2t')
            .send(
                readFileSync(
                    join(
                        process.cwd(),
                        'apps/xtream-mock-server/src/fixtures/live.mpegts'
                    )
                )
            );
    });
}
