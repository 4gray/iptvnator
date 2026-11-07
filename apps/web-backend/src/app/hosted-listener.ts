import { createServer, type Server } from 'node:http';
import { BlockList } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Express } from 'express';

export function listenHosted(
    app: Express,
    host: string,
    port: number
): Promise<Server> {
    const lan = host !== '127.0.0.1';
    const peers = new BlockList();
    if (lan) {
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
    const server = createServer((request, response) => {
        const authority = `${host}:${request.socket.localPort}`;
        // Reject unrelated browser origins and DNS rebinding to this listener.
        if (
            (lan &&
                (!request.socket.remoteAddress ||
                    !peers.check(request.socket.remoteAddress, 'ipv4'))) ||
            request.headers.host !== authority ||
            (request.headers.origin &&
                request.headers.origin !== `http://${authority}`)
        ) {
            response.writeHead(403).end();
            return;
        }
        app(request, response);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve(server);
        });
    });
}
