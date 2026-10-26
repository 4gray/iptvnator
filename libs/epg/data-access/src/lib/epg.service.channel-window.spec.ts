import { TestBed } from '@angular/core/testing';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, of } from 'rxjs';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
import { EpgService } from './epg.service';

describe('EpgService channel window', () => {
    const getProgramsForChannels = jest.fn();
    const getProgramCoverage = jest.fn();
    const resolvedEpgOffsetMinutes = jest.fn();
    let service: EpgService;

    beforeEach(() => {
        getProgramsForChannels.mockReset().mockResolvedValue({});
        getProgramCoverage.mockReset().mockResolvedValue([]);
        resolvedEpgOffsetMinutes.mockReset().mockReturnValue(0);
        TestBed.configureTestingModule({
            providers: [
                EpgService,
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        getProgramsForChannels,
                        getProgramCoverage,
                        supportsGuide: true,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        getSettings: () => ({ epgUrl: [] }),
                        resolvedEpgOffsetMinutes,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getAllPlaylists: () => of([]) },
                },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                {
                    provide: LazySnackBar,
                    useValue: { open: jest.fn() },
                },
            ],
        });
        service = TestBed.inject(EpgService);
    });

    it('keeps navigation available when only another day has programmes', async () => {
        getProgramCoverage.mockResolvedValue(['shared-id']);
        await service.loadChannelProgramsForWindow(
            'shared-id',
            Date.UTC(2026, 8, 10),
            Date.UTC(2026, 8, 11),
            ['enabled-guide']
        );
        expect(getProgramCoverage).toHaveBeenCalledWith({
            channelIds: ['shared-id'],
            fromMs: Date.UTC(1900, 0, 1),
            toMs: Date.UTC(2100, 0, 1),
            sourceUrls: ['enabled-guide'],
        });
        expect(await firstValueFrom(service.currentChannelHasPrograms$)).toBe(
            true
        );
    });

    it('reads the full archive playback range in provider time', async () => {
        const fromMs = Date.UTC(2026, 8, 4);
        const toMs = Date.UTC(2026, 8, 7);
        getProgramsForChannels.mockResolvedValue({
            'shared-id': [
                {
                    channel: 'shared-id',
                    start: '2026-09-05T12:00:00.000Z',
                    stop: '2026-09-05T13:00:00.000Z',
                    title: 'Middle day',
                },
            ],
        });
        resolvedEpgOffsetMinutes.mockReturnValue(60);
        await expect(
            service.getChannelProgramsForProviderWindow(
                'shared-id',
                fromMs,
                toMs,
                ['enabled-guide']
            )
        ).resolves.toMatchObject([{ title: 'Middle day' }]);
        expect(getProgramsForChannels).toHaveBeenCalledWith({
            channelIds: ['shared-id'],
            fromMs,
            toMs,
            sourceUrls: ['enabled-guide'],
        });
    });
});
