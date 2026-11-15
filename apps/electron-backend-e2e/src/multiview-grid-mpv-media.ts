import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { workspaceRoot } from './electron-test-fixtures';
import { createLocalMediaServer } from './embedded-mpv-frame-copy-packaged-fixtures';

export async function createGridMedia() {
    const segment = await createLocalMediaServer({
        body: readFileSync(
            join(
                workspaceRoot,
                'apps/xtream-mock-server/src/fixtures/live.mpegts'
            )
        ),
        resourcePath: '/grid-segment.ts',
        contentType: 'video/mp2t',
    });
    const paths = [1, 2, 3, 4].map((slot) => `/grid-${slot}.m3u8`);
    const requests = paths.map(() => 0);
    const server = createServer((request, response) => {
        const path = request.url?.split('?')[0];
        const index = paths.findIndex((candidate) => candidate === path);
        if (index === -1) {
            response.writeHead(404).end();
            return;
        }
        requests[index] += 1;
        const manifest = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-TARGETDURATION:7',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            ...Array.from({ length: 32 }, (_, number) => [
                ...(number ? ['#EXT-X-DISCONTINUITY'] : []),
                '#EXTINF:6.022,',
                `${segment.url}?clip=${index + 1}&segment=${number}`,
            ]).flat(),
            '#EXT-X-ENDLIST',
            '',
        ].join('\n');
        response.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
        });
        response.end(manifest);
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string')
            throw new Error('Grid media server has no port');
        const origin = `http://127.0.0.1:${address.port}`;
        return {
            urls: paths.map((path) => `${origin}${path}`),
            unavailableUrl: `${origin}/unavailable.m3u8`,
            requests,
            close: async () => {
                server.closeAllConnections();
                await Promise.all([
                    segment.close(),
                    new Promise<void>((resolve, reject) =>
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        )
                    ),
                ]);
            },
        };
    } catch (error) {
        await segment.close();
        throw error;
    }
}
