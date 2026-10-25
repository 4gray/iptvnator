import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createProvider, ProviderTransport } from '@iptvnator/tv/data-access';
import { Media, Source } from '@iptvnator/tv/util';

const source: Source = {
    id: 'epg-source',
    provider: 'stalker',
    name: 'Guide fixture',
    url: 'https://portal.invalid/server/load.php',
    endpoint: 'https://portal.invalid/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    full: false,
};
const channel = (id: string): Media => ({
    id: `epg-source:live:${id}`,
    sourceId: source.id,
    providerId: id,
    kind: 'live',
    title: `Channel ${id}`,
    raw: {},
});
beforeEach((context) => {
    if ('mock' in context) context.mock.method(Date, 'now', () => 150_000);
});
const programme = (name: string) => ({
    name,
    descr: 'Description',
    start_timestamp: String(Date.now() / 1000 - 60),
    stop_timestamp: String(Date.now() / 1000 + 60),
});
const bulk = (name: string) => ({ js: { data: { a: [programme(name)] } } });
const signal = () => new AbortController().signal;
const aborted = { name: 'AbortError' };

function deferred() {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>((done) => (resolve = done));
    return { promise, resolve };
}

class Transport extends ProviderTransport {
    calls: { action: string; signal: AbortSignal }[] = [];
    constructor(
        private respond: (
            params: Record<string, string | number>,
            signal: AbortSignal
        ) => unknown
    ) {
        super('https://backend.invalid');
    }
    override async request(
        _source: Source,
        _route: 'stalker' | 'xtream' | 'parse',
        params: Record<string, string | number>,
        signal: AbortSignal
    ) {
        this.calls.push({ action: String(params.action), signal });
        return this.respond(params, signal);
    }
}
const provider = (transport: Transport) =>
    createProvider({ ...source }, transport, async () => undefined);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('concurrent grid and preview share bulk; cancelling preview keeps grid request alive', async () => {
    const pending = deferred();
    const transport = new Transport(() => pending.promise);
    const client = provider(transport);
    try {
        const preview = new AbortController();
        const first = client.epg(channel('a'), preview.signal);
        const rejection = assert.rejects(first, aborted);
        const second = client.epg(channel('a'), signal());
        await tick();
        assert.equal(transport.calls.length, 1);
        preview.abort();
        await rejection;
        assert.equal(transport.calls[0].signal.aborted, false);
        pending.resolve(bulk('Shared'));
        assert.deepEqual(await second, [
            {
                title: 'Shared',
                description: 'Description',
                start: 90_000,
                end: 210_000,
            },
        ]);
        await client.epg(channel('a'), signal());
        assert.equal(transport.calls.length, 1);
    } finally {
        client.dispose();
    }
});

test('last subscriber cancellation aborts bulk and late completion cannot replace a newer cache', async () => {
    const old = deferred();
    const next = deferred();
    let requests = 0;
    const transport = new Transport(() =>
        ++requests === 1 ? old.promise : next.promise
    );
    const client = provider(transport);
    try {
        const owner = new AbortController();
        const first = client.epg(channel('a'), owner.signal);
        const rejection = assert.rejects(first, aborted);
        await tick();
        owner.abort();
        await rejection;
        assert.equal(transport.calls[0].signal.aborted, true);
        const second = client.epg(channel('a'), signal());
        await tick();
        assert.equal(requests, 2);
        next.resolve(bulk('Fresh'));
        assert.equal((await second)[0].title, 'Fresh');
        old.resolve(bulk('Abandoned'));
        await tick();
        assert.equal(
            (await client.epg(channel('a'), signal()))[0].title,
            'Fresh'
        );
        assert.equal(requests, 2);
    } finally {
        client.dispose();
    }
});

test('dispose immediately rejects all bulk subscribers even when transport ignores cancellation', async () => {
    const pending = deferred();
    const transport = new Transport(() => pending.promise);
    const client = provider(transport);
    const first = assert.rejects(client.epg(channel('a'), signal()), aborted);
    const second = assert.rejects(client.epg(channel('b'), signal()), aborted);
    await tick();
    client.dispose();
    await Promise.all([first, second]);
    assert.equal(transport.calls[0].signal.aborted, true);
    pending.resolve(bulk('Too late'));
    await tick();
    await assert.rejects(client.epg(channel('a'), signal()), aborted);
    assert.equal(transport.calls.length, 1);
});

