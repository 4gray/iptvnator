import {
    createXtreamDetailsRequestGuard,
    recoverXtreamVodCatalogItem,
} from './xtream-details-request';

describe('Xtream details request coordination', () => {
    const credentials = {
        serverUrl: 'http://demo.example',
        username: 'demo',
        password: 'secret',
    };

    it('invalidates older detail requests and requests from another playlist', () => {
        let currentPlaylistId = 'playlist-a';
        const guard = createXtreamDetailsRequestGuard(() => currentPlaylistId);
        const firstRequestIsCurrent = guard.begin('playlist-a');
        const secondRequestIsCurrent = guard.begin('playlist-a');

        expect(firstRequestIsCurrent()).toBe(false);
        expect(secondRequestIsCurrent()).toBe(true);

        currentPlaylistId = 'playlist-b';
        expect(secondRequestIsCurrent()).toBe(false);

        const thirdRequestIsCurrent = guard.begin('playlist-b');
        guard.invalidate();
        expect(thirdRequestIsCurrent()).toBe(false);
    });

    it('recovers a provider category id from hidden Electron categories', async () => {
        const getAllCategories = jest.fn().mockResolvedValue([
            {
                id: 7,
                xtream_id: 701,
            },
        ]);
        const getCategories = jest.fn().mockResolvedValue([]);
        const getVodStream = jest.fn().mockResolvedValue({
            stream_id: 42,
            container_extension: 'mp4',
        });

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
        ).resolves.toEqual({
            stream_id: 42,
            container_extension: 'mp4',
        });
        expect(getAllCategories).toHaveBeenCalledWith('playlist-a', 'movies');
        expect(getCategories).not.toHaveBeenCalled();
        expect(getVodStream).toHaveBeenCalledWith(credentials, 42, 701);
    });

    it('falls back to the visible API categories when PWA has no persisted categories', async () => {
        const getAllCategories = jest.fn().mockResolvedValue([]);
        const getCategories = jest
            .fn()
            .mockResolvedValue([{ category_id: 701 }]);
        const getVodStream = jest.fn().mockResolvedValue({
            stream_id: 42,
            container_extension: 'mp4',
        });

        await recoverXtreamVodCatalogItem({
            apiService: { getVodStream },
            currentCategories: [],
            credentials,
            dataSource: { getAllCategories, getCategories },
            isCurrent: () => true,
            playlistId: 'playlist-a',
            routeCategoryId: 701,
            vodId: 42,
        });

        expect(getCategories).toHaveBeenCalledWith(
            'playlist-a',
            credentials,
            'vod'
        );
        expect(getVodStream).toHaveBeenCalledWith(credentials, 42, 701);
    });

    it('drops a catalog recovery result after a newer request starts', async () => {
        let isCurrent = true;
        const getVodStream = jest.fn().mockImplementation(async () => {
            isCurrent = false;
            return {
                stream_id: 42,
                container_extension: 'mp4',
            };
        });

        await expect(
            recoverXtreamVodCatalogItem({
                apiService: { getVodStream },
                currentCategories: [{ category_id: 701 }],
                credentials,
                dataSource: {
                    getAllCategories: jest.fn(),
                    getCategories: jest.fn(),
                },
                isCurrent: () => isCurrent,
                playlistId: 'playlist-a',
                routeCategoryId: 701,
                vodId: 42,
            })
        ).resolves.toBeNull();
    });
});
