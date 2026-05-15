import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { of } from 'rxjs';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import { withRecentItems } from './with-recent-items';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const TestRecentItemsStore = signalStore(withRecentItems());

describe('withRecentItems', () => {
    let store: InstanceType<typeof TestRecentItemsStore>;
    let databaseService: {
        addRecentItem: jest.Mock;
        getContentByXtreamId: jest.Mock;
        getRecentItems: jest.Mock;
        setContentBackdropIfMissing: jest.Mock;
    };

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            value: {} as Window['electron'],
            configurable: true,
        });

        databaseService = {
            addRecentItem: jest.fn().mockResolvedValue(undefined),
            getContentByXtreamId: jest.fn(),
            getRecentItems: jest.fn().mockResolvedValue([
                {
                    id: 3941697,
                    title: 'Krypton',
                    type: 'series',
                    poster_url: 'https://example.com/krypton.png',
                    backdrop_url: 'https://example.com/krypton-backdrop.png',
                    viewed_at: '2026-04-21T20:42:27.000Z',
                    xtream_id: 290,
                    category_id: 17,
                },
            ]),
            setContentBackdropIfMissing: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            providers: [
                TestRecentItemsStore,
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: PlaylistsService,
                    useValue: {
                        clearPlaylistRecentlyViewed: jest.fn().mockReturnValue(
                            of(undefined)
                        ),
                        getAllPlaylists: jest.fn().mockReturnValue(of([])),
                    },
                },
            ],
        });

        store = TestBed.inject(TestRecentItemsStore);
    });

    it('looks recent items up with the requested content type before saving one', async () => {
        databaseService.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        store.addRecentItem({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(databaseService.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(databaseService.addRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1',
            undefined
        );
        expect(store.recentItems()).toEqual([
            expect.objectContaining({
                id: 3941697,
                title: 'Krypton',
                type: 'series',
                xtream_id: 290,
                backdrop_url: 'https://example.com/krypton-backdrop.png',
            }),
        ]);
    });

    it('forwards backdrop urls on recent-item saves', async () => {
        databaseService.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        store.addRecentItem({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            backdropUrl: 'https://example.com/krypton-backdrop.png',
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(databaseService.addRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1',
            'https://example.com/krypton-backdrop.png'
        );
    });

    it('backfills a backdrop without rewriting recent ordering', async () => {
        databaseService.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        await store.backfillContentBackdrop({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            backdropUrl: ' https://example.com/krypton-backdrop.png ',
        });

        expect(databaseService.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(
            databaseService.setContentBackdropIfMissing
        ).toHaveBeenCalledWith(
            3941697,
            'https://example.com/krypton-backdrop.png'
        );
        expect(databaseService.addRecentItem).not.toHaveBeenCalled();
    });
});
