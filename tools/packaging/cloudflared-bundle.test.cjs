const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { mkdtemp, rmdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { bundleCloudflared } = require('./cloudflared-bundle.cjs');

test('a changed upstream asset cannot be installed into the package', async (t) => {
    const target = await mkdtemp(join(tmpdir(), 'iptvnator-cloudflared-test-'));
    t.after(() => rmdir(target));
    t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('changed asset')
    );

    await assert.rejects(
        bundleCloudflared(target, 'win32', 'x64'),
        /SHA-256 mismatch/
    );
    assert.equal(existsSync(join(target, 'cloudflared')), false);
});

test('unsupported package architectures fail before downloading', async (t) => {
    const fetch = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response()
    );
    await assert.rejects(
        bundleCloudflared('unused', 'win32', 'arm64'),
        /No pinned cloudflared release asset for win32-arm64/
    );
    assert.equal(fetch.mock.callCount(), 0);
});
