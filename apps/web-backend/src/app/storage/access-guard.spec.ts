import express from 'express';
import { withServer } from '../web-backend-app.spec-helpers';
import { createAccessGuard } from './access-guard';

function createApp() {
    const app = express();
    app.use(createAccessGuard('s3cret'));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.get('/v1/instance', (_req, res) => res.json({ ok: true }));
    app.get('/v1/playlists', (_req, res) => res.json([]));
    return app;
}

describe('createAccessGuard', () => {
    it('lets public routes through', () =>
        withServer(createApp(), async (baseUrl) => {
            expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
            expect((await fetch(`${baseUrl}/v1/instance`)).status).toBe(200);
        }));

    it('rejects a missing or wrong token with a JSON 401', () =>
        withServer(createApp(), async (baseUrl) => {
            const missing = await fetch(`${baseUrl}/v1/playlists`);
            const wrong = await fetch(`${baseUrl}/v1/playlists`, {
                headers: { authorization: 'Bearer nope' },
            });

            expect(missing.status).toBe(401);
            await expect(missing.json()).resolves.toMatchObject({
                code: 'unauthorized',
            });
            expect(wrong.status).toBe(401);
        }));

    it('accepts the right token and lets preflight through', () =>
        withServer(createApp(), async (baseUrl) => {
            const ok = await fetch(`${baseUrl}/v1/playlists`, {
                headers: { authorization: 'Bearer s3cret' },
            });
            const preflight = await fetch(`${baseUrl}/v1/playlists`, {
                method: 'OPTIONS',
            });

            expect(ok.status).toBe(200);
            expect(preflight.status).not.toBe(401);
        }));

    it('reads the scheme case-insensitively and trims the token', () =>
        withServer(createApp(), async (baseUrl) => {
            const ok = await fetch(`${baseUrl}/v1/playlists`, {
                headers: { authorization: 'bearer    s3cret  ' },
            });

            expect(ok.status).toBe(200);
        }));

    it('rejects a long whitespace header quickly', () =>
        withServer(createApp(), async (baseUrl) => {
            const started = Date.now();
            const response = await fetch(`${baseUrl}/v1/playlists`, {
                headers: {
                    // Under Node's 16 KB header limit, so the guard sees it.
                    authorization: `bearer ${' '.repeat(10_000)}x`,
                },
            });

            expect(response.status).toBe(401);
            expect(Date.now() - started).toBeLessThan(1_000);
        }));
});
