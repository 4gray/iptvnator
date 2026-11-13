import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { XtreamApiService } from './xtream-api.service';
import { XtreamFullEpgService } from './xtream-full-epg.service';
import { XtreamXmltvFallbackService } from './xtream-xmltv-fallback.service';

describe('XtreamFullEpgService', () => {
    const original = window.electron;
    const getEpgMapping = jest.fn<
        Promise<{ epgChannelId: string }>,
        [string]
    >();
    const getFullEpg = jest.fn(async () => []);
    const getProgramsForChannel = jest.fn(async () => []);
    const credentials = {
        id: 'synthetic-portal',
        serverUrl: 'https://provider.example',
        username: 'sample',
        password: 'sample',
        userAgent: 'Synthetic Client',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        getEpgMapping.mockResolvedValue({
            epgChannelId: ' synthetic.mapped ',
        });
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { getEpgMapping },
        });
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsEpgMapping: true },
                },
                {
                    provide: SettingsStore,
                    useValue: { preferUploadedEpgOverXtream: () => true },
                },
                { provide: XtreamApiService, useValue: { getFullEpg } },
                {
                    provide: XtreamXmltvFallbackService,
                    useValue: {
                        getProgramsForChannel,
                        resolveCurrentEpg:
                            XtreamXmltvFallbackService.prototype
                                .resolveCurrentEpg,
                    },
                },
            ],
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: original,
        });
    });

    it('uses the playlist-scoped mapping with the existing source priority and provider credentials', async () => {
        const options = {
            sessionId: 'synthetic-guide-session',
            signal: new AbortController().signal,
        };
        await TestBed.inject(XtreamFullEpgService).load(
            credentials,
            101,
            'synthetic.original',
            options
        );
        expect(getEpgMapping).toHaveBeenCalledWith(
            'xtream:synthetic-portal:101'
        );
        expect(getProgramsForChannel).toHaveBeenCalledWith('synthetic.mapped');
        expect(getFullEpg).toHaveBeenCalledWith(
            expect.objectContaining({ userAgent: credentials.userAgent }),
            101,
            { ...options, suppressErrorLog: true }
        );
    });

    it('does not start a schedule lookup if the consumer leaves before the mapping returns', async () => {
        let finish!: (mapping: { epgChannelId: string }) => void;
        getEpgMapping.mockImplementation(
            () => new Promise((resolve) => (finish = resolve))
        );
        const controller = new AbortController();
        const result = TestBed.inject(XtreamFullEpgService).load(
            credentials,
            101,
            'synthetic.original',
            { signal: controller.signal }
        );
        controller.abort();
        finish({ epgChannelId: 'synthetic.mapped' });
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(getProgramsForChannel).not.toHaveBeenCalled();
        expect(getFullEpg).not.toHaveBeenCalled();
    });
});
