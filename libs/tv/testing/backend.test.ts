import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    backendUrl,
    checkBackend,
    discoveryCandidates,
    identifyBackend,
} from '@iptvnator/tv/data-access';
test('discovery stays in the actual private /24 or smaller subnet and never scans a public or unknown network', () => {
    const subnet = discoveryCandidates({
        ipAddress: '192.168.1.130',
        netmask: '255.255.255.252',
    });
    assert.equal(subnet.length, 6);
    assert(subnet.includes('http://192.168.1.129:3335'));
    assert(!subnet.some((x) => x.includes('192.168.1.130')));
    assert.equal(
        discoveryCandidates({ ipAddress: '8.8.8.8', netmask: '255.255.255.0' })
            .length,
        3
    );
    assert.equal(
        discoveryCandidates({ ipAddress: '10.0.0.1', netmask: '255.0.0.0' })
            .length,
        3
    );
    assert(
        discoveryCandidates({
            ipAddress: '192.168.1.44',
            netmask: '255.255.255.0',
        }).length < 770
    );
    assert.throws(() => backendUrl('http://host/?password=secret'));
});
test('backend recognition rejects unrelated health pages and never sends secrets before identification', async (t) => {
    const requests: RequestInit[] = [];
    t.mock.method(
        globalThis,
        'fetch',
        async (_input: unknown, init?: RequestInit) => {
            requests.push(init!);
            return Response.json({ status: 'ok' });
        }
    );
    await assert.rejects(
        checkBackend(
            'http://backend.example',
            'secret',
            new AbortController().signal
        )
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers, undefined);
});
test('connected means identity and authorized API checks succeed, with cancellation forwarded', async (t) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    t.mock.method(
        globalThis,
        'fetch',
        async (input: unknown, init?: RequestInit) => {
            calls.push({ url: String(input), init });
            return Response.json(
                String(input).endsWith('/check')
                    ? { service: 'iptvnator', connected: true }
                    : {
                          service: 'iptvnator',
                          protocol: 1,
                          pairing: true,
                          auth: 'token',
                      }
            );
        }
    );
    const info = await checkBackend(
        'http://backend.example/api/',
        'secret',
        new AbortController().signal
    );
    assert.equal(info.url, 'http://backend.example/api');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].init?.headers, {
        Authorization: 'Bearer secret',
    });
    assert.equal(calls[0].init?.redirect, 'error');
    assert(calls[0].init?.signal);
});
test('identification rejects malformed advertised capabilities', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
        Response.json({
            service: 'iptvnator',
            protocol: 99,
            pairing: true,
            auth: 'none',
        })
    );
    await assert.rejects(
        identifyBackend('http://backend.example', new AbortController().signal)
    );
});
