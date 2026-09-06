import { classifyHostRequestFailure } from '@iptvnator/shared/host-health';
import { ProviderRequestError } from './provider-request-error';
import axios from 'axios';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createServer, Agent as HttpsAgent } from 'node:https';
import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { TLSSocket } from 'node:tls';
import { gzipSync } from 'node:zlib';
import {
    ValidatedHttpClient,
    WebBackendHttpClient,
} from './validated-http-client';
import { withServer } from './web-backend-app.spec-helpers';

const lan = {
    allowPrivateNetworkTargets: true,
    resolveHostname: async () => ['127.0.0.1'],
};

async function withListeningServer<T>(
    server: Server,
    hostname: string,
    run: (port: number) => Promise<T>
): Promise<T> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, hostname, resolve);
    });
    try {
        return await run((server.address() as AddressInfo).port);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

describe('real axios validated transport', () => {
    it('uses exactly the resolved address at connect time, preserves Host, and bypasses ambient proxy settings', async () => {
        const proxy = express().use((_req, res) =>
            res.status(500).send('unexpected proxy')
        );
        await withServer(proxy, async (proxyUrl) => {
            const provider = express().use((req, res) =>
                res.json({ host: req.headers.host })
            );
            await withServer(provider, async (providerUrl) => {
                const { port } = new URL(providerUrl);
                const resolveHostname = jest
                    .fn()
                    .mockResolvedValueOnce(['127.0.0.1'])
                    .mockResolvedValue(['127.0.0.2']);
                const previous = process.env['http_proxy'];
                process.env['http_proxy'] = proxyUrl;
                try {
                    const response = await new ValidatedHttpClient({
                        ...lan,
                        resolveHostname,
                    }).get(`http://provider.example:${port}/`);
                    expect(response.data).toEqual({
                        host: `provider.example:${port}`,
                    });
                    expect(resolveHostname).toHaveBeenCalledTimes(1);
                } finally {
                    if (previous === undefined)
                        delete process.env['http_proxy'];
                    else process.env['http_proxy'] = previous;
                }
            });
        });
    });
    it('uses the new validated DNS answer on each same-host redirect instead of a pooled socket', async () => {
        const provider = express().use((_req, res) => res.redirect('/next'));
        await withServer(provider, async (providerUrl) => {
            const { port } = new URL(providerUrl);
            const resolveHostname = jest
                .fn()
                .mockResolvedValueOnce(['127.0.0.1'])
                .mockResolvedValueOnce(['127.0.0.2']);
            await expect(
                new ValidatedHttpClient({ ...lan, resolveHostname }).get(
                    `http://provider.example:${port}/`,
                    { timeout: 500 }
                )
            ).rejects.toMatchObject({
                initialResponded: true,
                cause: {
                    code: expect.stringMatching(
                        /^(ECONNREFUSED|ECONNABORTED)$/
                    ),
                },
            });
            expect(resolveHostname).toHaveBeenCalledTimes(2);
        });
    });
    it.each(['invalid-gzip', 'unfinished'])(
        'discards the %s redirect body immediately',
        async (kind) => {
            const provider = express();
            provider.get('/start', (_req, res) => {
                res.status(302).set('Location', '/final');
                if (kind === 'invalid-gzip')
                    res.set('Content-Encoding', 'gzip').end('not gzip');
                else res.write('a body that never ends');
            });
            provider.get('/final', (_req, res) => res.json({ ok: true }));
            await withServer(provider, async (url) => {
                await expect(
                    new ValidatedHttpClient(lan).get(`${url}/start`, {
                        timeout: 500,
                    })
                ).resolves.toMatchObject({ data: { ok: true } });
            });
        }
    );
    it('keeps query serialization and sends only Location query on a real redirect', async () => {
        const requests: string[] = [];
        const provider = express().use((req, res) => {
            requests.push(req.url);
            if (requests.length === 1) res.redirect('/final?ticket=issued');
            else res.send('done');
        });
        await withServer(provider, async (url) => {
            await new ValidatedHttpClient(lan).get(`${url}/start?fixed=yes`, {
                params: { password: 'a b+c' },
            });
            expect(requests).toEqual([
                '/start?fixed=yes&password=a+b%2Bc',
                '/final?ticket=issued',
            ]);
        });
    });
    it('retains final arraybuffer, decompression, BOM text and JSON behavior', async () => {
        const provider = express();
        provider.get('/binary', (_req, res) =>
            res.end(Buffer.from([0, 255, 128]))
        );
        provider.get('/compressed', (_req, res) =>
            res.set('Content-Encoding', 'gzip').end(gzipSync('{"ok":true}'))
        );
        provider.get('/text', (_req, res) => res.end('\uFEFFhello'));
        await withServer(provider, async (url) => {
            const client = new ValidatedHttpClient(lan);
            expect(
                (
                    await client.get(`${url}/binary`, {
                        responseType: 'arraybuffer',
                    })
                ).data
            ).toEqual(Buffer.from([0, 255, 128]));
            expect((await client.get(`${url}/compressed`)).data).toEqual({
                ok: true,
            });
            expect((await client.get(`${url}/text`)).data).toEqual('hello');
        });
    });
    it('cancels an unfinished final body and closes its connection', async () => {
        const controller = new AbortController();
        let started!: () => void;
        const bodyStarted = new Promise<void>((resolve) => (started = resolve));
        const provider = express().use((_req, res) => {
            res.write('unfinished');
            started();
        });
        await withServer(provider, async (url) => {
            const pending = new ValidatedHttpClient(lan).get(url, {
                signal: controller.signal,
            });
            await bodyStarted;
            controller.abort();
            await expect(pending).rejects.toMatchObject({
                cause: { code: 'ERR_CANCELED' },
            });
        });
    });
    it.each(['truncated', 'invalid-gzip', 'timeout'])(
        'retains response evidence for a %s final body',
        async (kind) => {
            const provider = express().use((_req, res) => {
                if (kind === 'invalid-gzip') {
                    res.set('Content-Encoding', 'gzip').end('not gzip');
                    return;
                }
                res.set('Content-Length', '100').write('short');
                if (kind === 'truncated') setTimeout(() => res.destroy(), 10);
            });
            await withServer(provider, async (url) => {
                const error = await new ValidatedHttpClient(lan)
                    .get(url, { timeout: 100 })
                    .catch((error: unknown) => error);
                expect(error).toBeInstanceOf(ProviderRequestError);
                const failure = error as ProviderRequestError;
                expect(failure.cause).toMatchObject({
                    response: { status: 200, statusText: 'OK' },
                });
                expect(classifyHostRequestFailure(failure.cause)).toBe(
                    'responded'
                );
            });
        }
    );
    it('does not cap a healthy trickling body at the inactivity timeout', async () => {
        const provider = express().use((_req, res) => {
            let count = 0;
            res.write('start');
            const interval = setInterval(() => {
                res.write('x');
                if (++count === 8) {
                    clearInterval(interval);
                    res.end();
                }
            }, 25);
            res.on('close', () => clearInterval(interval));
        });
        await withServer(provider, async (url) => {
            await expect(
                new ValidatedHttpClient(lan).get(url, { timeout: 100 })
            ).resolves.toMatchObject({ data: 'startxxxxxxxx' });
        });
    });
    it('preserves TLS SNI and hostname verification with a pinned address', async () => {
        // This key/certificate is exclusively a synthetic test fixture.
        const cert = readFileSync(`${__dirname}/testing/provider-test.pem`);
        const key = readFileSync(`${__dirname}/testing/provider-test.key`);
        let requests = 0;
        const server = createServer({ key, cert }, (req, res) => {
            requests++;
            res.setHeader('Content-Type', 'application/json');
            res.end(
                JSON.stringify({
                    host: req.headers.host,
                    sni: (req.socket as TLSSocket & { servername: string })
                        .servername,
                })
            );
        });
        const trustedTransport: WebBackendHttpClient = {
            get: (url, options) => {
                const agent = options?.httpsAgent as HttpsAgent & {
                    options: { ca?: Buffer };
                };
                // Supply the local test CA, retaining the production lookup,
                // SNI and rejectUnauthorized defaults on the actual agent.
                agent.options.ca = cert;
                return axios.get(url, options);
            },
        };
        await withListeningServer(server, '127.0.0.1', async (port) => {
            await expect(
                new ValidatedHttpClient(lan).get(
                    `https://provider.example:${port}`
                )
            ).rejects.toMatchObject({
                cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
            });
            expect(requests).toBe(0);
            const client = new ValidatedHttpClient(lan, trustedTransport);
            await expect(
                client.get(`https://provider.example:${port}`)
            ).resolves.toMatchObject({
                data: {
                    host: `provider.example:${port}`,
                    sni: 'provider.example',
                },
            });
            await expect(
                client.get(`https://wrong.example:${port}`)
            ).rejects.toMatchObject({
                cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
            });
            expect(requests).toBe(1);
        });
    });
    it('connects to a pinned IPv6 address and an IPv6 literal in trusted LAN mode', async () => {
        const server = new Server((_req, res) => res.end('ipv6'));
        await withListeningServer(server, '::1', async (port) => {
            const client = new ValidatedHttpClient({
                ...lan,
                resolveHostname: async () => ['::1'],
            });
            expect(
                (await client.get(`http://provider.example:${port}/`)).data
            ).toBe('ipv6');
            expect((await client.get(`http://[::1]:${port}/`)).data).toBe(
                'ipv6'
            );
        });
    });
});
