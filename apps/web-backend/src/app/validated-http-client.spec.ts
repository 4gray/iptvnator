import { Agent } from 'node:http';
import { LookupFunction } from 'node:net';
import { ValidatedHttpClient } from './validated-http-client';
import {
    resolvePublicHost,
    StubHttpClient,
} from './web-backend-app.spec-helpers';

const policy = {
    allowPrivateNetworkTargets: false,
    resolveHostname: resolvePublicHost,
};

describe('validated HTTP redirect chain', () => {
    it.each([301, 302, 303, 307, 308])(
        'follows relative Location for %s, without replaying original params',
        async (status) => {
            const transport = new StubHttpClient();
            transport.queueRedirect('../next?ticket=provider', status);
            transport.queueResponse('done');
            const result = await new ValidatedHttpClient(policy, transport).get(
                'https://provider.example/base/start',
                {
                    params: { username: 'demo', password: 'secret' },
                    timeout: 1234,
                }
            );
            expect(result.data).toBe('done');
            expect(transport.requests[0].params).toEqual({
                username: 'demo',
                password: 'secret',
            });
            expect(transport.requests[1]).toMatchObject({
                url: 'https://provider.example/next?ticket=provider',
                timeout: 1234,
            });
            expect(transport.requests[1].params).toBeUndefined();
        }
    );
    it('resolves fragment-only Location against the sent query and detects the cycle', async () => {
        const transport = new StubHttpClient();
        transport.queueRedirect('#fragment');
        await expect(
            new ValidatedHttpClient(policy, transport).get(
                'https://provider.example/start',
                {
                    params: { token: 'secret' },
                }
            )
        ).rejects.toMatchObject({
            policyError: { status: 502, message: 'Redirect cycle detected' },
        });
        expect(transport.requests).toHaveLength(1);
    });
    it.each([
        ['https://provider.example/next', true],
        ['https://provider.example:8443/next', false],
        ['http://provider.example/next', false],
        ['https://other.example/next', false],
    ])(
        'scopes sensitive headers on redirect to %s',
        async (location, retained) => {
            const transport = new StubHttpClient();
            transport.queueRedirect(location as string);
            transport.queueResponse('done');
            const headers = {
                Authorization: 'Bearer secret',
                cOoKiE: 'mac=secret',
                'Proxy-Authorization': 'secret',
                sN: 'serial',
                'User-Agent': 'player',
            };
            await new ValidatedHttpClient(policy, transport).get(
                'https://provider.example/start',
                { headers }
            );
            expect(transport.requests[1].headers).toEqual(
                retained ? headers : { 'User-Agent': 'player' }
            );
            expect(headers.Authorization).toBe('Bearer secret');
        }
    );
    it.each([
        'http://127.0.0.1/',
        'https://user:secret@provider.example/',
        'file:///tmp/test',
        'http://[invalid',
    ])(
        'refuses unsafe Location %s without another transport call',
        async (location) => {
            const transport = new StubHttpClient();
            transport.queueRedirect(location);
            await expect(
                new ValidatedHttpClient(policy, transport).get(
                    'https://provider.example/start'
                )
            ).rejects.toMatchObject({ initialResponded: true });
            expect(transport.requests).toHaveLength(1);
        }
    );
    it('accepts five redirects and rejects a sixth before its destination', async () => {
        for (const count of [5, 6]) {
            const transport = new StubHttpClient();
            for (let i = 0; i < count; i++) transport.queueRedirect(`/hop${i}`);
            transport.queueResponse('done');
            const request = new ValidatedHttpClient(policy, transport).get(
                'https://provider.example/start'
            );
            if (count === 5)
                await expect(request).resolves.toMatchObject({ data: 'done' });
            else
                await expect(request).rejects.toMatchObject({
                    policyError: { status: 502, message: 'Too many redirects' },
                });
            expect(transport.requests).toHaveLength(6);
        }
    });
    it('rejects a redirect without Location', async () => {
        const transport = new StubHttpClient();
        transport.queueRedirect('');
        await expect(
            new ValidatedHttpClient(policy, transport).get(
                'https://provider.example'
            )
        ).rejects.toMatchObject({ policyError: { status: 502 } });
    });
    it('revalidates DNS on same-host hops and blocks a changed answer before connect', async () => {
        const transport = new StubHttpClient();
        transport.queueRedirect('/next');
        const resolveHostname = jest
            .fn()
            .mockResolvedValueOnce(['93.184.216.34'])
            .mockResolvedValueOnce(['127.0.0.1']);
        await expect(
            new ValidatedHttpClient(
                { ...policy, resolveHostname },
                transport
            ).get('https://provider.example/start')
        ).rejects.toMatchObject({
            policyError: { status: 400 },
            initialResponded: true,
        });
        expect(resolveHostname).toHaveBeenCalledTimes(2);
        expect(transport.requests).toHaveLength(1);
    });
    it('pins all validated IPv4/IPv6 records without a second DNS lookup', async () => {
        const transport = new StubHttpClient();
        transport.queueResponse('done');
        const get = jest.spyOn(transport, 'get');
        const resolveHostname = jest
            .fn()
            .mockResolvedValue(['93.184.216.34', '2606:4700:4700::1111']);
        await new ValidatedHttpClient(
            { ...policy, resolveHostname },
            transport
        ).get('https://provider.example/start');
        const options = get.mock.calls[0][1];
        if (!options) throw new Error('Missing transport options');
        expect(options).toMatchObject({
            maxRedirects: 0,
            proxy: false,
            adapter: 'http',
        });
        const agent = options.httpsAgent as Agent & {
            options: { lookup: LookupFunction; proxyEnv: object };
        };
        const lookup = agent.options.lookup as LookupFunction;
        const callback = jest.fn();
        lookup('provider.example', { all: true }, callback);
        expect(callback).toHaveBeenLastCalledWith(null, [
            { address: '93.184.216.34', family: 4 },
            { address: '2606:4700:4700::1111', family: 6 },
        ]);
        lookup('provider.example', { family: 6 }, callback);
        expect(callback).toHaveBeenLastCalledWith(
            null,
            '2606:4700:4700::1111',
            6
        );
        expect(resolveHostname).toHaveBeenCalledTimes(1);
        expect(agent.options).toMatchObject({ proxyEnv: {} });
    });
    it('does not send a hop when canceled during its DNS validation', async () => {
        const controller = new AbortController();
        const transport = new StubHttpClient();
        const resolveHostname = async () => {
            controller.abort();
            return ['93.184.216.34'];
        };
        await expect(
            new ValidatedHttpClient(
                { ...policy, resolveHostname },
                transport
            ).get('https://provider.example', { signal: controller.signal })
        ).rejects.toMatchObject({ initialResponded: false });
        expect(transport.requests).toHaveLength(0);
    });
});
