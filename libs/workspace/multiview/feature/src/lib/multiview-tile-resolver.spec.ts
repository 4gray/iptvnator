import { TestBed } from '@angular/core/testing';
import {
    MultiviewCatalogService,
    VodSourceResolverService,
} from '@iptvnator/portal/shared/data-access';
import { PlaybackPositionService } from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { liveItem, movieItem } from './multiview-picker.fixtures';
import { toPickerRow } from './multiview-picker-row';
import {
    MultiviewTileResolverService,
    MultiviewUnresolvableError,
} from './multiview-tile-resolver';

describe('MultiviewTileResolverService', () => {
    const catalog = { resolve: jest.fn() };
    const vod = { resolve: jest.fn() };
    const positions = { savePlaybackPosition: jest.fn() };

    beforeEach(() => {
        jest.resetAllMocks();
        TestBed.configureTestingModule({
            providers: [
                { provide: MultiviewCatalogService, useValue: catalog },
                { provide: VodSourceResolverService, useValue: vod },
                { provide: PlaybackPositionService, useValue: positions },
            ],
        });
    });

    const service = () => TestBed.inject(MultiviewTileResolverService);

    it('resolves a live channel through the catalog', async () => {
        const playback = {
            streamUrl: 'http://xtream.example/live/u/p/7.m3u8',
            title: 'Synthetic Channel 7',
            isLive: true,
        };
        catalog.resolve.mockResolvedValue(playback);
        const row = toPickerRow(liveItem(7), []);

        await expect(service().resolve(row)).resolves.toEqual({
            playback,
            playbackSessionKey: row.sessionKey,
            kind: 'live',
            playlistId: 'playlist-1',
            contentId: '7',
            title: 'Synthetic Channel 7',
        });
        expect(catalog.resolve).toHaveBeenCalledWith({
            item: row.item,
            group: '',
        });
    });

    it('resumes an Xtream film and saves its progress like its player (R9)', async () => {
        const playback = {
            streamUrl: 'http://xtream.example/movie/u/p/4.mkv',
            title: 'Synthetic Film 4',
            isLive: false,
            startTime: 754,
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 4,
                contentType: 'vod',
            },
        };
        vod.resolve.mockResolvedValue({ playback, candidate: {} });
        const row = toPickerRow(movieItem(4), [], {
            position: { positionSeconds: 754 } as PlaybackPositionData,
        });

        const source = await service().resolve(row);

        expect(vod.resolve).toHaveBeenCalledWith(
            expect.objectContaining({
                playlistId: 'playlist-1',
                portalType: 'xtream',
                contentId: 4,
            }),
            { startTime: 754 }
        );
        expect(source).toMatchObject({
            kind: 'vod',
            position: 754,
            contentId: '4',
        });

        source.persistPosition?.({ currentTime: 760, duration: 5000 });
        expect(positions.savePlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            expect.objectContaining({
                contentXtreamId: 4,
                positionSeconds: 760,
            })
        );
    });

    it.each([
        ['a series', toPickerRow(movieItem(5, { contentType: 'series' }), [])],
        ['radio', toPickerRow(liveItem(6, { radio: 'true' }), [])],
        [
            'a Stalker film',
            toPickerRow(
                movieItem(8, { sourceType: 'stalker', xtreamId: undefined }),
                []
            ),
        ],
    ])('refuses %s', async (_label, row) => {
        await expect(service().resolve(row)).rejects.toBeInstanceOf(
            MultiviewUnresolvableError
        );
    });

    it('refuses a film whose source cannot be resolved', async () => {
        vod.resolve.mockResolvedValue(null);

        await expect(
            service().resolve(toPickerRow(movieItem(4), []))
        ).rejects.toBeInstanceOf(MultiviewUnresolvableError);
    });
});
