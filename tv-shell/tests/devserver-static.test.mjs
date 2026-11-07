import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { serveStatic } from '../devserver/server.mjs';

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