test('bulk cache refreshes on demand after five minutes, including empty responses', async (context) => {
    let now = 1_000;
    context.mock.method(Date, 'now', () => now);
    let requests = 0;
    const transport = new Transport((params) => {
        if (params.action === 'get_epg_info') {
            requests++;
            return requests === 1 ? { js: { data: {} } } : bulk('Refreshed');
        }
        return { js: { data: [programme('Short')] } };
    });
    const client = provider(transport);
    try {
        assert.equal(
            (await client.epg(channel('a'), signal()))[0].title,
            'Short'
        );
        now += 299_999;
        await client.epg(channel('a'), signal());
        assert.equal(requests, 1);
        now++;
        assert.equal(
            (await client.epg(channel('a'), signal()))[0].title,
            'Refreshed'
        );
        assert.equal(requests, 2);
    } finally {
        client.dispose();
    }
});

test('missing bulk channel falls back to short EPG with timestamp normalization intact', async () => {
    const transport = new Transport((params) => {
        if (params.action === 'get_epg_info') return bulk('Other channel');
        assert.equal(params.ch_id, 'b');
        assert.equal(params.size, 12);
        return {
            js: {
                data: [
                    {
                        title: 'Local dates',
                        time: '2026-10-25 10:00:00',
                        time_to: '2026-10-25 11:00:00',
                    },
                    { name: 'Invalid', time: 'bad', time_to: 'bad' },
                ],
            },
        };
    });
    const client = provider(transport);
    try {
        const result = await client.epg(channel('b'), signal());
        assert.equal(result.length, 1);
        assert.equal(result[0].title, 'Local dates');
        assert.equal(result[0].start, Date.parse('2026-10-25T10:00:00'));
        assert.deepEqual(
            transport.calls.map((call) => call.action),
            ['get_epg_info', 'get_short_epg']
        );
    } finally {
        client.dispose();
    }
});

test('failed bulk lookup allows short EPG and a later bulk retry', async () => {
    let requests = 0;
    const transport = new Transport((params) => {
        if (params.action === 'get_epg_info') {
            if (++requests === 1) throw new Error('Unavailable');
            return bulk('Recovered');
        }
        return { js: [programme('Short')] };
    });
    const client = provider(transport);
    try {
        assert.equal(
            (await client.epg(channel('a'), signal()))[0].title,
            'Short'
        );
        assert.equal(
            (await client.epg(channel('a'), signal()))[0].title,
            'Recovered'
        );
    } finally {
        client.dispose();
    }
});

test('an already cancelled EPG request never starts bulk or fallback', async () => {
    const transport = new Transport(() => bulk('Unexpected'));
    const client = provider(transport);
    try {
        const owner = new AbortController();
        owner.abort();
        await assert.rejects(client.epg(channel('a'), owner.signal), aborted);
        assert.equal(transport.calls.length, 0);
    } finally {
        client.dispose();
    }
});

for (const kind of ['invalid', 'expired', 'future'] as const) {
    test(`${kind} bulk EPG falls back to the current short programme and preserves valid bulk entries`, async () => {
        const entry = {
            ...programme('Bulk'),
            start_timestamp:
                kind === 'invalid' ? 'bad' : kind === 'expired' ? '10' : '300',
            stop_timestamp:
                kind === 'invalid' ? 'bad' : kind === 'expired' ? '20' : '400',
        };
        const transport = new Transport((params) =>
            params.action === 'get_epg_info'
                ? { js: { data: { a: [entry] } } }
                : {
                      js: [
                          programme('Current'),
                          { ...entry, name: 'Duplicate bulk start' },
                      ],
                  }
        );
        const client = provider(transport);
        try {
            const programs = await client.epg(channel('a'), signal());
            assert.ok(
                programs.some(
                    (p) =>
                        p.title === 'Current' &&
                        p.start <= Date.now() &&
                        p.end > Date.now()
                )
            );
            assert.equal(
                programs.some((p) => p.title === 'Bulk'),
                kind !== 'invalid'
            );
            assert.equal(
                programs.some((p) => p.title === 'Duplicate bulk start'),
                false
            );
            assert.deepEqual(
                transport.calls.map((c) => c.action),
                ['get_epg_info', 'get_short_epg']
            );
        } finally {
            client.dispose();
        }
    });
}

test('a failed short fallback retains a valid future bulk guide', async () => {
    const transport = new Transport((params) => {
        if (params.action === 'get_epg_info')
            return {
                js: {
                    data: {
                        a: [
                            {
                                ...programme('Future'),
                                start_timestamp: '300',
                                stop_timestamp: '400',
                            },
                        ],
                    },
                },
            };
        throw new Error('Short guide unavailable');
    });
    const client = provider(transport);
    try {
        assert.equal(
            (await client.epg(channel('a'), signal()))[0].title,
            'Future'
        );
        assert.deepEqual(
            transport.calls.map((c) => c.action),
            ['get_epg_info', 'get_short_epg']
        );
    } finally {
        client.dispose();
    }
});
