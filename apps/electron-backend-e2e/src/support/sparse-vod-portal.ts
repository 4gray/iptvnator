import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { xtreamMockServer } from '../electron-test-fixtures';

/** A real HTTP portal: Electron's main-process API bypasses page.route(). */
export async function createSparseVodPortal(
    mode: 'catalog' | 'missing' | 'direct'
) {
    const clip = readFileSync(
        join(__dirname, '../../../web-e2e/src/fixtures/playback/episode.webm')
    );
    const mediaRequests: string[] = [];
    let origin = '';
    const server = createServer(async (request, response) => {
        const incoming = new URL(request.url ?? '/', xtreamMockServer);
        if (incoming.pathname.startsWith('/movie/')) {
            mediaRequests.push(incoming.pathname);
            const range = /^bytes=(\d+)-(\d*)$/.exec(
                request.headers.range ?? ''
            );
            const start = range ? Number(range[1]) : 0;
            const end = range?.[2]
                ? Math.min(Number(range[2]), clip.length - 1)
                : clip.length - 1;
            response
                .writeHead(range ? 206 : 200, {
                    'content-type': 'video/webm',
                    'accept-ranges': 'bytes',
                    'content-length': end - start + 1,
                    ...(range
                        ? {
                              'content-range': `bytes ${start}-${end}/${clip.length}`,
                          }
                        : {}),
                })
                .end(clip.subarray(start, end + 1));
            return;
        }
        const upstream = new URL(xtreamMockServer);
        upstream.pathname = incoming.pathname;
        upstream.search = incoming.search;
        try {
            const result = await fetch(upstream, {
                signal: AbortSignal.timeout(10_000),
            });
            const body = await result.json();
            const action = incoming.searchParams.get('action');
            if (action === 'get_vod_info') {
                body.movie_data.container_extension = null;
                body.movie_data.direct_source =
                    mode === 'direct'
                        ? `${origin}/movie/direct/${body.movie_data.stream_id}.mp4?fixture=1778`
                        : '';
            } else if (action === 'get_vod_streams') {
                for (const item of body) {
                    item.container_extension =
                        mode === 'catalog' ? 'mp4' : null;
                    item.direct_source = '';
                }
            }
            response
                .writeHead(result.status, {
                    'content-type': 'application/json',
                })
                .end(JSON.stringify(body));
        } catch {
            response.writeHead(502).end();
        }
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing fixture port');
    origin = `http://127.0.0.1:${address.port}`;
    return {
        origin,
        mediaRequests,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
                server.closeAllConnections();
            }),
    };
}
