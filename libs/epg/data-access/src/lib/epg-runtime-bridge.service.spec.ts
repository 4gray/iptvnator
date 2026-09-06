import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';

describe('EpgRuntimeBridgeService', () => {
    let service: EpgRuntimeBridgeService;
    let runtimeCapabilities: Partial<RuntimeCapabilitiesService>;
    const originalElectron = window.electron;

    beforeEach(() => {
        runtimeCapabilities = {
            supportsEpgImport: false,
            supportsEpgProgress: false,
            supportsEpgProgramLookup: false,
            supportsEpgCurrentProgramBatch: false,
            supportsEpgChannelMetadata: false,
            supportsEpgSourceFreshness: false,
            supportsEpgDataManagement: false,
            supportsEpgGuide: false,
            supportsEpgProgramSearch: false,
        };

        TestBed.configureTestingModule({
            providers: [
                EpgRuntimeBridgeService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
            ],
        });

        service = TestBed.inject(EpgRuntimeBridgeService);
    });

    afterEach(() => {
        window.electron = originalElectron;
        TestBed.resetTestingModule();
        jest.restoreAllMocks();
    });

    it('does not call Electron EPG methods when the matching capability is unavailable', async () => {
        const fetchEpg = jest.fn().mockResolvedValue({ success: true });
        const checkEpgFreshness = jest.fn().mockResolvedValue({
            freshUrls: [],
            staleUrls: [],
        });
        window.electron = {
            ...window.electron,
            fetchEpg,
            checkEpgFreshness,
        } as unknown as typeof window.electron;

        await expect(
            service.fetchEpg(['https://example.com/epg.xml'])
        ).resolves.toBeNull();
        await expect(
            service.checkFreshness(['https://example.com/epg.xml'], 12)
        ).resolves.toBeNull();

        expect(fetchEpg).not.toHaveBeenCalled();
        expect(checkEpgFreshness).not.toHaveBeenCalled();
    });

    it('delegates import and data-management calls through the typed Electron bridge', async () => {
        const fetchEpg = jest.fn().mockResolvedValue({ success: true });
        const forceFetchEpg = jest.fn().mockResolvedValue({ success: true });
        const clearEpgData = jest.fn().mockResolvedValue({ success: true });
        const clearEpgDataForSource = jest
            .fn()
            .mockResolvedValue({ success: true });
        window.electron = {
            ...window.electron,
            fetchEpg,
            forceFetchEpg,
            clearEpgData,
            clearEpgDataForSource,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpgImport = true;
        runtimeCapabilities.supportsEpgDataManagement = true;

        await expect(
            service.fetchEpg(['https://example.com/epg.xml'])
        ).resolves.toEqual({ success: true });
        await expect(
            service.forceFetchEpg('https://example.com/epg.xml')
        ).resolves.toEqual({ success: true });
        await expect(service.clearEpgData()).resolves.toEqual({
            success: true,
        });
        await expect(
            service.clearEpgDataForSource(
                ' https://playlist.example.com/guide.xml '
            )
        ).resolves.toEqual({
            success: true,
        });

        expect(fetchEpg).toHaveBeenCalledWith(
            ['https://example.com/epg.xml'],
            undefined
        );
        expect(forceFetchEpg).toHaveBeenCalledWith(
            'https://example.com/epg.xml',
            undefined
        );
        expect(clearEpgData).toHaveBeenCalledTimes(1);
        expect(clearEpgDataForSource).toHaveBeenCalledWith(
            'https://playlist.example.com/guide.xml'
        );
    });

    it('delegates read-side EPG calls through the typed Electron bridge', async () => {
        const getChannelPrograms = jest.fn().mockResolvedValue([]);
        const getCurrentProgramsBatch = jest.fn().mockResolvedValue({
            'channel-1': null,
        });
        const getEpgChannelMetadata = jest.fn().mockResolvedValue({
            'channel-1': null,
        });
        const checkEpgFreshness = jest.fn().mockResolvedValue({
            freshUrls: ['https://example.com/epg.xml'],
            staleUrls: [],
        });
        const searchEpgPrograms = jest.fn().mockResolvedValue([]);
        window.electron = {
            ...window.electron,
            getChannelPrograms,
            getCurrentProgramsBatch,
            getEpgChannelMetadata,
            checkEpgFreshness,
            searchEpgPrograms,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpgProgramLookup = true;
        runtimeCapabilities.supportsEpgCurrentProgramBatch = true;
        runtimeCapabilities.supportsEpgChannelMetadata = true;
        runtimeCapabilities.supportsEpgSourceFreshness = true;
        runtimeCapabilities.supportsEpgProgramSearch = true;

        await service.getChannelPrograms('channel-1');
        await service.getCurrentProgramsBatch(['channel-1'], {
            sourceUrls: ['https://playlist.example.com/guide.xml'],
        });
        await service.getChannelMetadata(['channel-1'], {
            sourceUrls: ['https://playlist.example.com/guide.xml'],
        });
        await service.checkFreshness(['https://example.com/epg.xml'], 12);
        await service.searchPrograms('news', 20);

        expect(getChannelPrograms).toHaveBeenCalledWith('channel-1');
        expect(getCurrentProgramsBatch).toHaveBeenCalledWith(['channel-1'], {
            sourceUrls: ['https://playlist.example.com/guide.xml'],
        });
        expect(getEpgChannelMetadata).toHaveBeenCalledWith(['channel-1'], {
            sourceUrls: ['https://playlist.example.com/guide.xml'],
        });
        expect(checkEpgFreshness).toHaveBeenCalledWith(
            ['https://example.com/epg.xml'],
            12
        );
        expect(searchEpgPrograms).toHaveBeenCalledWith('news', 20);
    });

    it('forwards guide reads when the runtime supports them', async () => {
        const getEpgProgramsForChannels = jest
            .fn()
            .mockResolvedValue({ a: [] });
        const getEpgProgramCoverage = jest.fn().mockResolvedValue(['a']);
        window.electron = {
            ...window.electron,
            getEpgProgramsForChannels,
            getEpgProgramCoverage,
        } as unknown as typeof window.electron;
        runtimeCapabilities.supportsEpgGuide = true;

        const window_ = { channelIds: ['a'], fromMs: 1, toMs: 2 };
        await expect(service.getProgramsForChannels(window_)).resolves.toEqual(
            { a: [] }
        );
        await expect(service.getProgramCoverage(window_)).resolves.toEqual([
            'a',
        ]);
        expect(getEpgProgramsForChannels).toHaveBeenCalledWith(window_);
        expect(getEpgProgramCoverage).toHaveBeenCalledWith(window_);
    });

    it('answers null for guide reads without runtime support or channels', async () => {
        runtimeCapabilities.supportsEpgGuide = false;
        await expect(
            service.getProgramsForChannels({
                channelIds: ['a'],
                fromMs: 1,
                toMs: 2,
            })
        ).resolves.toBeNull();
        runtimeCapabilities.supportsEpgGuide = true;
        await expect(
            service.getProgramCoverage({ channelIds: [], fromMs: 1, toMs: 2 })
        ).resolves.toBeNull();
    });

    it('subscribes to EPG progress only when progress events are supported', () => {
        const onEpgProgress = jest.fn();
        window.electron = {
            ...window.electron,
            onEpgProgress,
        } as unknown as typeof window.electron;

        service.onProgress(jest.fn());

        expect(onEpgProgress).not.toHaveBeenCalled();

        runtimeCapabilities.supportsEpgProgress = true;
        const callback = jest.fn();
        service.onProgress(callback);

        expect(onEpgProgress).toHaveBeenCalledWith(callback);
    });
});
