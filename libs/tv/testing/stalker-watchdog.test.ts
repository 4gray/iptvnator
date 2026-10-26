import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StalkerSession, ProviderTransport } from '@iptvnator/tv/data-access';
import { Source } from '@iptvnator/tv/util';

const configuration = (): Source => ({
    id: 'watchdog',
    provider: 'stalker',
    name: 'Synthetic',
    url: 'https://portal.invalid/server/load.php',
    endpoint: 'https://portal.invalid/server/load.php',
    full: true,
    token: 'stored',
    macAddress: '00:1A:79:00:00:01',
});
const live = { type: 'itv', action: 'create_link', cmd: 'ffmpeg /live' };
class Transport extends ProviderTransport {
    calls: Record<string, string | number>[] = [];
    constructor(
        private reply: (
            p: Record<string, string | number>
        ) => unknown = () => ({ js: {} })
    ) {
        super('https://backend.invalid');
    }
    override async request(
        _source: Source,
        _route: 'stalker' | 'xtream' | 'parse',
        params: Record<string, string | number>
    ) {
        this.calls.push(params);
        return this.reply(params);
    }
}
test('Live initializes watchdog before links, refreshes it and stops keepalive on dispose', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const transport = new Transport();
    const session = new StalkerSession(
        configuration(),
        transport,
        async () => undefined
    );
    const signal = new AbortController().signal;
    try {
        await session.request(live, signal);
        assert.deepEqual(
            transport.calls.map((p) => p.action),
            ['get_events', 'create_link']
        );
        assert.deepEqual(transport.calls[0], {
            type: 'watchdog',
            action: 'get_events',
            event_active_id: '0',
            cur_play_type: '0',
            init: '1',
            macAddress: '00:1A:79:00:00:01',
            token: 'stored',
        });
        await session.request(live, signal);
        assert.equal(transport.calls[2].init, '0');
        t.mock.timers.tick(25000);
        await new Promise<void>((r) => setImmediate(r));
        assert.equal(transport.calls.at(-1)?.init, '0');
        session.dispose();
        const count = transport.calls.length;
        t.mock.timers.tick(50000);
        assert.equal(transport.calls.length, count);
    } finally {
        session.dispose();
    }
});
test('unsupported watchdog is best effort; simple portals and VOD do not ping', async () => {
    for (const [full, type, expected] of [
        [true, 'itv', 1],
        [false, 'itv', 0],
        [true, 'vod', 0],
    ] as const) {
        const transport = new Transport((p) => {
            if (p.action === 'get_events') throw new Error('Unsupported');
            return { js: { cmd: 'https://media.invalid/live.m3u8' } };
        });
        const session = new StalkerSession(
            { ...configuration(), full },
            transport,
            async () => undefined
        );
        try {
            await session.request(
                { ...live, type },
                new AbortController().signal
            );
            assert.equal(
                transport.calls.filter((p) => p.action === 'get_events').length,
                expected
            );
            assert.equal(transport.calls.at(-1)?.action, 'create_link');
        } finally {
            session.dispose();
        }
    }
});
test('expired Live link session initializes the repaired token before retrying create_link', async () => {
    const transport = new Transport((p) => {
        if (p.action === 'handshake')
            return { js: { token: 'fresh', random: 'synthetic' } };
        if (p.action === 'get_profile') return { js: { id: 1, status: 0 } };
        if (p.action === 'create_link' && p.token === 'stored')
            return 'Authorization failed.';
        return { js: {} };
    });
    const session = new StalkerSession(
        configuration(),
        transport,
        async () => undefined
    );
    try {
        await session.request(live, new AbortController().signal);
        const retriedLink = transport.calls.findIndex(
            (p) => p.action === 'create_link' && p.token === 'fresh'
        );
        assert.ok(retriedLink > 0);
        assert.equal(transport.calls[retriedLink - 1].action, 'get_events');
        assert.equal(transport.calls[retriedLink - 1].init, '1');
        assert.equal(transport.calls[retriedLink - 1].token, 'fresh');
    } finally {
        session.dispose();
    }
});

test('concurrent Live resolutions share initialization and cancellation suppresses the cancelled link', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const transport = new Transport((p) =>
        p.action === 'get_events' ? gate.then(() => ({ js: {} })) : { js: {} }
    );
    const session = new StalkerSession(
        configuration(),
        transport,
        async () => undefined
    );
    const cancelled = new AbortController();
    try {
        const first = session.request(live, cancelled.signal);
        const second = session.request(live, new AbortController().signal);
        cancelled.abort();
        release();
        await assert.rejects(first, { name: 'AbortError' });
        await second;
        assert.equal(
            transport.calls.filter((p) => p.action === 'get_events').length,
            1
        );
        assert.equal(
            transport.calls.filter((p) => p.action === 'create_link').length,
            1
        );
    } finally {
        session.dispose();
    }
});

test('keepalive repairs an expired token, initializes it and continues its timer', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let expired = false;
    let initialized!: () => void;
    const reinitialized = new Promise<void>((resolve) => {
        initialized = resolve;
    });
    const transport = new Transport((p) => {
        if (p.action === 'get_events' && p.init === '1' && p.token === 'fresh')
            initialized();
        if (p.action === 'handshake')
            return { js: { token: 'fresh', random: 'synthetic' } };
        if (p.action === 'get_profile') return { js: { id: 1, status: 0 } };
        if (expired && p.action === 'get_events' && p.token === 'stored')
            return 'Authorization failed.';
        return { js: {} };
    });
    const session = new StalkerSession(
        configuration(),
        transport,
        async () => undefined
    );
    try {
        await session.request(live, new AbortController().signal);
        expired = true;
        t.mock.timers.tick(25000);
        await reinitialized;
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(transport.calls.at(-1)?.init, '1');
        assert.equal(transport.calls.at(-1)?.token, 'fresh');
        const count = transport.calls.length;
        t.mock.timers.tick(25000);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(transport.calls.length, count + 1);
        assert.equal(transport.calls.at(-1)?.init, '0');
    } finally {
        session.dispose();
    }
});
