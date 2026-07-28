import { XtreamVodStream } from '@iptvnator/shared/interfaces';
import { resolveXtreamVodPlaybackSource } from '../services/xtream-vod-playback-source';
import {
    createXtreamDetailsRequestGuard,
    recoverXtreamVodCatalogItem,
    resolveXtreamVodDetailsSelection,
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

    it('ignores stale catalog owners and resolves against the active playlist', async () => {
        const getAllCategories = jest
            .fn()
            .mockResolvedValue([{ id: 7, xtream_id: 701 }]);
        const getCategories = jest.fn().mockResolvedValue([]);
        const getVodStream = jest.fn().mockResolvedValue({
            stream_id: 42,
            container_extension: 'mkv',
        });
        const resolution = resolveXtreamVodDetailsSelection({
            apiService: { getVodStream },
            currentCategories: [{ id: 7, xtream_id: 999 }],
            currentCategoriesPlaylistId: 'playlist-a',
            currentStreams: [
                {
                    stream_id: 42,
                    container_extension: 'mp4',
                    xtream_id: 42,
                } as XtreamVodStream,
            ],
            currentStreamsPlaylistId: 'playlist-a',
            credentials,
            dataSource: { getAllCategories, getCategories },
            isCurrent: () => true,
            playlistId: 'playlist-b',
            routeCategoryId: 7,
            vodDetails: { info: [] },
            vodId: 42,
        });

        expect(resolveXtreamVodPlaybackSource(resolution.selection)).toBeNull();
        expect(resolution.recovery).not.toBeNull();
        if (!resolution.recovery) {
            throw new Error('Expected catalog recovery to start');
        }
        const result = await resolution.recovery;

        expect(resolveXtreamVodPlaybackSource(result.selection)).toEqual({
            streamId: 42,
            containerExtension: 'mkv',
        });
        expect(getAllCategories).toHaveBeenCalledWith('playlist-b', 'movies');
        expect(getCategories).not.toHaveBeenCalled();
        expect(getVodStream).toHaveBeenCalledWith(credentials, 42, 701);
    });

    it('uses a catalog pair owned by the active playlist without recovery', () => {
        const getAllCategories = jest.fn();
        const getCategories = jest.fn();
        const getVodStream = jest.fn();
        const result = resolveXtreamVodDetailsSelection({
            apiService: { getVodStream },
            currentCategories: [],
            currentCategoriesPlaylistId: 'playlist-b',
            currentStreams: [
                {
                    stream_id: 42,
                    container_extension: 'mp4',
                    xtream_id: 42,
                } as XtreamVodStream,
            ],
            currentStreamsPlaylistId: 'playlist-b',
            credentials,
            dataSource: { getAllCategories, getCategories },
            isCurrent: () => true,
            playlistId: 'playlist-b',
            routeCategoryId: 7,
            vodDetails: { info: [] },
            vodId: 42,
        });

        expect(resolveXtreamVodPlaybackSource(result.selection)).toEqual({
            streamId: 42,
            containerExtension: 'mp4',
        });
        expect(result.recovery).toBeNull();
        expect(getAllCategories).not.toHaveBeenCalled();
        expect(getCategories).not.toHaveBeenCalled();
        expect(getVodStream).not.toHaveBeenCalled();
    });

    it('returns sparse details before catalog recovery completes', async () => {
        let resolveCatalogItem!: (item: XtreamVodStream | null) => void;
        const getVodStream = jest.fn(
            () =>
                new Promise<XtreamVodStream | null>((resolve) => {
                    resolveCatalogItem = resolve;
                })
        );
        const resolution = resolveXtreamVodDetailsSelection({
            apiService: { getVodStream },
            currentCategories: [{ id: 7, xtream_id: 701 }],
            currentCategoriesPlaylistId: 'playlist-b',
            currentStreams: [],
            currentStreamsPlaylistId: 'playlist-b',
            credentials,
            dataSource: {
                getAllCategories: jest.fn(),
                getCategories: jest.fn(),
            },
            isCurrent: () => true,
            playlistId: 'playlist-b',
            routeCategoryId: 7,
            vodDetails: { info: [] },
            vodId: 42,
        });

        expect(resolution).not.toBeInstanceOf(Promise);
        expect(resolveXtreamVodPlaybackSource(resolution.selection)).toBeNull();
        expect(resolution.recovery).not.toBeNull();
        if (!resolution.recovery) {
            return;
        }

        let recoverySettled = false;
        void resolution.recovery.finally(() => {
            recoverySettled = true;
        });
        await Promise.resolve();
        expect(recoverySettled).toBe(false);

        resolveCatalogItem({
            stream_id: 42,
            container_extension: 'mkv',
        } as XtreamVodStream);

        await expect(resolution.recovery).resolves.toEqual(
            expect.objectContaining({
                selection: expect.objectContaining({
                    stream_id: 42,
                    container_extension: 'mkv',
                }),
            })
        );
    });

    it('contains catalog recovery errors without rejecting the fallback', async () => {
        const recoveryError = new Error('Catalog unavailable');
        const resolution = resolveXtreamVodDetailsSelection({
            apiService: {
                getVodStream: jest.fn().mockRejectedValue(recoveryError),
            },
            currentCategories: [{ id: 7, xtream_id: 701 }],
            currentCategoriesPlaylistId: 'playlist-b',
            currentStreams: [],
            currentStreamsPlaylistId: 'playlist-b',
            credentials,
            dataSource: {
                getAllCategories: jest.fn(),
                getCategories: jest.fn(),
            },
            isCurrent: () => true,
            playlistId: 'playlist-b',
            routeCategoryId: 7,
            vodDetails: { info: [] },
            vodId: 42,
        });

        expect(resolution.recovery).not.toBeNull();
        await expect(resolution.recovery).resolves.toEqual({
            recoveredCatalogItem: null,
            recoveryError,
            selection: resolution.selection,
        });
    });
});
