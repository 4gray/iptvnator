import { navigationPortalResponse } from '@iptvnator/shared/testing';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { workspaceRoot } from './electron-test-fixtures';

/** Only synthetic metadata/artwork and the committed local playback clip. */
export async function startAccessibilityFixture() {
    const clip = readFileSync(
        join(workspaceRoot, 'apps/web-e2e/src/fixtures/playback/episode.webm')
    );
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://synthetic.invalid');
        if (url.pathname === '/clip.webm') {
            response.setHeader('content-type', 'video/webm');
            response.end(clip);
            return;
        }
        let data = navigationPortalResponse(url.searchParams);
        if (url.searchParams.get('action') === 'get_vod_streams') {
            data = Array.from({ length: 320 }, (_, index) => {
                const params = new URLSearchParams({
                    action: 'get_vod_info',
                    vod_id: String(20001 + index),
                });
                return (
                    navigationPortalResponse(params) as { movie_data: unknown }
                ).movie_data;
            });
        }
        if (url.searchParams.get('action') === 'get_series_info') {
            const detail = data as {
                episodes: Record<string, Record<string, unknown>[]>;
            };
            const episode = detail.episodes['1'][0];
            detail.episodes = Object.fromEntries(
                [1, 2, 3].map((season) => [
                    String(season),
                    [
                        {
                            ...episode,
                            season,
                            id: String(50000 + season),
                            title: `Synthetic Episode ${season}`,
                        },
                    ],
                ])
            );
        }
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(data));
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Fixture port missing');
    return {
        url: `http://127.0.0.1:${address.port}`,
        async close() {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}
