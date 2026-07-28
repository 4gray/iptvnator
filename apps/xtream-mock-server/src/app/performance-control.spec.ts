import { resetAll } from './data-store.js';
import { type PerformanceControlState } from './performance-control.js';
import { createXtreamMockApp } from './server.js';
import {
    openAbortableGet,
    postJson,
    requestJson,
    startLoopbackServer,
    waitFor,
    type RunningTestServer,
} from './testing/http-server.fixture.js';

jest.mock('@faker-js/faker', () => ({
    faker: { seed: jest.fn() },
}));

const TOKEN = 'benchmark-token';
const AUTH_HEADERS = {
    'x-iptvnator-performance-token': TOKEN,
};
jest.setTimeout(120_000);

describe('Xtream performance control API', () => {
    let running: RunningTestServer;

    beforeEach(async () => {
        resetAll();
        running = await startLoopbackServer(
            createXtreamMockApp({
                control: { enabled: true, token: TOKEN },
                host: '127.0.0.1',
                port: 0,
            })
        );
    });

    afterEach(async () => {
        await running.close();
        resetAll();
    });

    it('requires the exact token for every control route', async () => {
        const missing = await fetch(`${running.origin}/__control/state`);
        const incorrect = await fetch(`${running.origin}/__control/state`, {
            headers: {
                'x-iptvnator-performance-token': `${TOKEN}-wrong`,
            },
        });
        const valid = await fetch(`${running.origin}/__control/state`, {
            headers: AUTH_HEADERS,
        });

        expect([missing.status, incorrect.status, valid.status]).toEqual([
            401, 401, 200,
        ]);
    });

    it('prepares the exact 100k fixture with a stable redacted manifest', async () => {
        const first = await postJson(
            running.origin,
            '/__control/prepare',
            TOKEN,
            { scenario: 'performance-100k' }
        );
        expect(first.response.status).toBe(200);
        expect(Object.keys(first.body as object)).toEqual([
            'epoch',
            'scenario',
            'seed',
            'counts',
            'bytes',
            'catalogSha256',
        ]);
        expect(first.body).toMatchObject({
            epoch: 1,
            scenario: 'performance-100k',
            seed: 91_001,
            counts: {
                categories: { live: 60, vod: 20, series: 20, total: 100 },
                items: {
                    live: 60_000,
                    vod: 20_000,
                    series: 20_000,
                    total: 100_000,
                },
            },
        });
        expect((first.body as { bytes: number }).bytes).toBeGreaterThan(0);
        expect((first.body as { catalogSha256: string }).catalogSha256).toMatch(
            /^[a-f0-9]{64}$/
        );

        const reset = await postJson(
            running.origin,
            '/__control/reset',
            TOKEN,
            { mode: 'all' }
        );
        expect(reset.response.status).toBe(200);
        const second = await postJson(
            running.origin,
            '/__control/prepare',
            TOKEN,
            { scenario: 'performance-100k' }
        );
        expect(second.body).toMatchObject({
            epoch: 2,
            bytes: (first.body as { bytes: number }).bytes,
            catalogSha256: (first.body as { catalogSha256: string })
                .catalogSha256,
        });
    });

    it('distinguishes observation reset from all-state reset', async () => {
        const prepared = await prepare(running);
        await postJson(running.origin, '/__control/barriers', TOKEN, {
            id: 'future-live',
            match: liveMatch('direct', '91101', 1),
        });
        await fetch(
            `${running.origin}/player_api.php?username=performance&password=performance&action=get_account_info`
        );
        const before = await state(running);
        expect(before.prepared).toEqual(prepared);
        expect(before.rules).toHaveLength(1);
        expect(before.ledger.length).toBeGreaterThan(0);

        await postJson(running.origin, '/__control/reset', TOKEN, {
            mode: 'observations',
        });
        const observationsReset = await state(running);
        expect(observationsReset).toMatchObject({
            epoch: 1,
            prepared,
            rules: [],
            heldIds: [],
            heldCount: 0,
            occurrences: [],
            ledger: [],
        });

        await postJson(running.origin, '/__control/reset', TOKEN, {
            mode: 'all',
        });
        const allReset = await state(running);
        expect(allReset).toMatchObject({
            epoch: 2,
            prepared: null,
            rules: [],
            heldIds: [],
            heldCount: 0,
            occurrences: [],
            ledger: [],
        });
    });

    it('matches category barriers independently of parallel arrival order', async () => {
        await prepare(running);
        await createBarrier(
            running,
            'category-a',
            liveMatch('direct', '91101', 1)
        );
        await createBarrier(
            running,
            'category-b',
            liveMatch('direct', '91102', 1)
        );

        const categoryB = fetch(catalogUrl(running, '91102', 'direct'));
        await expectHeld(running, ['category-b']);
        const categoryA = fetch(catalogUrl(running, '91101', 'direct'));
        await expectHeld(running, ['category-a', 'category-b']);
        await release(running, 'category-a');
        await release(running, 'category-b');

        const [bodyA, bodyB] = await Promise.all([
            categoryA.then((response) => response.json()),
            categoryB.then((response) => response.json()),
        ]);
        expect(bodyA).toHaveLength(1_000);
        expect(bodyB).toHaveLength(1_000);
        const snapshot = await state(running);
        expect(
            snapshot.occurrences.filter(
                (entry) =>
                    entry.action === 'get_live_streams' &&
                    ['91101', '91102'].includes(entry.categoryId)
            )
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ categoryId: '91101', count: 1 }),
                expect.objectContaining({ categoryId: '91102', count: 1 }),
            ])
        );
    });

    it('releases a barrier and records the terminal response', async () => {
        await prepare(running);
        await createBarrier(running, 'account-gate', {
            scenario: 'performance-100k',
            transport: 'direct',
            action: 'get_account_info',
            occurrence: 1,
            categoryId: 'all',
        });
        const request = fetch(
            `${running.origin}/player_api.php?username=performance&password=performance`
        );
        await expectHeld(running, ['account-gate']);
        const releaseResponse = await release(running, 'account-gate');
        expect(releaseResponse.status).toBe(200);
        expect((await request).status).toBe(200);
        await waitFor(async () => {
            const snapshot = await state(running);
            expect(snapshot.heldCount).toBe(0);
            expect(snapshot.ledger.map((entry) => entry.status)).toEqual(
                expect.arrayContaining(['arrived', 'blocked', 'responded'])
            );
        });
    });

    it('settles an aborted held request without leaking it', async () => {
        await prepare(running);
        await createBarrier(
            running,
            'abort-gate',
            liveMatch('direct', '91101', 1)
        );
        const request = openAbortableGet(
            running.origin,
            '/player_api.php?username=performance&password=performance&action=get_live_streams&category_id=91101'
        );
        await expectHeld(running, ['abort-gate']);
        request.abort();
        await request.completed;

        await waitFor(async () => {
            const snapshot = await state(running);
            expect(snapshot.heldCount).toBe(0);
            expect(
                snapshot.ledger.some(
                    (entry) =>
                        entry.action === 'get_live_streams' &&
                        entry.status === 'aborted'
                )
            ).toBe(true);
        });
    });

    it('settles held requests when observations are reset', async () => {
        await prepare(running);
        await createBarrier(
            running,
            'reset-gate',
            liveMatch('direct', '91101', 1)
        );
        const heldResponse = fetch(
            `${running.origin}/player_api.php?username=performance&password=performance&action=get_live_streams&category_id=91101`
        );
        await expectHeld(running, ['reset-gate']);
        const reset = await postJson(
            running.origin,
            '/__control/reset',
            TOKEN,
            { mode: 'observations' }
        );

        expect(reset.response.status).toBe(200);
        expect((await heldResponse).status).toBe(409);
        expect(await state(running)).toMatchObject({
            epoch: 1,
            heldIds: [],
            heldCount: 0,
            occurrences: [],
            ledger: [],
            rules: [],
        });
    });

    it('applies a configured short delay and records its lifecycle', async () => {
        await prepare(running);
        const created = await postJson(
            running.origin,
            '/__control/delays',
            TOKEN,
            {
                id: 'short-delay',
                match: liveMatch('proxy', '91101', 1),
                milliseconds: 1,
            }
        );
        expect(created.response.status).toBe(201);
        const response = await fetch(catalogUrl(running, '91101', 'proxy'));
        expect(response.status).toBe(200);
        const snapshot = await state(running);
        expect(snapshot.heldCount).toBe(0);
        expect(snapshot.ledger.map((entry) => entry.status)).toEqual(
            expect.arrayContaining(['arrived', 'delayed', 'responded'])
        );
    });
});

