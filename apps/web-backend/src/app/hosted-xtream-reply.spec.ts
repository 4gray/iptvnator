import express from 'express';
import { createWebBackendApp } from './web-backend-app';
import {
    registerProviderTarget,
    withServer,
} from './web-backend-app.spec-helpers';

describe('hosted Xtream catalog responses', () => {
    it.each([false, true])(
        'sends a heartbeat before the provider finishes (oversized: %s)',
        async (oversized) => {
            let finish!: () => void;
            const provider = express().get('/player_api.php', (_req, res) => {
                res.write('[');
                const timer = setInterval(() => res.write(' '), 250);
                res.once('close', () => clearInterval(timer));
                finish = () =>
                    res.end(oversized ? '0'.repeat(2048) + ']' : '42]');
            });
            await withServer(provider, async (origin) => {
                const app = createWebBackendApp({
                    allowPrivateNetworkTargets: true,
                    hostedMode: 'cloudflare',
                    maxProviderResponseBytes: 1024,
                });
                await withServer(app, async (backend) => {
                    const id = await registerProviderTarget(backend, origin);
                    const res = await fetch(
                        `${backend}/xtream?targetId=${id}&action=get_live_streams`,
                        { signal: AbortSignal.timeout(18_000) }
                    );
                    const reader = res.body!.getReader();
                    const first = await reader.read();
                    expect(Buffer.from(first.value!).toString()).toMatch(
                        /^\s+$/
                    );
                    finish();
                    const chunks: Uint8Array[] = [];
                    for (
                        let chunk = await reader.read();
                        !chunk.done;
                        chunk = await reader.read()
                    )
                        chunks.push(chunk.value);
                    expect(res.status).toBe(200);
                    expect(res.headers.get('content-type')).toMatch(
                        /application\/json/
                    );
                    expect(
                        JSON.parse(Buffer.concat(chunks).toString())
                    ).toMatchObject(
                        oversized
                            ? {
                                  status: 413,
                                  code: 'PROVIDER_RESPONSE_TOO_LARGE',
                              }
                            : { action: 'get_live_streams', payload: [42] }
                    );
                });
            });
        },
        22_000
    );
});
