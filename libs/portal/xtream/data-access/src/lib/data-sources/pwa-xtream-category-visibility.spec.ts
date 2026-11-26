import { TestBed } from '@angular/core/testing';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';
import {
    XtreamApiService,
    XtreamCredentials,
} from '../services/xtream-api.service';
import { ParentalLockService } from '@iptvnator/services';

describe('PwaXtreamDataSource category visibility', () => {
    let dataSource: PwaXtreamDataSource;
    let apiService: {
        getStreams: jest.Mock;
        getCategories: jest.Mock;
    };
    const credentials: XtreamCredentials = {
        serverUrl: 'http://localhost:3211',
        username: 'demo',
        password: 'secret',
    };

    beforeEach(() => {
        localStorage.clear();

        apiService = {
            getStreams: jest.fn(),
            getCategories: jest.fn(),
        };
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                {
                    provide: ParentalLockService,
                    useValue: {
                        active: () => false,
                        lockedXtreamIds: () => [],
                    },
                },
                {
                    provide: XtreamApiService,
                    useValue: apiService,
                },
            ],
        });

        dataSource = TestBed.inject(PwaXtreamDataSource);
    });

    afterEach(() => {
        localStorage.clear();
    });

    it.each([
        ['live', 'live', 'live', { stream_id: 1 }],
        ['vod', 'movie', 'movies', { stream_id: 1 }],
        ['series', 'series', 'series', { series_id: 1 }],
    ] as const)(
        'filters persisted %s visibility on cold and cached reads',
        async (categoryType, streamType, dbType, identity) => {
            apiService.getCategories.mockResolvedValue([
                { category_id: '007', category_name: 'Hidden genre' },
                { category_id: '8', category_name: 'Visible genre' },
            ]);
            apiService.getStreams.mockResolvedValue([
                { ...identity, name: 'Synthetic title', category_id: '007' },
            ]);
            localStorage.setItem(
                'xtream-category-visibility:source',
                JSON.stringify({
                    version: 1,
                    categories: [
                        { categoryType: dbType, xtreamId: 7, hidden: true },
                    ],
                })
            );

            expect(
                await dataSource.getCategories(
                    'source',
                    credentials,
                    categoryType
                )
            ).toEqual([{ category_id: '8', category_name: 'Visible genre' }]);
            expect(
                await dataSource.getContent('source', credentials, streamType)
            ).toEqual([]);
            expect(
                await dataSource.searchContent(
                    'source',
                    'synthetic',
                    [streamType],
                    true
                )
            ).toEqual([]);
            expect(
                await dataSource.searchContent(
                    'source',
                    'synthetic',
                    [streamType],
                    false
                )
            ).toHaveLength(1);
            expect(await dataSource.getAllCategories('source', dbType)).toEqual(
                [
                    expect.objectContaining({ xtream_id: 7, hidden: true }),
                    expect.objectContaining({ xtream_id: 8, hidden: false }),
                ]
            );
            expect(
                await dataSource.getContent(
                    'another-source',
                    credentials,
                    streamType
                )
            ).toHaveLength(1);

            localStorage.removeItem('xtream-category-visibility:source');
            expect(
                await dataSource.getContent('source', credentials, streamType)
            ).toHaveLength(1);
            expect(
                await dataSource.getCategories(
                    'source',
                    credentials,
                    categoryType
                )
            ).toHaveLength(2);
        }
    );
    it('keeps browsing available if storage is damaged and clears the preference on deletion', async () => {
        const key = 'xtream-category-visibility:source';
        localStorage.setItem(key, '{');
        apiService.getCategories.mockResolvedValue([
            { category_id: '7', category_name: 'Synthetic genre' },
            { category_id: '', category_name: 'Missing ID' },
        ]);
        expect(
            await dataSource.getCategories('source', credentials, 'live')
        ).toHaveLength(2);
        expect(await dataSource.getAllCategories('source', 'live')).toEqual([
            expect.objectContaining({ xtream_id: 7, hidden: false }),
        ]);
        await dataSource.deletePlaylist('source');
        expect(localStorage.getItem(key)).toBeNull();
    });
});
