import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import { UnifiedFavoriteChannel } from '@iptvnator/portal/shared/util';
import { GlobalFavoritesService } from './global-favorites.service';

describe('GlobalFavoritesService', () => {
    let service: GlobalFavoritesService;
    let electronApi: {
        dbReorderGlobalFavorites: jest.Mock;
        dbSetAppState: jest.Mock;
    };

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
        electronApi = {
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
                { provide: Store, useValue: { select: jest.fn() } },
                { provide: DatabaseService, useValue: {} },
                { provide: PlaylistsService, useValue: {} },
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
                JSON.stringify(['m3u::playlist-m::url', 'stalker::playlist-s::5'])
            );
        });
    });
});
