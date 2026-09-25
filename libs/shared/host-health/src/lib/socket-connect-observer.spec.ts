import { createServer, Server, Agent, request as httpRequest } from 'node:http';
import { AddressInfo } from 'node:net';
import { observeAgentSocketConnections } from './socket-connect-observer';

async function withSilentServer<T>(
    run: (port: number, server: Server) => Promise<T>
): Promise<T> {
    // Accepts every connection and never writes a byte: a live but silent host.
    const server = createServer(() => undefined);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        return await run((server.address() as AddressInfo).port, server);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

function requestOnce(
    agent: Agent,
    port: number,
    timeoutMs: number
): Promise<{ error?: NodeJS.ErrnoException }> {
    return new Promise((resolve) => {
        const request = httpRequest(
            { host: '127.0.0.1', port, path: '/', agent, timeout: timeoutMs },
            () => resolve({})
        );
        request.on('timeout', () =>
            request.destroy(
                Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
            )
        );
        request.on('error', (error: NodeJS.ErrnoException) =>
            resolve({ error })
        );
        request.end();
    });
}

describe('observeAgentSocketConnections', () => {
    it('reports the connect of a fresh connection even when the host then never answers', async () => {
        await withSilentServer(async (port) => {
            const onConnect = jest.fn();
            const agent = observeAgentSocketConnections(new Agent(), onConnect);

            const { error } = await requestOnce(agent, port, 100);

            expect(error?.code).toBe('ECONNABORTED');
            expect(onConnect).toHaveBeenCalledTimes(1);
        });
    });

    it('stays silent when the host refuses the connection', async () => {
        // A listener that has just closed: nothing is accepting on that port.
        const port = await withSilentServer(async (port) => port);
        const onConnect = jest.fn();
        const agent = observeAgentSocketConnections(new Agent(), onConnect);

        const { error } = await requestOnce(agent, port, 1_000);

        expect(error?.code).toBe('ECONNREFUSED');
        expect(onConnect).not.toHaveBeenCalled();
    });

    it('reports a pooled keep-alive socket as connected right away', async () => {
        const server = createServer((_request, response) => response.end('ok'));
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve)
        );
        const onConnect = jest.fn();
        const agent = observeAgentSocketConnections(
            new Agent({ keepAlive: true }),
            onConnect
        );
        const fetchOk = (port: number) =>
            new Promise<void>((resolve) => {
                httpRequest({ host: '127.0.0.1', port, agent }, (response) =>
                    response.resume().on('end', resolve)
                ).end();
            });
        try {
            const port = (server.address() as AddressInfo).port;
            await fetchOk(port);
            expect(onConnect).toHaveBeenCalledTimes(1);

            // Same agent, same idle socket: no `connect` event will ever fire
            // again for it, yet the host demonstrably accepted it.
            expect(
                Object.values(agent.freeSockets).flat()
            ).toHaveLength(1);
            await fetchOk(port);
            expect(onConnect).toHaveBeenCalledTimes(2);
        } finally {
            agent.destroy();
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
