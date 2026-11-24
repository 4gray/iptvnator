import {
    Agent,
    request,
    type IncomingMessage,
    type RequestOptions,
    type Server,
} from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { duplexPair } from 'node:stream';

export const serverOrigin = (server: Server) =>
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const useMemoryTransport = () =>
    process.env.IPTVNATOR_TEST_HTTP_TRANSPORT === 'memory';

// Keep Node's HTTP parser and the real listener callback in the test path.
// Windows sandboxes can bind TCP listeners while denying client connects.
export function requestTestServer(
    server: Server,
    origin: string,
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void
) {
    if (!useMemoryTransport()) return request(origin, options, onResponse);
    if (!server.listening) throw new Error('Test server is closed');

    const [client, peer] = duplexPair();
    Object.defineProperties(peer, {
        remoteAddress: { value: '127.0.0.1' },
        localAddress: { value: '127.0.0.1' },
        localPort: { value: (server.address() as AddressInfo).port },
    });
    const agent = new Agent({ keepAlive: false });
    agent.createConnection = () => client as Socket;
    server.emit('connection', peer);
    const outbound = request(origin, { ...options, agent }, onResponse);
    outbound.once('close', () => agent.destroy());
    return outbound;
}

export function streamTestServer(
    server: Server,
    origin: string,
    path: string,
    signal: AbortSignal
): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        const outbound = requestTestServer(
            server,
            origin,
            { path, signal },
            resolve
        );
        outbound.once('error', reject);
        outbound.end();
    });
}

export function fetchTestServer(server: Server) {
    return async (url: string, init?: RequestInit): Promise<Response> => {
        if (!useMemoryTransport()) return fetch(url, init);

        const input = new Request(url, init);
        const target = new URL(input.url);
        const origin = serverOrigin(server);
        if (target.origin !== origin)
            throw new Error('URL does not belong to this test server');
        const headers = Object.fromEntries(input.headers.entries());
        const body = input.body
            ? Buffer.from(await input.arrayBuffer())
            : undefined;
        if (body) headers['content-length'] = String(body.byteLength);

        return new Promise<Response>((resolve, reject) => {
            const outbound = requestTestServer(
                server,
                origin,
                {
                    path: target.pathname + target.search,
                    method: input.method,
                    headers,
                    signal: input.signal,
                },
                (response) => {
                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer) => chunks.push(chunk));
                    response.once('error', reject);
                    response.once('end', () => {
                        const headers = new Headers();
                        for (let i = 0; i < response.rawHeaders.length; i += 2)
                            headers.append(
                                response.rawHeaders[i],
                                response.rawHeaders[i + 1]
                            );
                        const bytes = Buffer.concat(chunks);
                        resolve(
                            new Response(
                                bytes.length ? new Uint8Array(bytes) : null,
                                {
                                    status: response.statusCode,
                                    headers,
                                }
                            )
                        );
                    });
                }
            );
            outbound.once('error', reject);
            outbound.end(body);
        });
    };
}