async function prepare(
    running: RunningTestServer
): Promise<PerformanceControlState['prepared']> {
    const result = await postJson(running.origin, '/__control/prepare', TOKEN, {
        scenario: 'performance-100k',
    });
    expect(result.response.status).toBe(200);
    return result.body as PerformanceControlState['prepared'];
}

async function state(
    running: RunningTestServer
): Promise<PerformanceControlState> {
    const result = await requestJson(running.origin, '/__control/state', {
        headers: AUTH_HEADERS,
    });
    expect(result.response.status).toBe(200);
    return result.body as PerformanceControlState;
}

function liveMatch(
    transport: 'direct' | 'proxy',
    categoryId: string,
    occurrence: number
) {
    return {
        scenario: 'performance-100k',
        transport,
        action: 'get_live_streams',
        occurrence,
        categoryId,
    };
}

async function createBarrier(
    running: RunningTestServer,
    id: string,
    match: ReturnType<typeof liveMatch> | Record<string, unknown>
) {
    const result = await postJson(
        running.origin,
        '/__control/barriers',
        TOKEN,
        { id, match }
    );
    expect(result.response.status).toBe(201);
}

async function release(
    running: RunningTestServer,
    id: string
): Promise<Response> {
    return fetch(`${running.origin}/__control/barriers/${id}/release`, {
        method: 'POST',
        headers: AUTH_HEADERS,
    });
}

async function expectHeld(
    running: RunningTestServer,
    ids: string[]
): Promise<void> {
    await waitFor(async () => {
        const snapshot = await state(running);
        expect(snapshot.heldIds.sort()).toEqual([...ids].sort());
        expect(snapshot.heldCount).toBe(ids.length);
    });
}

function catalogUrl(
    running: RunningTestServer,
    categoryId: string,
    transport: 'direct' | 'proxy'
): string {
    const route = transport === 'direct' ? '/player_api.php' : '/xtream';
    return `${running.origin}${route}?url=ignored&username=performance&password=performance&action=get_live_streams&category_id=${categoryId}`;
}
