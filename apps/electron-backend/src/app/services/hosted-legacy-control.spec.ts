import { type HostedServerStatus } from '@iptvnator/shared/interfaces';
import { stopHostedCloudflare } from './hosted-cloudflare.service';
import { configureHostedHttps } from './hosted-https-control';
import { legacyHostedControl } from './hosted-legacy-control';

jest.mock('./hosted-cloudflare.service', () => ({
    stopHostedCloudflare: jest.fn(),
}));
jest.mock('./hosted-https-control', () => ({
    configureHostedHttps: jest.fn(),
}));

describe('legacy hosted server commands', () => {
    const oldAddress = '192.0.2.10';
    const newAddress = '192.0.2.20';
    let current: HostedServerStatus;
    const child = { kill: jest.fn() };
    const lifecycle = {
        state: () => current,
        setState: (state: HostedServerStatus) => {
            current = state;
        },
        worker: jest.fn(() =>
            current.state === 'running' ? (child as never) : undefined
        ),
        availableAddresses: jest.fn(() => [oldAddress, newAddress]),
        savedAddress: () => oldAddress,
        stop: jest.fn(async () => {
            current = { state: 'stopped' };
        }),
        start: jest.fn(async (_address: string) => {
            current = { state: 'running' };
        }),
        run: async (operation: () => Promise<void>) => {
            await operation();
            return current;
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        current = { state: 'running' };
    });

    it('stops the worker if proxy reconfiguration fails', async () => {
        expect(() =>
            legacyHostedControl({ httpsOrigin: true }, lifecycle)
        ).toThrow('Invalid HTTPS origin');
        jest.mocked(configureHostedHttps).mockRejectedValueOnce(
            new Error('synthetic worker failure')
        );
        await expect(
            legacyHostedControl({ httpsOrigin: '' }, lifecycle)
        ).resolves.toEqual({ state: 'error', error: 'startup' });
        expect(stopHostedCloudflare).toHaveBeenCalledTimes(1);
        expect(configureHostedHttps).toHaveBeenCalledWith(child, '');
        expect(child.kill).toHaveBeenCalledTimes(1);
    });

    it('checks that the server and LAN interface remain available when a queued restart starts', async () => {
        expect(legacyHostedControl(null, lifecycle)).toBeUndefined();
        expect(
            legacyHostedControl({ restart: false }, lifecycle)
        ).toBeUndefined();
        expect(() =>
            legacyHostedControl(
                { restart: true, lanAddress: 'unavailable' },
                lifecycle
            )
        ).toThrow('Invalid hosted server address');
        const command = { restart: true, lanAddress: newAddress };
        current = { state: 'stopped' };
        await expect(legacyHostedControl(command, lifecycle)).rejects.toThrow(
            'Server is unavailable'
        );
        current = {
            state: 'running',
            httpsOrigin: 'https://library.example.test',
        };
        await expect(legacyHostedControl(command, lifecycle)).rejects.toThrow(
            'Stop HTTPS access'
        );
        current = { state: 'running' };
        lifecycle.availableAddresses
            .mockReturnValueOnce([newAddress])
            .mockReturnValueOnce([]);
        await expect(legacyHostedControl(command, lifecycle)).rejects.toThrow(
            'Invalid hosted server address'
        );
        expect(lifecycle.stop).not.toHaveBeenCalled();
    });

    it('reports when a failed LAN restart cannot restore the previous server', async () => {
        lifecycle.start.mockImplementationOnce(async () => {
            current = { state: 'running' };
        });
        lifecycle.start.mockImplementationOnce(async () => {
            current = { state: 'error', error: 'startup' };
        });
        await expect(
            legacyHostedControl(
                { restart: true, lanAddress: newAddress },
                lifecycle
            )
        ).rejects.toThrow('previous server settings could not be restored');
        expect(lifecycle.stop).toHaveBeenCalledTimes(2);
        expect(lifecycle.start.mock.calls).toEqual([
            [newAddress],
            [oldAddress],
        ]);
    });
});
