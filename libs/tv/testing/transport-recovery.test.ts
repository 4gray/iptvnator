import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderTransport } from '@iptvnator/tv/data-access';
import type { Source } from '@iptvnator/tv/util';
const source: Source = {
    id: 'test',
    provider: 'm3u',
    name: 'Fixture',
    url: 'https://provider.invalid/list.m3u',
};

test('backend restart repairs a missing registered target once without changing source credentials', async (t) => {
    let registrations = 0;
    let restarted = false;
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        calls.push(url);
        if (url.endsWith('/provider-targets'))
            return Response.json({ targetId: String(++registrations) });
        if (restarted && new URL(url).searchParams.get('targetId') === '1')
            return Response.json(
                { message: 'Provider target not found' },
                { status: 404 }
            );
        return Response.json({ playlist: { items: [] } });
    });
    const transport = new ProviderTransport('https://backend.invalid');
    await transport.request(source, 'parse', {}, new AbortController().signal);
    restarted = true;
    await transport.request(source, 'parse', {}, new AbortController().signal);
    assert.equal(registrations, 2);
    assert.equal(calls.length, 5);
    assert(calls.at(-1)?.includes('targetId=2'));
});

test('upstream errors and authentication failures never trigger target repair; missing APIs are bounded', async (t) => {
    for (const status of [401, 403, 404, 502]) {
        let registrations = 0;
        t.mock.method(globalThis, 'fetch', async (url: string) => {
            if (url.endsWith('/provider-targets'))
                return Response.json({ targetId: String(++registrations) });
            return Response.json({}, { status });
        });
        const transport = new ProviderTransport('https://backend.invalid');
        await assert.rejects(
            transport.request(source, 'parse', {}, new AbortController().signal)
        );
        assert.equal(registrations, 1);
        t.mock.restoreAll();
    }
    let registrations = 0;
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        if (url.endsWith('/provider-targets'))
            return Response.json({ targetId: String(++registrations) });
        return Response.json({ type: 'ERROR', status: 404 });
    });
    await assert.rejects(
        new ProviderTransport('https://backend.invalid').request(
            source,
            'parse',
            {},
            new AbortController().signal
        )
    );
    assert.equal(registrations, 1);
});

test('a repeatedly missing registered target stops after one repair', async (t) => {
    let registrations = 0;
    t.mock.method(globalThis, 'fetch', async (url: string) => {
        if (url.endsWith('/provider-targets'))
            return Response.json({ targetId: String(++registrations) });
        return Response.json(
            { message: 'Provider target not found' },
            { status: 404 }
        );
    });
    await assert.rejects(
        new ProviderTransport('https://backend.invalid').request(
            source,
            'parse',
            {},
            new AbortController().signal
        )
    );
    assert.equal(registrations, 2);
});
