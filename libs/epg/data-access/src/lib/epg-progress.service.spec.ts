import { TestBed } from '@angular/core/testing';
import {
    EpgImportProgress,
    EpgRuntimeBridgeService,
} from './epg-runtime-bridge.service';
import { EpgProgressService } from './epg-progress.service';

describe('EpgProgressService', () => {
    let epgBridge: Partial<EpgRuntimeBridgeService>;

    beforeEach(() => {
        epgBridge = {
            forceFetchEpg: jest.fn().mockResolvedValue({ success: true }),
            onProgress: jest.fn(),
            supportsDataManagement: false,
            supportsProgress: false,
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
            'https://example.com/epg.xml'
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
