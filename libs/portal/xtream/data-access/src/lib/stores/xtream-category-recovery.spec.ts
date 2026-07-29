import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import { recoverXtreamVodCatalogItem } from './xtream-details-request';

describe('Xtream VOD category recovery', () => {
    const credentials = {
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };

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
