import { SourceVpnPreparationService } from './source-vpn-preparation.service';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

describe('SourceVpnPreparationService', () => {
    let originalElectron: unknown;
    let prepareSourceVpn: jest.Mock;

    beforeEach(() => {
        originalElectron = window.electron;
        prepareSourceVpn = jest.fn().mockResolvedValue({
            enabled: true,
            location: 'HR',
            platform: 'win32',
            provider: 'proton',
            status: 'configured',
            lastCheckedAt: Date.now(),
        });

        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                prepareSourceVpn,
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: originalElectron,
        });
        jest.restoreAllMocks();
    });

    it('prepares Proton when opening a source with the open checkbox enabled', async () => {
        const service = new SourceVpnPreparationService();

        await service.prepareForPlaylist(
            {
                _id: 'source-1',
                title: 'Source 1',
                count: 0,
                importDate: '',
                autoRefresh: false,
                vpnAutoConnectOnOpen: true,
                vpnLocation: 'hr',
                vpnProvider: 'proton',
            },
            'source-open'
        );

        expect(prepareSourceVpn).toHaveBeenCalledWith({
            location: 'HR',
            provider: 'proton',
            reason: 'source-open',
            sourceId: 'source-1',
            sourceTitle: 'Source 1',
        });
    });

    it('prepares Proton on startup only when the default-source checkbox is enabled', async () => {
        const service = new SourceVpnPreparationService();

        await service.prepareForPlaylist(
            {
                _id: 'source-1',
                title: 'Source 1',
                count: 0,
                importDate: '',
                autoRefresh: false,
                vpnAutoConnectOnOpen: false,
                vpnAutoConnectWhenDefault: true,
                vpnLocation: 'DE',
                vpnProvider: 'proton',
            },
            'default-source-startup'
        );

        expect(prepareSourceVpn).toHaveBeenCalledWith(
            expect.objectContaining({
                location: 'DE',
                reason: 'default-source-startup',
            })
        );
    });

    it('does not prepare anything when the matching checkbox is disabled', async () => {
        const service = new SourceVpnPreparationService();

        await service.prepareForPlaylist(
            {
                _id: 'source-1',
                title: 'Source 1',
                count: 0,
                importDate: '',
                autoRefresh: false,
                vpnAutoConnectOnOpen: false,
                vpnAutoConnectWhenDefault: true,
                vpnLocation: 'DE',
                vpnProvider: 'proton',
            },
            'source-open'
        );

        expect(prepareSourceVpn).not.toHaveBeenCalled();
    });

    it('exposes in-flight and last status state while preparing a source VPN', async () => {
        const service = new SourceVpnPreparationService();
        const deferred = createDeferred<Awaited<ReturnType<typeof prepareSourceVpn>>>();
        prepareSourceVpn.mockReturnValueOnce(deferred.promise);

        const preparation = service.prepareForPlaylist(
            {
                _id: 'source-1',
                title: 'Source 1',
                count: 0,
                importDate: '',
                autoRefresh: false,
                vpnAutoConnectOnOpen: true,
                vpnLocation: 'HR',
                vpnProvider: 'proton',
            },
            'source-open'
        );

        expect(service.preparingSourceId()).toBe('source-1');

        deferred.resolve({
            enabled: true,
            location: 'HR',
            platform: 'win32',
            provider: 'proton',
            status: 'configured',
            lastCheckedAt: Date.now(),
        });
        await preparation;

        expect(service.preparingSourceId()).toBeNull();
        expect(service.lastStatus()).toEqual(
            expect.objectContaining({
                location: 'HR',
                status: 'configured',
            })
        );
        expect(service.lastError()).toBeNull();
    });

    it('retries failed source VPN preparation attempts instead of deduping them', async () => {
        const service = new SourceVpnPreparationService();
        prepareSourceVpn.mockResolvedValueOnce({
            enabled: true,
            location: 'HR',
            platform: 'win32',
            provider: 'proton',
            reason: 'powershell-timeout',
            status: 'timeout',
            lastCheckedAt: Date.now(),
        });
        const playlist = {
            _id: 'source-1',
            title: 'Source 1',
            count: 0,
            importDate: '',
            autoRefresh: false,
            vpnAutoConnectOnOpen: true,
            vpnLocation: 'HR',
            vpnProvider: 'proton' as const,
        };

        await service.prepareForPlaylist(playlist, 'source-open');
        await service.prepareForPlaylist(playlist, 'source-open');

        expect(prepareSourceVpn).toHaveBeenCalledTimes(2);
        expect(service.lastError()).toBeNull();
    });
});
