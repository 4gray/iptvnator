import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { streamTestServer } from './http-server.spec-helpers';
import { createWebBackendApp } from './web-backend-app';
import {
    registerProviderTarget,
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from './web-backend-app.spec-helpers';

describe('hosted Xtream catalog responses', () => {
    it.each([false, true])(
        'sends a heartbeat before the provider finishes (oversized: %s)',
        async (oversized) => {
            const providerBody = new PassThrough();
            providerBody.write('[');
            const httpClient = new StubHttpClient();
            httpClient.queueResponse(providerBody);
            const app = createWebBackendApp({
                httpClient,
                resolveHostname: resolvePublicHost,
                hostedMode: 'cloudflare',
                maxProviderResponseBytes: 1024,
            });
            await withServer(app, async (backend, send, server) => {
                const id = await registerProviderTarget(
                    backend,
                    'https://provider.test',
                    send
                );
                const res = await streamTestServer(
                    server,
                    backend,
                    `/xtream?targetId=${id}&action=get_live_streams`,
                    AbortSignal.timeout(18_000)
                );
                const reader = res[Symbol.asyncIterator]();
                const first = await reader.next();
                assert(!first.done);
                expect(Buffer.from(first.value).toString()).toMatch(/^\s+$/);
                providerBody.end(
                    oversized ? '0'.repeat(2048) + ']' : '"<Arts & Crafts>"]'
                );
                const chunks: Uint8Array[] = [];
                for (
                    let chunk = await reader.next();
                    !chunk.done;
                    chunk = await reader.next()
                ) {
                    chunks.push(chunk.value);
                }
                expect(res.statusCode).toBe(200);
                expect(res.headers['content-type']).toMatch(
                    /application\/json/
                );
                expect(res.headers['x-content-type-options']).toBe('nosniff');
                const json = Buffer.concat(chunks).toString();
                expect(json).not.toMatch(/[<>&]/);
                expect(JSON.parse(json)).toMatchObject(
                    oversized
                        ? { status: 413, code: 'PROVIDER_RESPONSE_TOO_LARGE' }
                        : {
                              action: 'get_live_streams',
                              payload: ['<Arts & Crafts>'],
                          }
                );
            });
        },
        22_000
    );
});
