import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { handleRequest, serveStatic } from '../devserver/server.mjs';

test('static responses stay inside the web root, including through symlinks', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'iptvnator-static-test-'));
    const root = join(fixture, 'www');
    const sibling = join(fixture, 'www-private');
    mkdirSync(root);
    mkdirSync(sibling);
    writeFileSync(join(root, 'index.html'), '<p>Synthetic SPA</p>');
    writeFileSync(join(root, 'local.txt'), 'synthetic public response');
    const privateFile = join(sibling, 'private.txt');
    writeFileSync(privateFile, 'synthetic private response');
    symlinkSync(sibling, join(root, 'escape'), 'junction');
    const server = createServer((req, res) => serveStatic(res, new URL(req.url, 'http://127.0.0.1'), root));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        assert.equal(await fetch(base + '/local.txt').then((res) => res.text()), 'synthetic public response');
        assert.equal(await fetch(base + '/workspace/sources').then((res) => res.text()), '<p>Synthetic SPA</p>');
        for (const path of ['/..%2fwww-private/private.txt', '/escape/private.txt']) {
            const response = await fetch(base + path);
            assert.equal(response.status, 403);
            assert.equal(await response.text(), '');
        }
    } finally {
        await new Promise((resolve) => server.close(resolve));
        rmSync(fixture, { recursive: true, force: true });
    }
});

test('malformed request targets return 400 and the server keeps responding', async () => {
    const server = createServer(handleRequest);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        for (const path of ['http://[', '/%zz']) {
            const status = await new Promise((resolve, reject) => {
                get({ hostname: '127.0.0.1', port, path }, (res) => {
                    res.resume();
                    resolve(res.statusCode);
                }).on('error', reject);
            });
            assert.equal(status, 400);
        }
        const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((res) => res.json());
        assert.equal(health.status, 'ok');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
