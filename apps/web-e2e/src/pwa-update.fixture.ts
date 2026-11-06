import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve, sep } from 'node:path';
import { lookup } from 'mrmime';
import { workspaceRoot } from '@nx/devkit';

export async function servePwaUpdateFixture() {
    const root = join(workspaceRoot, 'dist/apps/web');
    const index = await readFile(join(root, 'index.html'), 'utf8');
    const updatedIndex = index.replace(
        '<head>',
        '<head><meta name="audit-update" content="b">'
    );
    const originalManifest = JSON.parse(
        await readFile(join(root, 'ngsw.json'), 'utf8')
    );
    const nextManifest = structuredClone(originalManifest);
    nextManifest.hashTable['/index.html'] = createHash('sha1')
        .update(updatedIndex)
        .digest('hex');
    const state = {
        updated: false,
        failIndex: false,
        failManifest: false,
        corrupt: false,
    };
    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url ?? '/', 'http://localhost');
            response.setHeader('Cache-Control', 'no-store');
            if (url.pathname === '/assets/app-config.js') {
                response.setHeader('Content-Type', 'application/javascript');
                response.end('window.__IPTVNATOR_CONFIG__ = {};');
                return;
            }
            if (url.pathname === '/ngsw.json') {
                if (state.failManifest) {
                    response.writeHead(503).end();
                    return;
                }
                const manifest = structuredClone(
                    state.updated ? nextManifest : originalManifest
                );
                if (state.corrupt)
                    manifest.hashTable['/index.html'] = '0'.repeat(40);
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify(manifest));
                return;
            }
            if (
                url.pathname === '/index.html' ||
                !url.pathname.split('/').pop()?.includes('.')
            ) {
                if (state.failIndex && url.pathname === '/index.html') {
                    response.writeHead(503).end();
                    return;
                }
                response.setHeader('Content-Type', 'text/html');
                response.end(state.updated ? updatedIndex : index);
                return;
            }
            const path = resolve(root, '.' + decodeURIComponent(url.pathname));
            if (!path.startsWith(root + sep)) {
                response.writeHead(404).end();
                return;
            }
            response.setHeader(
                'Content-Type',
                lookup(path) ?? 'application/octet-stream'
            );
            response.end(await readFile(path));
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing fixture address');
    return {
        state,
        origin: `http://127.0.0.1:${address.port}`,
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}
