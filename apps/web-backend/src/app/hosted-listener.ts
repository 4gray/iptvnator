import { createServer, type RequestListener, type Server } from 'node:http';
import {
    createServer as createTlsServer,
    type ServerOptions,
} from 'node:https';
import { BlockList } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Express } from 'express';
import { markHostedIngress, markHostedLan } from './hosted-ingress';

export function listenHosted(
    app: Express,
    host: string,
    port: number,
    httpsOrigin?: URL,
    tls?: ServerOptions
): Promise<Server> {
    const lan = host !== '127.0.0.1';
    const peers = new BlockList();
    if (lan && !tls) {
        const address = Object.values(networkInterfaces())
            .flat()
            .find(
                (entry) =>
                    entry?.family === 'IPv4' &&
                    !entry.internal &&
                    entry.address === host
            );
        if (!address?.cidr) throw new Error('LAN address is unavailable');
        const prefix = Number(address.cidr.split('/')[1]);
        const privatePrefix = host.startsWith('10.')
            ? 8
            : host.startsWith('172.')
              ? 12
              : 16;
        if (!Number.isInteger(prefix) || prefix < privatePrefix || prefix > 32)
            throw new Error('LAN subnet is unavailable');
        peers.addSubnet(host, prefix, 'ipv4');
    }
    const handle: RequestListener = (request, response) => {
        const authority = `${host}:${request.socket.localPort}`;
        const origin = request.headers.origin;
        const local =
            !httpsOrigin &&
            request.headers.host === authority &&
            (!origin || origin === `http://${authority}`);
        // The configured proxy connects over loopback and preserves Host.
        // Forwarded headers do not decide whether a request is trusted.
        const proxied =
            (tls || (!lan && request.socket.remoteAddress === '127.0.0.1')) &&
            httpsOrigin !== undefined &&
            request.headers.host === httpsOrigin.host &&
            (!origin || origin === httpsOrigin.origin);
        // Reject unrelated browser origins and DNS rebinding to this listener.
        if (
            (lan &&
                !tls &&
                (!request.socket.remoteAddress ||
                    !peers.check(request.socket.remoteAddress, 'ipv4'))) ||
            (!local && !proxied)
        ) {
            response.writeHead(403).end();
            return;
        }
        if (lan && local) markHostedLan(request, `http://${authority}`);
        if (proxied) {
            markHostedIngress(request, httpsOrigin.origin);
            response.setHeader('Cache-Control', 'no-store');
        }
        app(request, response);
    };
    const server = tls ? createTlsServer(tls, handle) : createServer(handle);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve(server);
        });
    });
}
