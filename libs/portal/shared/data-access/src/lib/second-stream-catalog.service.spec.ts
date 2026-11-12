import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    DataService,
    ParentalLockService,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import {
    StalkerItvCacheService,
    StalkerPortalRepairService,
    StalkerSessionService,
} from '@iptvnator/portal/stalker/data-access';
import { UnifiedFavoritesDataService } from './collection/unified-favorites-data.service';
import { StreamResolverService } from './collection/stream-resolver.service';
import { SecondStreamCatalogService } from './second-stream-catalog.service';

describe('SecondStreamCatalogService', () => {
    let service: SecondStreamCatalogService;
    const playlist = { _id: 'synthetic-source', title: 'Synthetic source' };
    const channel = {
        id: 'c',
        name: 'Synthetic News',
        url: 'https://media.example.test/live',
        group: { title: 'News' },
        tvg: { logo: '' },
        radio: 'false',
    };
    let playlists: { getAllPlaylists: jest.Mock; getPlaylistById: jest.Mock };
    let locks: {
        version: ReturnType<typeof signal<number>>;
        withholdsEverything: jest.Mock;
        isM3uGroupLocked: jest.Mock;
        isXtreamCategoryLocked: jest.Mock;
        isStalkerCategoryLocked: jest.Mock;
    };
    let xtream: {
        getPlaylist: jest.Mock;
        getCategories: jest.Mock;
        getContent: jest.Mock;
        getAllCategories: jest.Mock;
    };
    let resolve: jest.Mock;
    let favorites: jest.Mock;
    beforeEach(() => {
        playlists = {
            getAllPlaylists: jest.fn(() => of([playlist])),
            getPlaylistById: jest.fn(() =>
                of({
                    ...playlist,
                    playlist: {
                        items: [
                            channel,
                            { ...channel, id: 'r', radio: 'true' },
                        ],
                    },
                })
            ),
        };
        locks = {
            version: signal(0),
            withholdsEverything: jest.fn(() => false),
            isM3uGroupLocked: jest.fn(() => false),
            isXtreamCategoryLocked: jest.fn(() => false),
            isStalkerCategoryLocked: jest.fn(() => false),
        };
        xtream = {
            getAllCategories: jest
                .fn()
                .mockResolvedValue([{ id: 50, xtream_id: 900 }]),
            getPlaylist: jest.fn().mockResolvedValue({
                serverUrl: 'https://portal.example.test',
                username: 'example',
                password: 'example',
            }),
            getCategories: jest.fn().mockResolvedValue([
                { id: 50, xtream_id: 900, name: 'News', hidden: false },
                { id: 60, xtream_id: 901, name: 'Hidden', hidden: true },
            ]),
            getContent: jest.fn().mockResolvedValue([
                {
                    id: 123,
                    xtream_id: 7,
                    category_id: 50,
                    title: 'Synthetic News',
                },
                {
                    id: 124,
                    xtream_id: 8,
                    category_id: 60,
                    title: 'Synthetic hidden',
                },
            ]),
        };
        resolve = jest
            .fn()
            .mockResolvedValue({ streamUrl: channel.url, isLive: true });
        favorites = jest.fn().mockResolvedValue([]);
        TestBed.configureTestingModule({
            providers: [
                SecondStreamCatalogService,
                { provide: PlaylistsService, useValue: playlists },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: true },
                },
                { provide: ParentalLockService, useValue: locks },
                { provide: XTREAM_DATA_SOURCE, useValue: xtream },
                {
                    provide: StreamResolverService,
                    useValue: { resolvePlayback: resolve },
                },
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: { getFavorites: favorites },
                },
                {
                    provide: StalkerItvCacheService,
                    useValue: {
                        ensureLoaded: jest.fn().mockResolvedValue(undefined),
                        getChannels: jest.fn().mockReturnValue([
                            {
                                id: 'channel-1',
                                name: 'Synthetic News',
                                tv_genre_id: 'genre-2',
                                cmd: 'ffmpeg https://media.example.test/live',
                                use_http_tmp_link: '1',
                            },
                        ]),
                    },
                },
                {
                    provide: DataService,
                    useValue: {
                        sendIpcEvent: jest.fn().mockResolvedValue({
                            js: [{ id: 'genre-2', title: 'News' }],
                        }),
                    },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        ensureToken: jest
                            .fn()
                            .mockResolvedValue({ token: null }),
                    },
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: {
                        applyOverride: (p: unknown) => p,
                        shouldAttemptRepair: () => false,
                    },
                },
            ],
        });
        service = TestBed.inject(SecondStreamCatalogService);
    });
    it('browses M3U groups without changing any player or route', async () => {
        const data = await service.load(
            playlist._id,
            new AbortController().signal
        );
        expect(data.groups).toEqual([{ id: 'News', name: 'News' }]);
        expect(data.channels).toHaveLength(1);
        expect(resolve).not.toHaveBeenCalled();
        await service.resolve(data.channels[0]);
        expect(resolve).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'c', m3uChannel: channel })
        );
    });
    it('keeps Xtream database category ids separate from provider stream and category ids', async () => {
        playlists.getPlaylistById.mockReturnValue(
            of({ ...playlist, serverUrl: 'https://portal.example.test' })
        );
        const data = await service.load(
            playlist._id,
            new AbortController().signal
        );
        expect(data.channels).toHaveLength(1);
        expect(data.channels[0]).toMatchObject({
            group: '50',
            item: {
                xtreamId: 7,
                categoryId: 900,
                uid: 'xtream::synthetic-source::live:7',
            },
        });
        expect(data.groups).toHaveLength(1);
    });
    it('withholds locked groups and rechecks before handing a row to playback', async () => {
        const data = await service.load(
            playlist._id,
            new AbortController().signal
        );
        locks.isM3uGroupLocked.mockReturnValue(true);
        await expect(service.resolve(data.channels[0])).rejects.toThrow(
            'Channel unavailable'
        );
        expect(resolve).not.toHaveBeenCalled();
        expect(
            (await service.load(playlist._id, new AbortController().signal))
                .channels
        ).toEqual([]);
    });
    it('rejects a stream if its group locks while resolving playback', async () => {
        const data = await service.load(
            playlist._id,
            new AbortController().signal
        );
        resolve.mockImplementationOnce(async () => {
            locks.isM3uGroupLocked.mockReturnValue(true);
            locks.version.update((version) => version + 1);
            return { streamUrl: channel.url };
        });

        await expect(service.resolve(data.channels[0])).rejects.toThrow(
            'Channel unavailable'
        );
    });
    it('keeps only available television favorites', async () => {
        const base = {
            uid: 'one',
            name: 'Synthetic',
            playlistId: playlist._id,
            sourceType: 'm3u',
            contentType: 'live',
            m3uChannel: channel,
        };
        favorites.mockResolvedValue([
            base,
            { ...base, uid: 'movie', contentType: 'movie' },
            { ...base, uid: 'radio', radio: 'true' },
            { ...base, uid: 'missing', catalogStatus: 'missing' },
        ]);
        const data = await service.load('', new AbortController().signal);
        expect(data.channels.map((c) => c.item.uid)).toEqual(['one']);
    });
    it('omits hidden M3U groups', async () => {
        playlists.getPlaylistById.mockReturnValue(
            of({
                ...playlist,
                hiddenGroupTitles: ['News'],
                playlist: { items: [channel] },
            })
        );
        expect(
            (await service.load(playlist._id, new AbortController().signal))
                .channels
        ).toEqual([]);
    });
    it('normalizes stored favorite category ids before checking provider locks', async () => {
        favorites.mockResolvedValue([
            {
                uid: 'xtream::synthetic-source::live:7',
                name: 'Synthetic',
                sourceType: 'xtream',
                contentType: 'live',
                playlistId: playlist._id,
                categoryId: 50,
                xtreamId: 7,
            },
        ]);
        locks.isXtreamCategoryLocked.mockImplementation(
            (_playlist, _type, category) => category === 50
        );
        const data = await service.load('', new AbortController().signal);
        expect(data.channels).toHaveLength(1);
        expect(data.channels[0].item.categoryId).toBe(900);
        await service.resolve(data.channels[0]);
        expect(resolve).toHaveBeenCalled();
    });

    it('reuses the Stalker ITV cache and carries link flags to the existing resolver', async () => {
        playlists.getPlaylistById.mockReturnValue(
            of({
                ...playlist,
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'https://portal.example.test/portal.php',
                isFullStalkerPortal: false,
            })
        );
        const data = await service.load(
            playlist._id,
            new AbortController().signal
        );
        expect(data.groups).toEqual([{ id: 'genre-2', name: 'News' }]);
        expect(data.channels[0].item).toMatchObject({
            stalkerId: 'channel-1',
            categoryId: 'genre-2',
            stalkerItem: { use_http_tmp_link: '1' },
        });
        await service.resolve(data.channels[0]);
        expect(resolve).toHaveBeenCalledWith(data.channels[0].item);
    });
});
