import { resetAll } from './data-store.js';
import type { PerformanceControlState } from './performance-control.js';
import { createXtreamMockApp } from './server.js';
import {
    openAbortableGet,
    postJson,
    requestJson,
    startLoopbackServer,
    waitFor,
} from './testing/http-server.fixture.js';

jest.mock('@faker-js/faker', () => ({
    faker: { seed: jest.fn() },
}));

const TOKEN = 'delay-abort-token';
const AUTH_HEADERS = {
    'x-iptvnator-performance-token': TOKEN,
};

describe('Xtream performance delay cancellation', () => {
    it('aborts an active delay without later dispatch or response lifecycle', async () => {
        resetAll();
        const running = await startLoopbackServer(
            createXtreamMockApp({
                control: { enabled: true, token: TOKEN },
                host: '127.0.0.1',
                port: 0,
            })
        );
        try {
            const rule = await postJson(
                running.origin,
                '/__control/delays',
                TOKEN,
                {
                    id: 'abort-delay',
                    match: {
                        scenario: 'performance-100k',
                        transport: 'direct',
                        action: 'get_live_streams',
                        occurrence: 1,
                        categoryId: '91101',
                    },
                    milliseconds: 100,
                }
            );
            expect(rule.response.status).toBe(201);
            const request = openAbortableGet(
                running.origin,
                '/player_api.php?username=performance&password=performance&action=get_live_streams&category_id=91101'
            );
            await waitFor(async () => {
                expect(
                    (await state(running.origin)).ledger.map(
                        (entry) => entry.status
                    )
                ).toEqual(expect.arrayContaining(['arrived', 'delayed']));
            });

            request.abort();
            await request.completed;
            await waitFor(async () => {
                const snapshot = await state(running.origin);
                expect(snapshot.heldCount).toBe(0);
                expect(snapshot.rules).toEqual([]);
                expect(snapshot.ledger.map((entry) => entry.status)).toEqual(
                    expect.arrayContaining(['aborted'])
                );
            });
            await new Promise((resolve) => setTimeout(resolve, 125));
            const terminal = await state(running.origin);
            expect(
                terminal.ledger.some((entry) => entry.status === 'responded')
            ).toBe(false);
            expect(terminal.occurrences).toEqual([
                expect.objectContaining({
                    action: 'get_live_streams',
                    categoryId: '91101',
                    count: 1,
                }),
            ]);
        } finally {
            await running.close();
            resetAll();
        }
    });

    it('settles an active delay when observations reset', async () => {
        resetAll();
        const running = await startLoopbackServer(
            createXtreamMockApp({
                control: { enabled: true, token: TOKEN },
                host: '127.0.0.1',
                port: 0,
            })
        );
        try {
            await postJson(running.origin, '/__control/delays', TOKEN, {
                id: 'reset-delay',
                match: {
                    scenario: 'performance-100k',
                    transport: 'direct',
                    action: 'get_live_streams',
                    occurrence: 1,
                    categoryId: '91101',
                },
                milliseconds: 100,
            });
            const delayedResponse = fetch(
                `${running.origin}/player_api.php?username=performance&password=performance&action=get_live_streams&category_id=91101`
            );
            await waitFor(async () => {
                expect(
                    (await state(running.origin)).ledger.map(
                        (entry) => entry.status
                    )
                ).toContain('delayed');
            });

            const reset = await postJson(
                running.origin,
                '/__control/reset',
                TOKEN,
                { mode: 'observations' }
            );
            expect(reset.response.status).toBe(200);
            expect((await delayedResponse).status).toBe(409);
            await new Promise((resolve) => setTimeout(resolve, 125));
            expect(await state(running.origin)).toMatchObject({
                heldCount: 0,
                ledger: [],
                occurrences: [],
                rules: [],
            });
        } finally {
            await running.close();
            resetAll();
        }
    });
});

async function state(origin: string): Promise<PerformanceControlState> {
    const result = await requestJson(origin, '/__control/state', {
        headers: AUTH_HEADERS,
    });
    expect(result.response.status).toBe(200);
    return result.body as PerformanceControlState;
}
