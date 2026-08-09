import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import { UnifiedFavoriteChannel } from '@iptvnator/portal/shared/util';
import { GlobalFavoritesService } from './global-favorites.service';
import { of } from 'rxjs';

describe('GlobalFavoritesService', () => {
    let service: GlobalFavoritesService;
    let electronApi: {
        dbGetAppState: jest.Mock;
        dbReorderGlobalFavorites: jest.Mock;
        dbSetAppState: jest.Mock;
    };
    const storeSelect = jest.fn();
    const getPlaylistById = jest.fn();

    const makeChannel = (
        overrides: Partial<UnifiedFavoriteChannel> &
            Pick<UnifiedFavoriteChannel, 'uid' | 'sourceType' | 'playlistId'>
    ): UnifiedFavoriteChannel => ({
        name: 'Channel',
        logo: null,
        playlistName: 'Playlist',
        addedAt: new Date(0).toISOString(),
        position: 0,
        ...overrides,
    });

    beforeEach(() => {
        storeSelect.mockReset().mockReturnValue(of([]));
        getPlaylistById.mockReset();
        electronApi = {
            dbGetAppState: jest.fn().mockResolvedValue(null),
            dbReorderGlobalFavorites: jest
                .fn()
                .mockResolvedValue({ success: true }),
            dbSetAppState: jest.fn().mockResolvedValue({ success: true }),
        };
        Object.defineProperty(window, 'electron', {
            value: electronApi as unknown as Window['electron'],
            configurable: true,
        });

        TestBed.configureTestingModule({
            providers: [
                GlobalFavoritesService,
                { provide: Store, useValue: { select: storeSelect } },
                { provide: DatabaseService, useValue: {} },
                {
                    provide: PlaylistsService,
                    useValue: { getPlaylistById },
                },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(GlobalFavoritesService);
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
    });

    it('keeps legacy URL UIDs aligned with the persisted M3U order', async () => {
        const firstUrl = 'https://streams.example/one.ts';
        const secondUrl = 'https://streams.example/two.ts';
        storeSelect.mockReturnValue(
            of([
                {
                    _id: 'playlist-one',
                    title: 'Playlist',
                    favorites: [firstUrl, secondUrl],
                },
            ])
        );
        getPlaylistById.mockReturnValue(
            of({
                playlist: {
                    items: [
                        {
                            id: 'channel-one',
                            name: 'Channel One',
                            url: firstUrl,
                        },
                        {
                            id: 'channel-two',
                            name: 'Channel Two',
                            url: secondUrl,
                        },
                    ],
                },
            })
        );
        electronApi.dbGetAppState.mockResolvedValue(
            JSON.stringify([
                `m3u::playlist-one::${secondUrl}`,
                `m3u::playlist-one::${firstUrl}`,
            ])
        );

        const channels = await service.getUnifiedLiveFavorites();

        expect(channels.map((channel) => channel.uid)).toEqual([
            `m3u::playlist-one::${secondUrl}`,
            `m3u::playlist-one::${firstUrl}`,
        ]);
        expect(channels.map((channel) => channel.position)).toEqual([0, 1]);
    });

    describe('reorder', () => {
        it('sends playlist-scoped position updates for Xtream favorites', async () => {
            // The backend UPDATE filters by (contentId, playlistId); a payload
            // without playlist_id silently matches no rows (PR #1143 review).
            const channels: UnifiedFavoriteChannel[] = [
                makeChannel({
                    uid: 'xtream::playlist-b::20',
                    sourceType: 'xtream',
                    playlistId: 'playlist-b',
                    contentId: 202,
                }),
                makeChannel({
                    uid: 'm3u::playlist-m::url',
                    sourceType: 'm3u',
                    playlistId: 'playlist-m',
                }),
                makeChannel({
                    uid: 'xtream::playlist-a::10',
                    sourceType: 'xtream',
                    playlistId: 'playlist-a',
                    contentId: 101,
                }),
            ];

            await service.reorder(channels);

            expect(electronApi.dbReorderGlobalFavorites).toHaveBeenCalledWith([
                { content_id: 202, playlist_id: 'playlist-b', position: 0 },
                { content_id: 101, playlist_id: 'playlist-a', position: 1 },
            ]);
        });

        it('persists the full uid order and skips the DB write without Xtream items', async () => {
            const channels: UnifiedFavoriteChannel[] = [
                makeChannel({
                    uid: 'm3u::playlist-m::url',
                    sourceType: 'm3u',
                    playlistId: 'playlist-m',
                }),
                makeChannel({
                    uid: 'stalker::playlist-s::5',
                    sourceType: 'stalker',
                    playlistId: 'playlist-s',
                }),
            ];

            await service.reorder(channels);

            expect(electronApi.dbReorderGlobalFavorites).not.toHaveBeenCalled();
            expect(electronApi.dbSetAppState).toHaveBeenCalledWith(
                'global-favorites-channel-order-v1',
                JSON.stringify([
                    'm3u::playlist-m::url',
                    'stalker::playlist-s::5',
                ])
            );
        });
    });
});
