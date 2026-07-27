import {
    PERFORMANCE_CONTROL_LIMITS,
    type PerformanceControlState,
} from './performance-control.js';
import { resetAll } from './data-store.js';
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

const TOKEN = 'validation-token';
const AUTH_HEADERS = {
    'x-iptvnator-performance-token': TOKEN,
};
jest.setTimeout(60_000);

describe('Xtream performance control validation and bounds', () => {
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

    it.each([
        ['/__control/prepare', {}, 400],
        [
            '/__control/prepare',
            { scenario: 'performance-100k', extra: true },
            400,
        ],
        ['/__control/prepare', { scenario: 'large' }, 400],
        ['/__control/reset', { mode: 'observations', extra: true }, 400],
        ['/__control/reset', { mode: 'wrong' }, 400],
        ['/__control/barriers', { id: '../unsafe', match: validMatch(1) }, 400],
        [
            '/__control/barriers',
            {
                id: 'bad-scenario',
                match: { ...validMatch(1), scenario: 'large' },
            },
            400,
        ],
        [
            '/__control/barriers',
            {
                id: 'bad-transport',
                match: { ...validMatch(1), transport: 'remote' },
            },
            400,
        ],
        [
            '/__control/barriers',
            {
                id: 'bad-action',
                match: { ...validMatch(1), action: 'delete_everything' },
            },
            400,
        ],
        [
            '/__control/barriers',
            { id: 'zero-occurrence', match: validMatch(0) },
            400,
        ],
        [
            '/__control/barriers',
            { id: 'fraction-occurrence', match: validMatch(1.5) },
            400,
        ],
        [
            '/__control/barriers',
            {
                id: 'bad-category',
                match: { ...validMatch(1), categoryId: '99999' },
            },
            400,
        ],
        [
            '/__control/barriers',
            {
                id: 'unknown-field',
                match: { ...validMatch(1), url: 'http://forbidden.invalid' },
            },
            400,
        ],
        [
            '/__control/delays',
            { id: 'negative-delay', match: validMatch(1), milliseconds: -1 },
            400,
        ],
        [
            '/__control/delays',
            { id: 'long-delay', match: validMatch(1), milliseconds: 5001 },
            400,
        ],
        [
            '/__control/delays',
            {
                id: 'fraction-delay',
                match: validMatch(1),
                milliseconds: 1.5,
            },
            400,
        ],
    ])('rejects invalid body %#', async (path, body, status) => {
        const result = await postJson(running.origin, path, TOKEN, body);
        expect(result.response.status).toBe(status);
    });

    it('rejects malformed and oversized JSON safely', async () => {
        const malformed = await fetch(`${running.origin}/__control/prepare`, {
            method: 'POST',
            headers: {
                ...AUTH_HEADERS,
                'content-type': 'application/json',
            },
            body: '{"scenario":',
        });
        const oversized = await fetch(`${running.origin}/__control/prepare`, {
            method: 'POST',
            headers: {
                ...AUTH_HEADERS,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                scenario: 'performance-100k',
                padding: 'x'.repeat(PERFORMANCE_CONTROL_LIMITS.jsonBytes + 1),
            }),
        });

        expect(malformed.status).toBe(400);
        expect(oversized.status).toBe(413);
        expect(await malformed.text()).not.toContain('scenario');
        expect(await oversized.text()).not.toContain('padding');
    });

    it('rejects arbitrary release bodies before looking up a barrier', async () => {
        const response = await fetch(
            `${running.origin}/__control/barriers/not-held/release`,
            {
                method: 'POST',
                headers: {
                    ...AUTH_HEADERS,
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ url: 'http://forbidden.invalid' }),
            }
        );
        expect(response.status).toBe(400);
        expect(await response.text()).not.toContain('forbidden');
    });

    it('rejects duplicate IDs, duplicate matches, and past occurrences', async () => {
        const first = await postJson(
            running.origin,
            '/__control/barriers',
            TOKEN,
            { id: 'first', match: validMatch(1) }
        );
        const duplicateId = await postJson(
            running.origin,
            '/__control/barriers',
            TOKEN,
            {
                id: 'first',
                match: {
                    ...validMatch(1),
                    categoryId: '91102',
                },
            }
        );
        const duplicateMatch = await postJson(
            running.origin,
            '/__control/delays',
            TOKEN,
            { id: 'same-match', match: validMatch(1), milliseconds: 0 }
        );
        expect(first.response.status).toBe(201);
        expect(duplicateId.response.status).toBe(409);
        expect(duplicateMatch.response.status).toBe(409);

        await postJson(running.origin, '/__control/reset', TOKEN, {
            mode: 'observations',
        });
        await fetch(
            `${running.origin}/player_api.php?username=performance&password=performance&action=get_live_streams&category_id=91101`
        );
        const past = await postJson(
            running.origin,
            '/__control/barriers',
            TOKEN,
            { id: 'past', match: validMatch(1) }
        );
        expect(past.response.status).toBe(409);
    });

    it('caps accepted rules and the serialized ledger', async () => {
        for (
            let occurrence = 1;
            occurrence <= PERFORMANCE_CONTROL_LIMITS.rules;
            occurrence++
        ) {
            const result = await postJson(
                running.origin,
                '/__control/barriers',
                TOKEN,
                {
                    id: `rule-${occurrence}`,
                    match: validMatch(occurrence),
                }
            );
            expect(result.response.status).toBe(201);
        }
        const overflow = await postJson(
            running.origin,
            '/__control/barriers',
            TOKEN,
            {
                id: 'rule-overflow',
                match: validMatch(PERFORMANCE_CONTROL_LIMITS.rules + 1),
            }
        );
        expect(overflow.response.status).toBe(409);

        await postJson(running.origin, '/__control/reset', TOKEN, {
            mode: 'observations',
        });
        for (
            let index = 0;
            index < PERFORMANCE_CONTROL_LIMITS.ledger;
            index++
        ) {
            await fetch(
                `${running.origin}/player_api.php?username=u${index}&password=p${index}&action=unknown-${index}`
            );
        }
        const snapshot = await state(running);
        expect(snapshot.ledger).toHaveLength(PERFORMANCE_CONTROL_LIMITS.ledger);
        expect(snapshot.occurrences.length).toBeLessThanOrEqual(
            PERFORMANCE_CONTROL_LIMITS.occurrences
        );
    });

    it('never serializes credentials, raw queries, URLs, or response payloads', async () => {
        const username = 'SECRET_USER_MARKER';
        const password = 'SECRET_PASSWORD_MARKER';
        const rawUrl = 'http://RAW_URL_MARKER.invalid/private';
        const responseMarker = 'RESPONSE_PAYLOAD_MARKER';
        await postJson(running.origin, '/__control/prepare', TOKEN, {
            scenario: 'performance-100k',
        });
        const response = await fetch(
            `${running.origin}/xtream?url=${encodeURIComponent(
                rawUrl
            )}&username=${username}&password=${password}&action=${responseMarker}&query=RAW_QUERY_MARKER`
        );
        expect(response.status).toBe(400);
        expect(await response.text()).toContain(responseMarker);

        const serialized = JSON.stringify(await state(running));
        for (const marker of [
            username,
            password,
            rawUrl,
            'RAW_URL_MARKER',
            'RAW_QUERY_MARKER',
            responseMarker,
            TOKEN,
            'Performance Live 000001',
        ]) {
            expect(serialized).not.toContain(marker);
        }
    });

    it('accepts the legacy action alias but rejects arbitrary cardinalities', async () => {
        const alias = await postJson(
            running.origin,
            '/__control/barriers',
            TOKEN,
            {
                id: 'legacy-alias',
                match: {
                    scenario: 'performance-100k',
                    transport: 'direct',
                    action: 'get_simple_date_table',
                    occurrence: 1,
                    categoryId: 'all',
                },
            }
        );
        const arbitraryCategory = await postJson(
            running.origin,
            '/__control/barriers',
            TOKEN,
            {
                id: 'arbitrary-category',
                match: { ...validMatch(2), categoryId: '91161' },
            }
        );
        expect(alias.response.status).toBe(201);
        expect(arbitraryCategory.response.status).toBe(400);
    });
});

function validMatch(occurrence: number) {
    return {
        scenario: 'performance-100k',
        transport: 'direct',
        action: 'get_live_streams',
        occurrence,
        categoryId: '91101',
    };
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
