import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { closeGracefully } from './graceful-shutdown';

describe('closeGracefully', () => {
    let server: Server;

    afterEach(() => {
        server?.closeAllConnections();
    });

    it('stops waiting for a request that never ends after the grace period', async () => {
        server = createServer((_req, res) => {
            res.writeHead(200);
            res.write('streaming');
            // Never ends, like a provider download that keeps sending bytes.
        });
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const { port } = server.address() as AddressInfo;
        const request = fetch(`http://127.0.0.1:${port}/`).catch(
            () => undefined
        );
        await new Promise((resolve) => setTimeout(resolve, 50));

        const started = Date.now();
        await closeGracefully(server, 100);

        expect(Date.now() - started).toBeLessThan(2_000);
        expect(server.listening).toBe(false);
        await request;
    });
});
