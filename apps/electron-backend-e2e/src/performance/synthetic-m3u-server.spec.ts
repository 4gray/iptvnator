/* eslint-disable playwright/expect-expect -- Node assertions define the loopback-only fixture server contract. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSyntheticM3uFixture } from './synthetic-m3u';
import { startSyntheticM3uServer } from './synthetic-m3u-server';

test('serves and primes only the deterministic fixture on ephemeral IPv4 loopback', async () => {
    const fixture = createSyntheticM3uFixture(10_000);
    const server = await startSyntheticM3uServer(fixture);

    try {
        const url = new URL(server.resourceUrl);
        assert.equal(url.protocol, 'http:');
        assert.equal(url.hostname, '127.0.0.1');
        assert.notEqual(url.port, '');
        assert.equal(url.username, '');
        assert.equal(url.password, '');
        assert.equal(server.requestCount(), 0);

        await server.prime();
        assert.equal(server.requestCount(), 1);

        const response = await fetch(server.resourceUrl);
        assert.equal(response.status, 200);
        assert.equal(
            response.headers.get('content-length'),
            String(fixture.bytes)
        );
        assert.equal(await response.text(), fixture.body);
        assert.equal(server.requestCount(), 2);

        const missing = await fetch(`${server.origin}/not-the-fixture.m3u`);
        assert.equal(missing.status, 404);
        assert.equal(server.requestCount(), 2);
    } finally {
        await server.close();
    }
});

test('closes idempotently and rejects priming after close', async () => {
    const server = await startSyntheticM3uServer(
        createSyntheticM3uFixture(10_000)
    );

    await server.close();
    await server.close();
    await assert.rejects(server.prime(), /closed/i);
});
