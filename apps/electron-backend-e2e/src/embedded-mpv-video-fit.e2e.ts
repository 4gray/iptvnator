import { expect, test, launchElectronApp, closeElectronApp, type LaunchedElectronApp } from './electron-test-fixtures';
import { createServer, type Server } from 'http';
import { once } from 'events';
import { installEmbeddedMpvSessionCapture, getLatestSession } from './embedded-mpv-frame-copy-packaged-fixtures';

const W = 480, H = 270, FPS = 10, FRAME_COUNT = 300;
function clip(): Buffer {
    const chunks: Buffer[] = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
    const ySize = W * H, cSize = (W / 2) * (H / 2);
    for (let frame = 0; frame < FRAME_COUNT; frame++) {
        const y = Buffer.alloc(ySize), u = Buffer.alloc(cSize), v = Buffer.alloc(cSize);
        for (let row = 0; row < H; row++) for (let col = 0; col < W; col++) {
            const edge = row < 24 || row >= H - 24;
            y[row * W + col] = edge ? 76 : col < 24 || col >= W - 24 ? 29 : 150;
        }
        u.fill(84); v.fill(255);
        chunks.push(Buffer.from('FRAME\n'), y, u, v);
    }
    return Buffer.concat(chunks);
}
async function serve(): Promise<{ server: Server; url: string }> {
    const bytes = clip();
    const server = createServer((request, response) => {
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (!range) { response.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': bytes.length, 'Content-Type': 'video/x-yuv4mpeg' }); response.end(request.method === 'HEAD' ? undefined : bytes); return; }
        const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : bytes.length - 1, bytes.length - 1);
        response.writeHead(206, { 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Type': 'video/x-yuv4mpeg' });
        response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Media server bind failed');
    return { server, url: `http://127.0.0.1:${address.port}/ultrawide.y4m` };
}

test.describe('Embedded MPV fit mode runtime', () => {
    for (const engine of ['native', 'frame-copy'] as const) {
        test(`Windows x64 ${engine}: fit commands survive 21:9/32:9 bounds changes; fullscreen and property readback unavailable`, async ({ dataDir }) => {
            test.skip(process.platform !== 'win32' || process.arch !== 'x64', 'Windows x64 only');
            const media = await serve(); let app: LaunchedElectronApp | undefined;
            try {
                app = await launchElectronApp(dataDir, { env: { IPTVNATOR_ENABLE_EMBEDDED_MPV_EXPERIMENT: '1', IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY: engine === 'frame-copy' ? '1' : '0' } });
                const support = await app.mainWindow.evaluate(() => window.electron.getEmbeddedMpvSupport());
                test.skip(!support.supported || (support.engine === 'frame-copy') !== (engine === 'frame-copy'), `Engine unavailable: ${JSON.stringify(support)}`);
                await installEmbeddedMpvSessionCapture(app);
                const session = await app.mainWindow.evaluate(async () => { await window.electron.updateSettings({ embeddedMpvExtraOptions: 'ao=null' }); return window.electron.createEmbeddedMpvSession({ x: 0, y: 0, width: 1280, height: 720 }, 'Synthetic ultrawide clip', 0); });
                await app.mainWindow.evaluate(async ({ id, url }) => { await window.electron.setEmbeddedMpvPaused(id, true); await window.electron.loadEmbeddedMpvPlayback(id, { streamUrl: url, title: 'Synthetic chart', isLive: false }); }, { id: session.id, url: media.url });
                await expect.poll(async () => { const current = await getLatestSession(app!, session.id); return current?.streamUrl === media.url && /playing|paused/.test(current.status) ? current : null; }, { timeout: 15000 }).toBeTruthy();
                for (const width of [2560, 3840]) {
                    await app.mainWindow.evaluate(async ({ id, width }) => window.electron.setEmbeddedMpvBounds(id, { x: 0, y: 0, width, height: 1080 }), { id: session.id, width });
                    for (const mode of ['original', 'crop', 'stretch'] as const) {
                        const result = await app.mainWindow.evaluate(async ({ id, mode }) => window.electron.setEmbeddedMpvVideoFit?.(id, mode), { id: session.id, mode });
                        expect(result, `${engine} ${width}x1080 ${mode}: command returns session`).toBeTruthy();
                        await app.mainWindow.evaluate(async ({ id, width }) => window.electron.setEmbeddedMpvBounds(id, { x: 0, y: 0, width, height: 1080 }), { id: session.id, width: width + 16 });
                        await app.mainWindow.evaluate(async ({ id, width }) => window.electron.setEmbeddedMpvBounds(id, { x: 0, y: 0, width, height: 1080 }), { id: session.id, width });
                        await expect.poll(async () => (await getLatestSession(app!, session.id))?.status).toMatch(/playing|paused/);
                    }
                }
                const restore = await app.mainWindow.evaluate(async id => window.electron.setEmbeddedMpvVideoFit?.(id, 'original'), session.id);
                expect(restore).toBeTruthy();
                await app.mainWindow.evaluate(async id => window.electron.setEmbeddedMpvBounds(id, { x: 0, y: 0, width: 1920, height: 1080 }), session.id);
                await expect.poll(async () => (await getLatestSession(app!, session.id))?.status).toMatch(/playing|paused/);
            } finally {
                if (app) await closeElectronApp(app);
                await new Promise<void>((resolve, reject) => media.server.close(error => error ? reject(error) : resolve()));
            }
        });
    }
});
