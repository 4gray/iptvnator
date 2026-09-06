import { TestBed } from '@angular/core/testing';
import {
    EpgImportProgress,
    EpgRuntimeBridgeService,
} from './epg-runtime-bridge.service';
import { SettingsStore, EpgSourceSettingsService } from '@iptvnator/services';
import { ELECTRON_BRIDGE_SECURITY_ERROR_CODES } from '@iptvnator/shared/interfaces';
import { EpgProgressService } from './epg-progress.service';

describe('EpgProgressService', () => {
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    let sources: { waitForReconciliation: jest.Mock };
    let settingsStore: {
        getSettings: jest.Mock;
        getTrustOptions: jest.Mock;
        updateSettings: jest.Mock;
    };

    beforeEach(() => {
        sources = {
            waitForReconciliation: jest.fn().mockResolvedValue(undefined),
        };
        epgBridge = {
            forceFetchEpg: jest.fn().mockResolvedValue({ success: true }),
            onProgress: jest.fn(),
            supportsDataManagement: false,
            supportsProgress: true,
        };
        settingsStore = {
            getSettings: jest.fn(() => ({
                trustedPrivateNetworkEpgUrls: ['http://192.168.1.20/guide.xml'],
                trustedInsecureTlsHosts: ['playlist.local'],
            })),
            getTrustOptions: jest.fn(() => ({
                trustedPrivateNetworkEpgUrls: ['http://192.168.1.20/guide.xml'],
                trustedInsecureTlsHosts: ['playlist.local'],
            })),
            updateSettings: jest.fn().mockResolvedValue(undefined),
        };
    });

    afterEach(() => {
        jest.useRealTimers();
        TestBed.resetTestingModule();
        jest.restoreAllMocks();
    });

    function configureService(): EpgProgressService {
        TestBed.configureTestingModule({
            providers: [
                EpgProgressService,
                { provide: EpgSourceSettingsService, useValue: sources },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
                {
                    provide: SettingsStore,
                    useValue: settingsStore,
                },
            ],
        });

        return TestBed.inject(EpgProgressService);
    }

    const url = 'https://example.com/epg.xml';
    const emit = (progress: EpgImportProgress) =>
        (epgBridge.onProgress as jest.Mock).mock.calls[0][0](progress);
    const errorRow = (source = url) =>
        emit({
            url: source,
            status: 'error',
            generation: 0,
            errorCode:
                ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate,
        });

    it('removes retained actionable errors when their source is cancelled', async () => {
        epgBridge.supportsDataManagement = true;
        const service = configureService();
        errorRow();
        emit({ url, status: 'cancelled', generation: 0 });
        expect(service.isVisible()).toBe(false);
        await service.retry(url);
        expect(epgBridge.forceFetchEpg).not.toHaveBeenCalled();
    });

    it.each([true, false])(
        'waits for source reconciliation before retrying (removed=%s)',
        async (removed) => {
            epgBridge.supportsDataManagement = true;
            let finish!: () => void;
            sources.waitForReconciliation.mockReturnValue(
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
            );
            const service = configureService();
            errorRow();
            const retry = service.retry(url);
            expect(epgBridge.forceFetchEpg).not.toHaveBeenCalled();
            if (removed) emit({ url, status: 'cancelled', generation: 0 });
            finish();
            await retry;
            expect(epgBridge.forceFetchEpg).toHaveBeenCalledTimes(
                removed ? 0 : 1
            );
        }
    );

    it.each(['private', 'tls'])(
        'does not retry a removed/replaced row after a pending %s trust write',
        async (kind) => {
            epgBridge.supportsDataManagement = true;
            let finish!: () => void;
            settingsStore.updateSettings.mockReturnValue(
                new Promise<void>((resolve) => {
                    finish = resolve;
                })
            );
            const service = configureService();
            errorRow();
            const retry =
                kind === 'private'
                    ? service.trustPrivateNetworkSourceAndRetry(url)
                    : service.trustInsecureTlsHostAndRetry(url);
            emit({ url, status: 'cancelled', generation: 0 });
            emit({ url, status: 'loading', generation: 2 });
            finish();
            await retry;
            expect(epgBridge.forceFetchEpg).not.toHaveBeenCalled();
            expect(service.activeCount()).toBe(1);
        }
    );

    it('does not let an old dismissal timer remove a replacement import', () => {
        jest.useFakeTimers();
        const service = configureService();
        emit({ url, status: 'complete', generation: 0 });
        emit({ url, status: 'cancelled', generation: 0 });
        emit({ url, status: 'loading', generation: 2 });
        jest.advanceTimersByTime(5000);
        expect(service.activeCount()).toBe(1);
        jest.useRealTimers();
    });

    it('does not subscribe to progress events when EPG progress support is disabled', () => {
        epgBridge.supportsProgress = false;
        configureService();

        expect(epgBridge.onProgress).not.toHaveBeenCalled();
    });

    it('removes a retired queued import immediately on cancellation', () => {
        epgBridge.supportsProgress = true;
        const service = configureService();
        const listener = (epgBridge.onProgress as jest.Mock).mock.calls[0][0];
        const url = 'https://removed.example/guide.xml';
        listener({ url, status: 'queued' });
        expect(service.queuedCount()).toBe(1);
        listener({ url, status: 'cancelled' });
        expect(service.queuedCount()).toBe(0);
        expect(service.isVisible()).toBe(false);
    });

    it('keeps a replacement import when an older queued batch finally cancels', () => {
        epgBridge.supportsProgress = true;
        const service = configureService();
        const listener = (epgBridge.onProgress as jest.Mock).mock.calls[0][0];
        const url = 'https://readded.example/guide.xml';
        listener({ url, status: 'queued', generation: 0 });
        listener({ url, status: 'loading', generation: 2 });
        listener({ url, status: 'cancelled', generation: 0 });
        expect(service.activeCount()).toBe(1);
    });

    it('does not force retry when EPG data management is disabled', async () => {
        const service = configureService();

        errorRow();
        await service.retry('https://example.com/epg.xml');

        expect(epgBridge.forceFetchEpg).not.toHaveBeenCalled();
    });

    it('forces retry through the EPG runtime bridge when data management is enabled', async () => {
        epgBridge.supportsDataManagement = true;
        const service = configureService();

        errorRow();
        await service.retry('https://example.com/epg.xml');

        expect(epgBridge.forceFetchEpg).toHaveBeenCalledWith(
            'https://example.com/epg.xml',
            {
                trustedPrivateNetworkEpgUrls: ['http://192.168.1.20/guide.xml'],
                trustedInsecureTlsHosts: ['playlist.local'],
            }
        );
    });

    it('trusts a private-network source and retries it', async () => {
        epgBridge.supportsDataManagement = true;
        const service = configureService();

        errorRow('http://192.168.1.30/guide.xml');
        await service.trustPrivateNetworkSourceAndRetry(
            'http://192.168.1.30/guide.xml'
        );

        expect(settingsStore.updateSettings).toHaveBeenCalledWith({
            trustedPrivateNetworkEpgUrls: [
                'http://192.168.1.20/guide.xml',
                'http://192.168.1.30/guide.xml',
            ],
        });
        expect(epgBridge.forceFetchEpg).toHaveBeenCalledWith(
            'http://192.168.1.30/guide.xml',
            expect.any(Object)
        );
    });

    it('updates imports from EPG runtime bridge progress events', () => {
        let listener: ((progress: EpgImportProgress) => void) | undefined;
        epgBridge.onProgress = jest.fn((callback) => {
            listener = callback;
        });
        epgBridge.supportsProgress = true;
        const service = configureService();

        listener?.({
            url: 'https://example.com/epg.xml',
            status: 'loading',
        });

        expect(epgBridge.onProgress).toHaveBeenCalledTimes(1);
        expect(service.imports()).toEqual([
            {
                url: 'https://example.com/epg.xml',
                status: 'loading',
            },
        ]);
    });
});
