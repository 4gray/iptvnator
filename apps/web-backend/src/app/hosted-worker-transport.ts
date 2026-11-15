import { Agent, createServer, request } from 'node:http';
import type { Socket } from 'node:net';
import { duplexPair } from 'node:stream';
import type { Express } from 'express';
import type {
    HostedWorkerRequest,
    HostedWorkerResponse,
} from '@iptvnator/shared/interfaces';
import { hostedWorkerSockets } from './hosted-ingress';

/** Run the same Express routes over a private stream with no listening socket. */
export function createHostedWorkerTransport(app: Express) {
    const server = createServer(app);
    const limit = 64 * 1024 * 1024;
    return (input: HostedWorkerRequest): Promise<HostedWorkerResponse> =>
        new Promise((resolve, reject) => {
            const [client, peer] = duplexPair();
            hostedWorkerSockets.add(peer);
            const agent = new Agent();
            agent.createConnection = () => client as Socket;
            const body =
                input.body === undefined
                    ? undefined
                    : JSON.stringify(input.body);
            if (body && Buffer.byteLength(body) > limit) {
                agent.destroy();
                client.destroy();
                peer.destroy();
                reject(new Error('Hosted request is too large'));
                return;
            }
            server.emit('connection', peer);
            const outbound = request(
                {
                    hostname: '127.0.0.1',
                    path: input.path,
                    method: input.method,
                    agent,
                    headers: {
                        ...input.headers,
                        Connection: 'close',
                        ...(body
                            ? {
                                  'Content-Type': 'application/json',
                                  'Content-Length': Buffer.byteLength(body),
                              }
                            : {}),
                    },
                },
                (response) => {
                    const chunks: Buffer[] = [];
                    let bytes = 0;
                    response.on('data', (chunk: Buffer) => {
                        bytes += chunk.length;
                        if (bytes > limit)
                            outbound.destroy(
                                new Error('Hosted response is too large')
                            );
                        else chunks.push(chunk);
                    });
                    response.on('error', reject);
                    response.on('end', () => {
                        const text = Buffer.concat(chunks).toString();
                        let body: unknown = text;
                        if (
                            text &&
                            response.headers['content-type']?.includes(
                                'application/json'
                            )
                        ) {
                            try {
                                body = JSON.parse(text);
                            } catch (error) {
                                reject(error);
                                return;
                            }
                        }
                        resolve({
                            status: response.statusCode!,
                            etag: response.headers.etag,
                            body,
                        });
                    });
                }
            );
            const deadline = setTimeout(
                () => outbound.destroy(new Error('Hosted request timed out')),
                120_000
            );
            outbound.on('error', reject);
            outbound.on('close', () => {
                clearTimeout(deadline);
                agent.destroy();
            });
            outbound.end(body);
        });
}
