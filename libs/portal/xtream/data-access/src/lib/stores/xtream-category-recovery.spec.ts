import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import { recoverXtreamVodCatalogItem } from './xtream-details-request';
import { findCollectionItems } from '../data-sources/pwa-collection-identity';
import type { XtreamContentItem } from '../data-sources/xtream-data-source.interface';

describe('Xtream VOD category recovery', () => {
    const credentials = {
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };

    it.each(['10', undefined])(
        'recovers a protected PWA snapshot through its current category instead of %s',
        async (savedCategory) => {
            const saved = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Saved title',
                poster_url: 'saved.jpg',
                tmdb_id: 100,
                category_id: savedCategory,
            } as XtreamContentItem;
            const current = {
                id: 42,
                xtream_id: 42,
                type: 'movie',
                title: 'Unconfirmed title',
                poster_url: 'new.jpg',
                category_id: '20',
            } as XtreamContentItem;
            const row = findCollectionItems(
                ['movie:42'],
                [current],
                { 'movie:42': saved },
                false
            ).get('movie:42');
            if (!row) throw new Error('Missing resolved favorite');
            expect(row).toMatchObject({
                title: 'Saved title',
                poster_url: 'saved.jpg',
                tmdb_id: 100,
            });
            const recovered = {
                stream_id: 42,
                container_extension: 'mp4',
            } as XtreamVodStream;
            const getVodStream = jest.fn(async (_credentials, _id, category) =>
                Number(category) === 20 ? recovered : null
            );
            await expect(
                recoverXtreamVodCatalogItem({
                    apiService: { getVodStream },
                    currentCategories: [],
                    credentials,
                    dataSource: {
                        getAllCategories: jest.fn().mockResolvedValue([]),
                        getCategories: jest
                            .fn()
                            .mockResolvedValue([
                                { category_id: '10' },
                                { category_id: '20' },
                            ]),
                    },
                    isCurrent: () => true,
                    playlistId: 'p1',
                    routeCategoryId: row.category_id,
                    vodId: 42,
                })
            ).resolves.toBe(recovered);
            expect(getVodStream).toHaveBeenCalledWith(credentials, 42, '20');
        }
    );

    it('tries a local category mapping before a colliding provider id', async () => {
        const recoveredItem = {
            stream_id: 42,
            container_extension: 'mp4',
        } as XtreamVodStream;
        const getVodStream = jest.fn(
            async (
                _credentials: typeof credentials,
                _vodId: string | number,
                categoryId: string | number
            ) => (Number(categoryId) === 7 ? recoveredItem : null)
        );
        const getAllCategories = jest.fn();
        const getCategories = jest.fn();

        await expect(
            recoverXtreamVodCatalogItem({
                apiService: { getVodStream },
                currentCategories: [
                    { id: 7, xtream_id: 701 },
                    { id: 8, xtream_id: 7 },
                ],
                credentials,
                dataSource: { getAllCategories, getCategories },
                isCurrent: () => true,
                playlistId: 'playlist-a',
                routeCategoryId: 7,
                vodId: 42,
            })
        ).resolves.toBe(recoveredItem);
        expect(getVodStream.mock.calls).toEqual([
            [credentials, 42, 701],
            [credentials, 42, 7],
        ]);
        expect(getAllCategories).not.toHaveBeenCalled();
        expect(getCategories).not.toHaveBeenCalled();
    });

    it('deduplicates one provider category across all category sources', async () => {
        const getVodStream = jest.fn().mockResolvedValue(null);
        const getAllCategories = jest
            .fn()
            .mockResolvedValue([{ id: 7, xtream_id: 7 }]);
        const getCategories = jest
            .fn()
            .mockResolvedValue([{ category_id: '7' }]);

        await expect(
            recoverXtreamVodCatalogItem({
                apiService: { getVodStream },
                currentCategories: [{ id: 7, xtream_id: 7 }],
                credentials,
                dataSource: { getAllCategories, getCategories },
                isCurrent: () => true,
                playlistId: 'playlist-a',
                routeCategoryId: 7,
                vodId: 42,
            })
        ).resolves.toBeNull();
        expect(getVodStream).toHaveBeenCalledTimes(1);
        expect(getVodStream).toHaveBeenCalledWith(credentials, 42, 7);
    });

    it('does not request a VOD for an unresolved route category', async () => {
        const getVodStream = jest.fn();
        const getAllCategories = jest
            .fn()
            .mockResolvedValue([{ id: 8, xtream_id: 701 }]);
        const getCategories = jest
            .fn()
            .mockResolvedValue([{ category_id: '702' }]);

        await expect(
            recoverXtreamVodCatalogItem({
                apiService: { getVodStream },
                currentCategories: [],
                credentials,
                dataSource: { getAllCategories, getCategories },
                isCurrent: () => true,
                playlistId: 'playlist-a',
                routeCategoryId: 7,
                vodId: 42,
            })
        ).resolves.toBeNull();
        expect(getVodStream).not.toHaveBeenCalled();
    });
});
