import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
    countJourneyMockRoutes,
    describeJourneyMockRoute,
    startJourneyMockRequestLedger,
} from './journey-mock-request-ledger';

test('routes keep the Xtream action but never the credentials', () => {
    assert.equal(
        describeJourneyMockRoute(
            '/player_api.php?username=user1&password=pass1&action=get_live_streams&category_id=3'
        ),
        '/player_api.php?action=get_live_streams'
    );
    assert.equal(
        describeJourneyMockRoute(
            '/player_api.php?username=user1&password=pass1'
        ),
        '/player_api.php'
    );
    assert.equal(
        describeJourneyMockRoute('/live/user1/pass1/1001.m3u8'),
        '/live/:username/:password/1001.m3u8'
    );
    assert.equal(
        describeJourneyMockRoute('/movie/user1/pass1/2001.mp4?token=x'),
        '/movie/:username/:password/2001.mp4'
    );
    assert.equal(describeJourneyMockRoute('/playlist.m3u'), '/playlist.m3u');
    assert.equal(describeJourneyMockRoute(undefined), '/');
});

test('counts requests per route in a stable order', () => {
    assert.deepEqual(
        countJourneyMockRoutes([
            { epochMs: 1, method: 'GET', route: '/b', sequence: 0 },
            { epochMs: 2, method: 'GET', route: '/a', sequence: 1 },
            { epochMs: 3, method: 'GET', route: '/b', sequence: 2 },
        ]),
        { '/a': 1, '/b': 2 }
    );
});

async function startUpstream(): Promise<{ origin: string; server: Server }> {
    const server = createServer((request, response) => {
        response.setHeader('x-upstream-host', request.headers.host ?? '');
        response.end(`upstream:${request.method}:${request.url}`);
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve())
    );
    const { port } = server.address() as AddressInfo;
    return { origin: `http://127.0.0.1:${port}`, server };
}

test('forwards every request to the mock and records it from a mark', async () => {
    const upstream = await startUpstream();
    const ledger = await startJourneyMockRequestLedger(upstream.origin);
    try {
        assert.notEqual(ledger.origin, upstream.origin);
        const first = await fetch(`${ledger.origin}/playlist.m3u`);
        assert.equal(await first.text(), 'upstream:GET:/playlist.m3u');
        assert.equal(
            first.headers.get('x-upstream-host'),
            new URL(upstream.origin).host
        );
        const mark = ledger.mark();
        assert.equal(mark, 1);
        const second = await fetch(
            `${ledger.origin}/player_api.php?username=u&password=p&action=get_account_info`
        );
        assert.equal(
            await second.text(),
            'upstream:GET:/player_api.php?username=u&password=p&action=get_account_info'
        );
        const since = ledger.since(mark);
        assert.equal(since.length, 1);
        assert.equal(
            since[0]?.route,
            '/player_api.php?action=get_account_info'
        );
        assert.equal(since[0]?.method, 'GET');
        assert.equal(since[0]?.sequence, 1);
        assert.ok(!JSON.stringify(ledger.since(0)).includes('password'));
    } finally {
        await ledger.close();
        await new Promise((resolve) => upstream.server.close(resolve));
    }
});

test('answers 502 when the mock is gone and refuses non-HTTP targets', async () => {
    const upstream = await startUpstream();
    await new Promise((resolve) => upstream.server.close(resolve));
    const ledger = await startJourneyMockRequestLedger(upstream.origin);
    try {
        const response = await fetch(`${ledger.origin}/health`);
        assert.equal(response.status, 502);
        assert.equal(ledger.mark(), 1);
    } finally {
        await ledger.close();
    }
    await assert.rejects(
        startJourneyMockRequestLedger('https://127.0.0.1:1'),
        /http-only/
    );
});
