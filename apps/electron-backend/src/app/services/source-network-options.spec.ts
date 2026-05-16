const mockPrepareForSourceNetwork = jest.fn();

jest.mock('./proton-vpn-integration.service', () => ({
    protonVpnIntegration: {
        prepareForSourceNetwork: mockPrepareForSourceNetwork,
    },
}));

import {
    ensureSourceNetworkReady,
    SourceVpnNotReadyError,
} from './source-network-options';

describe('source network options', () => {
    beforeEach(() => {
        delete process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS;
        mockPrepareForSourceNetwork.mockReset();
    });

    afterEach(() => {
        delete process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS;
    });

    it('allows source traffic without a VPN when the resolved policy is disabled', async () => {
        mockPrepareForSourceNetwork.mockResolvedValue({
            enabled: false,
            location: 'HR',
            provider: 'none',
            reason: 'disabled',
            status: 'disabled',
            lastCheckedAt: Date.now(),
        });

        await expect(ensureSourceNetworkReady()).resolves.toEqual(
            expect.objectContaining({
                enabled: false,
                provider: 'none',
                status: 'disabled',
            })
        );
    });

    it('requires a Proton local tunnel address before source traffic is allowed', async () => {
        mockPrepareForSourceNetwork.mockResolvedValue({
            enabled: true,
            location: 'HR',
            provider: 'proton',
            status: 'configured',
            lastCheckedAt: Date.now(),
        });

        await expect(
            ensureSourceNetworkReady({
                provider: 'proton',
                location: 'HR',
                sourceId: 'source-1',
            })
        ).rejects.toBeInstanceOf(SourceVpnNotReadyError);
    });

    it('returns the bound local tunnel address when Proton is ready', async () => {
        process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS = '10.2.0.9';
        mockPrepareForSourceNetwork.mockResolvedValue({
            enabled: true,
            localAddress: '10.2.0.9',
            location: 'DE',
            provider: 'proton',
            status: 'configured',
            lastCheckedAt: Date.now(),
        });

        await expect(
            ensureSourceNetworkReady({
                provider: 'proton',
                location: 'DE',
                sourceId: 'source-1',
            })
        ).resolves.toEqual(
            expect.objectContaining({
                enabled: true,
                localAddress: '10.2.0.9',
                location: 'DE',
                provider: 'proton',
                status: 'configured',
            })
        );
    });

    it('persists the local tunnel address returned by Proton preparation before building request agents', async () => {
        mockPrepareForSourceNetwork.mockResolvedValue({
            enabled: true,
            localAddress: '10.2.0.10',
            location: 'HR',
            provider: 'proton',
            status: 'configured',
            lastCheckedAt: Date.now(),
        });

        await expect(
            ensureSourceNetworkReady({
                provider: 'proton',
                location: 'HR',
                sourceId: 'source-1',
            })
        ).resolves.toEqual(
            expect.objectContaining({
                enabled: true,
                localAddress: '10.2.0.10',
                provider: 'proton',
                status: 'configured',
            })
        );
        expect(process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS).toBe('10.2.0.10');
    });

    it('uses an already known tunnel address when a later preparation result omits one', async () => {
        process.env.IPTVNATOR_SOURCE_LOCAL_ADDRESS = '10.2.0.11';
        mockPrepareForSourceNetwork.mockResolvedValue({
            enabled: true,
            location: 'HR',
            provider: 'proton',
            status: 'configured',
            lastCheckedAt: Date.now(),
        });

        await expect(
            ensureSourceNetworkReady({
                provider: 'proton',
                location: 'HR',
                sourceId: 'source-1',
            })
        ).resolves.toEqual(
            expect.objectContaining({
                localAddress: '10.2.0.11',
                provider: 'proton',
                status: 'configured',
            })
        );
    });
});
