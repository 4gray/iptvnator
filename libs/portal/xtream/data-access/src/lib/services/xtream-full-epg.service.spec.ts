import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { XtreamApiService } from './xtream-api.service';
import { XtreamFullEpgService } from './xtream-full-epg.service';
import { XtreamXmltvFallbackService } from './xtream-xmltv-fallback.service';

describe('XtreamFullEpgService', () => {
    it('uses the playlist-scoped mapping with the existing source priority and provider credentials', async () => {
        const getEpgMapping = jest.fn(async () => ({
            epgChannelId: ' synthetic.mapped ',
        }));
        const original = window.electron;
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { getEpgMapping },
        });
        const getFullEpg = jest.fn(async () => []);
        const getProgramsForChannel = jest.fn(async () => []);
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
        try {
            const credentials = {
                id: 'synthetic-portal',
                serverUrl: 'https://provider.example',
                username: 'sample',
                password: 'sample',
                userAgent: 'Synthetic Client',
            };
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
            expect(getProgramsForChannel).toHaveBeenCalledWith(
                'synthetic.mapped'
            );
            expect(getFullEpg).toHaveBeenCalledWith(
                expect.objectContaining({ userAgent: credentials.userAgent }),
                101,
                { ...options, suppressErrorLog: true }
            );
        } finally {
            Object.defineProperty(window, 'electron', {
                configurable: true,
                value: original,
            });
        }
    });
});
