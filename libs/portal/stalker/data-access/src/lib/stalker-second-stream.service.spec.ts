import { TestBed } from '@angular/core/testing';
import { DataService, ParentalLockService } from '@iptvnator/services';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerEpisodeResolver } from './stalker-episode-resolver.service';
import { StalkerFavoritePlaybackResolver } from './stalker-favorite-playback.service';
import { StalkerPortalRepairService } from './stalker-portal-repair.service';
import { StalkerSecondStreamService } from './stalker-second-stream.service';
import { StalkerSessionService } from './stalker-session.service';

describe('Stalker second-stream catalog paging', () => {
    const playlist: PlaylistMeta = {
        _id: 'portal-a',
        title: 'Fixture portal',
        count: 0,
        importDate: '',
        autoRefresh: false,
        portalUrl: 'https://portal.example.test/portal.php',
        macAddress: '02:00:00:00:00:01',
        isFullStalkerPortal: false,
    };
    const sendIpcEvent = jest.fn();
    let service: StalkerSecondStreamService;
    const load = (
        page: number,
        seenPages = new Set<string>(),
        exhaustedCatalogs = new Set<'vod' | 'series'>()
    ) =>
        service.browse(
            playlist,
            'series',
            '',
            page,
            new AbortController().signal,
            seenPages,
            exhaustedCatalogs
        );

    beforeEach(() => {
        sendIpcEvent.mockReset();
        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: { sendIpcEvent } },
                {
                    provide: ParentalLockService,
                    useValue: {
                        withholdsEverything: () => false,
                        isStalkerCategoryLocked: () => false,
                        lockedStalkerIds: () => [],
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: { ensureToken: jest.fn().mockResolvedValue({}) },
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: {
                        applyOverride: (value: unknown) => value,
                        shouldAttemptRepair: () => false,
                    },
                },
                { provide: StalkerEpisodeResolver, useValue: {} },
                { provide: StalkerFavoritePlaybackResolver, useValue: {} },
            ],
        });
        service = TestBed.inject(StalkerSecondStreamService);
    });

    it('rejects an incomplete combined page so the caller can retry it', async () => {
        sendIpcEvent.mockImplementation((_event, request) =>
            request.params.type === 'series'
                ? Promise.reject(new Error('Synthetic provider failure'))
                : Promise.resolve({ js: { data: [] } })
        );
        await expect(load(1)).rejects.toThrow('Synthetic provider failure');
    });

    it('stops repeated raw pages but keeps paging through filtered-out rows', async () => {
        sendIpcEvent.mockImplementation((_event, { params }) =>
            Promise.resolve({
                js: {
                    data:
                        params.type === 'series'
                            ? [{ id: 'regular', name: 'Fixture series' }]
                            : [
                                  {
                                      id: `movie-${params.p}`,
                                      name: 'Fixture movie',
                                      is_series: 0,
                                  },
                              ],
                    total_items: 20,
                },
            })
        );
        const first = await load(1);
        expect(first.items.map((row) => row.name)).toEqual(['Fixture series']);
        const second = await load(2, new Set(first.pageKeys));
        expect(second).toMatchObject({
            items: [],
            hasMore: true,
            exhaustedCatalogs: ['series'],
        });

        await load(
            3,
            new Set(second.pageKeys),
            new Set(second.exhaustedCatalogs)
        );
        expect(
            sendIpcEvent.mock.calls.filter(
                ([, request]) => request.params.p === 3
            )
        ).toHaveLength(1);
    });
});
