import { getPortalData, resetAll } from './data-store.js';
import { type PerformanceControlState } from './performance-control.js';
import { createXtreamMockApp } from './server.js';
import {
    postJson,
    requestJson,
    startLoopbackServer,
    type RunningTestServer,
} from './testing/http-server.fixture.js';

jest.mock('@faker-js/faker', () => ({
    faker: { seed: jest.fn() },
}));

const TOKEN = 'security-token';
const ORIGIN = 'http://127.0.0.1:4200';

describe('Xtream performance control request boundary', () => {
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

    it('requires the exact token before handling control preflight', async () => {
        const missing = await controlOptions(running);
        const wrong = await controlOptions(running, `${TOKEN}-wrong`);
        const valid = await controlOptions(running, TOKEN);

        expect(missing.status).toBe(401);
        expect(wrong.status).toBe(401);
        expect(valid.status).toBe(204);
        expect(valid.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('preserves unauthenticated CORS preflight for ordinary routes', async () => {
        const response = await fetch(`${running.origin}/player_api.php`, {
            method: 'OPTIONS',
            headers: {
                origin: ORIGIN,
                'access-control-request-method': 'GET',
            },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('rejects legacy reset without invalidating prepared control state', async () => {
        const prepared = await postJson(
            running.origin,
            '/__control/prepare',
            TOKEN,
            { scenario: 'performance-100k' }
        );
        const cachedBefore = getPortalData('performance', 'performance');

        const reset = await requestJson(running.origin, '/reset', {
            method: 'POST',
        });
        const state = await requestJson(running.origin, '/__control/state', {
            headers: {
                'x-iptvnator-performance-token': TOKEN,
            },
        });

        expect(reset.response.status).toBe(410);
        expect(reset.body).toEqual({
            error: 'use-performance-control-reset',
        });
        expect((state.body as PerformanceControlState).prepared).toEqual(
            prepared.body
        );
        expect(getPortalData('performance', 'performance')).toBe(cachedBefore);
    });
});

describe('Xtream normal reset compatibility', () => {
    afterEach(() => resetAll());

    it('keeps the legacy reset available outside control mode', async () => {
        const running = await startLoopbackServer(
            createXtreamMockApp({ host: '127.0.0.1', port: 0 })
        );
        const cachedBefore = getPortalData('performance', 'performance');
        try {
            const reset = await requestJson(running.origin, '/reset', {
                method: 'POST',
            });

            expect(reset.response.status).toBe(200);
            expect(reset.body).toEqual({ status: 'reset' });
            expect(getPortalData('performance', 'performance')).not.toBe(
                cachedBefore
            );
        } finally {
            await running.close();
        }
    });
});

function controlOptions(
    running: RunningTestServer,
    token?: string
): Promise<Response> {
    return fetch(`${running.origin}/__control/state`, {
        method: 'OPTIONS',
        headers: {
            origin: ORIGIN,
            'access-control-request-method': 'GET',
            'access-control-request-headers': 'x-iptvnator-performance-token',
            ...(token === undefined
                ? {}
                : { 'x-iptvnator-performance-token': token }),
        },
    });
}
