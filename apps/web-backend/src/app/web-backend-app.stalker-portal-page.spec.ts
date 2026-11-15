import { createWebBackendApp } from './web-backend-app';
import {
    registerProviderTarget,
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from './web-backend-app.spec-helpers';

describe('/stalker portal page reached through redirects', () => {
    async function probe(transport: StubHttpClient): Promise<unknown> {
        let body: unknown;
        await withServer(
            createWebBackendApp({
                httpClient: transport,
                resolveHostname: resolvePublicHost,
            }),
            async (backend) => {
                const id = await registerProviderTarget(
                    backend,
                    'http://entry.example.invalid/server/load.php'
                );
                const response = await fetch(
                    `${backend}/stalker?targetId=${id}&type=itv&action=get_genres&macAddress=00:1A:79:00:00:01&skipConnectionGuard=true`
                );
                body = await response.json();
            }
        );
        return body;
    }

    it('reports where the redirects ended instead of the HTML body', async () => {
        // Every API path is sent to the site root, and the root sends the
        // client on to the portal page of another node.
        const transport = new StubHttpClient();
        transport.queueRedirect('https://entry.example.invalid/', 301);
        transport.queueRedirect(
            'http://node.example.invalid/stalker_portal/c/'
        );
        transport.queueResponse(
            '<html><script src="xpcom.common.js"></script></html>'
        );

        expect(await probe(transport)).toEqual({
            action: 'get_genres',
            payload: {
                stalkerPortalPage:
                    'http://node.example.invalid/stalker_portal/c/',
            },
        });
        expect(transport.requests.map(({ url }) => url)).toEqual([
            expect.stringContaining(
                'http://entry.example.invalid/server/load.php'
            ),
            'https://entry.example.invalid/',
            'http://node.example.invalid/stalker_portal/c/',
        ]);
    });

    it('returns other HTML bodies unchanged', async () => {
        const transport = new StubHttpClient();
        transport.queueRedirect('https://entry.example.invalid/', 301);
        transport.queueResponse('<html><body>Welcome</body></html>');

        expect(await probe(transport)).toEqual({
            action: 'get_genres',
            payload: '<html><body>Welcome</body></html>',
        });
    });
});
