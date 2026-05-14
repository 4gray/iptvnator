import { createServer, Server } from 'http';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
    benchmarkHttpDownload,
    canAccelerateUrl,
    downloadWithAcceleratedHttp,
    resolveAcceleratedPlaybackUrl,
} from './accelerated-http-download.service';

describe('accelerated-http-download.service', () => {
    let server: Server;
    let baseUrl: string;
    let tempDir: string;
    const payload = Buffer.from(
        Array.from({ length: 1024 * 1024 + 123 }, (_, index) => index % 251)
    );

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'iptvnator-accelerated-'));
        server = createServer((request, response) => {
            if (request.url === '/redirect') {
                response.statusCode = 302;
                response.setHeader('Location', '/media');
                response.end();
                return;
            }

            if (request.url === '/no-range') {
                response.statusCode = 200;
                response.setHeader('Content-Length', String(payload.length));
                response.end(payload);
                return;
            }

            if (request.url !== '/media') {
                response.statusCode = 404;
                response.end('not found');
                return;
            }

            const range = request.headers.range;
            if (!range) {
                response.statusCode = 200;
                response.setHeader('Content-Length', String(payload.length));
                response.end(payload);
                return;
            }

            const match = range.match(/^bytes=(\d+)-(\d+)$/);
            if (!match) {
                response.statusCode = 416;
                response.end();
                return;
            }

            const start = Number.parseInt(match[1], 10);
            const end = Math.min(
                Number.parseInt(match[2], 10),
                payload.length - 1
            );
            const chunk = payload.subarray(start, end + 1);

            response.statusCode = 206;
            response.setHeader(
                'Content-Range',
                `bytes ${start}-${end}/${payload.length}`
            );
            response.setHeader('Content-Length', String(chunk.length));
            response.setHeader('Content-Type', 'video/mp4');
            response.end(chunk);
        });

        await new Promise<void>((resolve) => server.listen(0, resolve));
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Test server did not bind to a TCP port');
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
        await rm(tempDir, { force: true, recursive: true });
    });

    it('downloads a seekable HTTP resource with parallel Range chunks', async () => {
        const progress: number[] = [];
        const filePath = join(tempDir, 'movie.mp4');

        const result = await downloadWithAcceleratedHttp({
            url: `${baseUrl}/media`,
            filePath,
            chunkBytes: 128 * 1024,
            parallelism: 3,
            onProgress: (snapshot) => {
                progress.push(snapshot.bytesDownloaded);
            },
        });

        expect(result.totalBytes).toBe(payload.length);
        expect(result.bytesDownloaded).toBe(payload.length);
        expect(result.chunks).toBeGreaterThan(1);
        expect(progress.at(-1)).toBe(payload.length);
        await expect(readFile(filePath)).resolves.toEqual(payload);
    });

    it('uses the redirected direct URL discovered during the Range probe', async () => {
        const filePath = join(tempDir, 'redirected.mp4');

        const result = await downloadWithAcceleratedHttp({
            url: `${baseUrl}/redirect`,
            filePath,
            chunkBytes: 256 * 1024,
            parallelism: 2,
        });

        expect(result.directUrl).toBe(`${baseUrl}/media`);
        await expect(readFile(filePath)).resolves.toEqual(payload);
    });

    it('reports whether playback URLs can be accelerated without downloading the file', async () => {
        await expect(canAccelerateUrl(`${baseUrl}/media`)).resolves.toBe(true);
        await expect(canAccelerateUrl(`${baseUrl}/no-range`)).resolves.toBe(
            false
        );

        await expect(
            resolveAcceleratedPlaybackUrl(`${baseUrl}/redirect`)
        ).resolves.toMatchObject({
            accelerated: true,
            rangeSupported: true,
            status: 206,
            totalBytes: payload.length,
            url: `${baseUrl}/media`,
        });
    });

    it('benchmarks a bounded Range read with timing and throughput metrics', async () => {
        const result = await benchmarkHttpDownload({
            url: `${baseUrl}/media`,
            maxBytes: 128 * 1024,
        });

        expect(result.ok).toBe(true);
        expect(result.status).toBe(206);
        expect(result.rangeSupported).toBe(true);
        expect(result.bytesRead).toBe(128 * 1024);
        expect(result.totalBytes).toBe(payload.length);
        expect(result.throughputBytesPerSecond).toBeGreaterThan(0);
        expect(result.samples.length).toBeGreaterThan(0);
    });
});
