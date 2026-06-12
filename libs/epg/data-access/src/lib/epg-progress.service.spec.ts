import { TestBed } from '@angular/core/testing';
import {
    EpgImportProgress,
    EpgRuntimeBridgeService,
} from './epg-runtime-bridge.service';
import { SettingsStore } from '@iptvnator/services';
import { EpgProgressService } from './epg-progress.service';

describe('EpgProgressService', () => {
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    let settingsStore: {
        getSettings: jest.Mock;
        getTrustOptions: jest.Mock;
        updateSettings: jest.Mock;
    };

    beforeEach(() => {
        epgBridge = {
            forceFetchEpg: jest.fn().mockResolvedValue({ success: true }),
            onProgress: jest.fn(),
            supportsDataManagement: false,
            supportsProgress: false,
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
        TestBed.resetTestingModule();
        jest.restoreAllMocks();
    });

    function configureService(): EpgProgressService {
        TestBed.configureTestingModule({
            providers: [
                EpgProgressService,
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

    it('does not subscribe to progress events when EPG progress support is disabled', () => {
        configureService();

        expect(epgBridge.onProgress).not.toHaveBeenCalled();
    });

    it('does not force retry when EPG data management is disabled', () => {
        const service = configureService();

        service.retry('https://example.com/epg.xml');

        expect(epgBridge.forceFetchEpg).not.toHaveBeenCalled();
    });

    it('forces retry through the EPG runtime bridge when data management is enabled', () => {
        epgBridge.supportsDataManagement = true;
        const service = configureService();

        service.retry('https://example.com/epg.xml');

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
