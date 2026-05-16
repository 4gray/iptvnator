import { TestBed } from '@angular/core/testing';
import { XtreamApiService } from '../services/xtream-api.service';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';

describe('PwaXtreamDataSource', () => {
    let dataSource: PwaXtreamDataSource;
    let apiService: {
        getStreams: jest.Mock;
    };

    const credentials = {
        serverUrl: 'http://localhost:3211',
        username: 'user1',
        password: 'pass1',
    };

    beforeEach(() => {
        localStorage.clear();
        apiService = {
            getStreams: jest.fn().mockResolvedValue([
                {
                    stream_id: 20203,
                    category_id: '206',
                    name: 'Movie',
                    title: 'Movie',
                    stream_type: 'movie',
                    type: 'movie',
                },
            ]),
        };

        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                {
                    provide: XtreamApiService,
                    useValue: apiService,
                },
            ],
        });

        dataSource = TestBed.inject(PwaXtreamDataSource);
    });

    function createFreshDataSource(): PwaXtreamDataSource {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                {
                    provide: XtreamApiService,
                    useValue: apiService,
                },
            ],
        });
        return TestBed.inject(PwaXtreamDataSource);
    }

    it('finds VOD cached under vod when callers request movie content', async () => {
        await dataSource.getContent('playlist-1', credentials, 'vod');

        await expect(
            dataSource.getContentByXtreamId(20203, 'playlist-1', 'movie')
        ).resolves.toMatchObject({
            stream_id: 20203,
            title: 'Movie',
        });
    });

    it('matches PWA favorites and recent items against VOD cache entries', async () => {
        await dataSource.getContent('playlist-1', credentials, 'vod');

        await dataSource.addFavorite(20203, 'playlist-1');
        await dataSource.addRecentItem(20203, 'playlist-1');

        await expect(dataSource.getFavorites('playlist-1')).resolves.toEqual([
            expect.objectContaining({ stream_id: 20203 }),
        ]);
        await expect(dataSource.getRecentItems('playlist-1')).resolves.toEqual([
            expect.objectContaining({ stream_id: 20203 }),
        ]);
    });

    it('restores PWA favorites and recent items from persisted content snapshots after reload', async () => {
        await dataSource.getContent('playlist-1', credentials, 'vod');

        await dataSource.addFavorite(20203, 'playlist-1');
        await dataSource.addRecentItem(20203, 'playlist-1');

        const freshDataSource = createFreshDataSource();

        await expect(
            freshDataSource.getFavorites('playlist-1')
        ).resolves.toEqual([
            expect.objectContaining({
                stream_id: 20203,
                title: 'Movie',
            }),
        ]);
        await expect(
            freshDataSource.getRecentItems('playlist-1')
        ).resolves.toEqual([
            expect.objectContaining({
                stream_id: 20203,
                title: 'Movie',
                viewed_at: expect.any(String),
            }),
        ]);
    });

    it('keeps PWA favorites in restore state when only stored snapshots are available', async () => {
        await dataSource.getContent('playlist-1', credentials, 'vod');

        await dataSource.addFavorite(20203, 'playlist-1');
        await dataSource.addRecentItem(20203, 'playlist-1');

        const freshDataSource = createFreshDataSource();
        const restoreState =
            await freshDataSource.clearPlaylistContent('playlist-1');

        expect(restoreState.favorites).toEqual([
            expect.objectContaining({
                contentType: 'movie',
                xtreamId: 20203,
            }),
        ]);
        expect(restoreState.recentlyViewed).toEqual([
            expect.objectContaining({
                contentType: 'movie',
                xtreamId: 20203,
                viewedAt: expect.any(String),
            }),
        ]);
    });

    it('restores PWA favorites and recent items with snapshots after content refresh', async () => {
        await dataSource.getContent('playlist-1', credentials, 'vod');

        await dataSource.addFavorite(20203, 'playlist-1');
        await dataSource.addRecentItem(20203, 'playlist-1');

        const restoreState =
            await dataSource.clearPlaylistContent('playlist-1');
        await dataSource.restoreUserData('playlist-1', restoreState);

        const freshDataSource = createFreshDataSource();

        await expect(
            freshDataSource.getFavorites('playlist-1')
        ).resolves.toEqual([
            expect.objectContaining({
                stream_id: 20203,
                title: 'Movie',
            }),
        ]);
        await expect(
            freshDataSource.getRecentItems('playlist-1')
        ).resolves.toEqual([
            expect.objectContaining({
                stream_id: 20203,
                title: 'Movie',
                viewed_at: expect.any(String),
            }),
        ]);
    });
});
