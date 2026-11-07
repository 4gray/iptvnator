import { EventEmitter } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Express } from 'express';
import { listenHosted } from './hosted-listener';

jest.mock('node:http', () => ({ createServer: jest.fn() }));
jest.mock('node:os', () => ({ networkInterfaces: jest.fn() }));

describe('LAN hosted listener', () => {
    const port = 4334;
    const host = '192.168.40.5';
    const app = jest.fn() as unknown as Express;
    let handleRequest: RequestListener;

    function exposeInterface(address: string, prefix: number) {
        jest.mocked(networkInterfaces).mockReturnValue({
            fixture: [
                {
                    address,
                    family: 'IPv4',
                    internal: false,
                    cidr: `${address}/${prefix}`,
                    netmask: '',
                    mac: '00:00:00:00:00:00',
                },
            ],
        });
    }

    beforeEach(() => {
        jest.resetAllMocks();
        const server = Object.assign(new EventEmitter(), {
            listen: (_port: number, _host: string, ready: () => void) =>
                ready(),
        });
        (createServer as jest.Mock).mockImplementation(
            (listener: RequestListener) => {
                handleRequest = listener;
                return server;
            }
        );
    });

    function requestFrom(remoteAddress?: string) {
        const request = {
            headers: { host: `${host}:${port}` },
            socket: { localPort: port, remoteAddress },
        };
        const response = {
            writeHead: jest.fn().mockReturnThis(),
            end: jest.fn(),
        };
        handleRequest(
            request as Parameters<RequestListener>[0],
            response as unknown as Parameters<RequestListener>[1]
        );
        return response;
    }

    it('accepts a peer on the selected subnet and rejects addresses outside it', async () => {
        exposeInterface(host, 24);
        await listenHosted(app, host, port);

        expect(requestFrom('192.168.40.8').writeHead).not.toHaveBeenCalled();
        expect(app).toHaveBeenCalledTimes(1);
        expect(requestFrom('192.168.41.8').writeHead).toHaveBeenCalledWith(403);
        expect(requestFrom().writeHead).toHaveBeenCalledWith(403);
        expect(app).toHaveBeenCalledTimes(1);
    });

    it('rejects a LAN interface that is no longer available', () => {
        jest.mocked(networkInterfaces).mockReturnValue({});
        expect(() => listenHosted(app, host, port)).toThrow(
            'LAN address is unavailable'
        );
        expect(createServer).not.toHaveBeenCalled();
    });

    it.each([
        ['10.20.0.5', 7],
        ['172.16.4.5', 11],
        [host, 15],
    ])(
        'does not bind %s when its subnet extends outside the private range',
        (address, prefix) => {
            exposeInterface(address, prefix);
            expect(() => listenHosted(app, address, port)).toThrow(
                'LAN subnet is unavailable'
            );
            expect(createServer).not.toHaveBeenCalled();
        }
    );
});
