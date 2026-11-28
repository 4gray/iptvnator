import assert from 'node:assert/strict';
import { beforeEach, test, TestContext } from 'node:test';
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

/** Lets a row run for `ms` of mocked time; undefined if it has not settled. */
async function settle(
    context: TestContext,
    row: Promise<{ title: string }[]>,
    ms: number
) {
    let rows: { title: string }[] | undefined;
    row.then(
        (value) => (rows = value),
        () => undefined
    );
    await tick();
    context.mock.timers.tick(ms);
    await tick();
    await tick();
    return rows;
}

test('a slow bulk guide does not hold back a guide row; later rows reuse the same download', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred();
    const transport = new Transport((params) =>
        params.action === 'get_epg_info'
            ? pending.promise
            : { js: [programme('Short')] }
    );
    const client = provider(transport);
    try {
        // A row's own deadline is longer than the wait budget: the row must
        // fall back to its short EPG instead of failing with the bulk guide.
        const first = client.epg(channel('a'), signal());
        let rows: { title: string }[] | undefined;
        first.then(
            (value) => (rows = value),
            () => undefined
        );
        await tick();
        context.mock.timers.tick(3000);
        await tick();
        await tick();
        assert.ok(rows, 'the row is still waiting for the bulk guide');
        assert.equal(rows[0].title, 'Short');
        assert.deepEqual(
            transport.calls.map((call) => call.action),
            ['get_epg_info', 'get_short_epg']
        );
        assert.equal(transport.calls[0].signal.aborted, false);
        // The next row joins the running download rather than restarting it.
        const second = client.epg(channel('a'), signal());
        await tick();
        pending.resolve(bulk('Bulk'));
        assert.equal((await second)[0].title, 'Bulk');
        assert.equal(
            transport.calls.filter((call) => call.action === 'get_epg_info')
                .length,
            1
        );
    } finally {
        client.dispose();
    }
});

test('once the bulk guide is late, later rows skip the wait until it lands', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred();
    const transport = new Transport((params) =>
        params.action === 'get_epg_info'
            ? pending.promise
            : { js: [programme('Short')] }
    );
    const client = provider(transport);
    try {
        assert.equal(
            (
                await settle(context, client.epg(channel('a'), signal()), 3000)
            )?.[0].title,
            'Short'
        );
        // No second three-second wait for the next row.
        assert.equal(
            (await settle(context, client.epg(channel('b'), signal()), 0))?.[0]
                .title,
            'Short'
        );
        pending.resolve(bulk('Bulk'));
        await tick();
        assert.equal(
            (await client.epg(channel('a'), signal()))[0].title,
            'Bulk'
        );
        assert.equal(
            transport.calls.filter((call) => call.action === 'get_epg_info')
                .length,
            1
        );
    } finally {
        client.dispose();
    }
});

test('a failed short guide uses a bulk guide that landed while it was loading', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const slowBulk = deferred();
    let failShort!: (error: Error) => void;
    const short = new Promise((_, reject) => (failShort = reject));
    const transport = new Transport((params) =>
        params.action === 'get_epg_info' ? slowBulk.promise : short
    );
    const client = provider(transport);
    try {
        const row = client.epg(channel('a'), signal());
        await tick();
        context.mock.timers.tick(3000);
        await tick();
        assert.deepEqual(
            transport.calls.map((call) => call.action),
            ['get_epg_info', 'get_short_epg']
        );
        // The bulk guide lands while the short request is still running,
        // then the short request fails: the row must not report an error.
        slowBulk.resolve(bulk('Bulk'));
        await tick();
        failShort(new Error('Short guide unavailable'));
        assert.equal((await row)[0].title, 'Bulk');
    } finally {
        client.dispose();
    }
});

test('cancelling one late row keeps later rows from waiting on the running download', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred();
    const transport = new Transport((params) =>
        params.action === 'get_epg_info'
            ? pending.promise
            : { js: [programme('Short')] }
    );
    const client = provider(transport);
    try {
        const first = new AbortController();
        assert.ok(
            await settle(context, client.epg(channel('a'), first.signal), 3000)
        );
        // A second row still holds the download when the first is cancelled.
        assert.ok(await settle(context, client.epg(channel('b'), signal()), 0));
        first.abort();
        await tick();
        assert.equal(
            (await settle(context, client.epg(channel('c'), signal()), 0))?.[0]
                .title,
            'Short',
            'the next row waited again for the already-late download'
        );
        assert.equal(transport.calls[0].signal.aborted, false);
        assert.equal(
            transport.calls.filter((call) => call.action === 'get_epg_info')
                .length,
            1
        );
    } finally {
        client.dispose();
    }
});
