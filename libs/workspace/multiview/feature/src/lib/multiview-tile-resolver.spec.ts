import { TestBed } from '@angular/core/testing';
import {
    MultiviewCatalogService,
    StreamResolverService,
    VodSourceResolverService,
} from '@iptvnator/portal/shared/data-access';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { PlaylistsService } from '@iptvnator/services';
import { of } from 'rxjs';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { liveItem, movieItem } from './multiview-picker.fixtures';
import { toPickerRow } from './multiview-picker-row';
import {
    MultiviewTileResolverService,
    MultiviewUnresolvableError,
} from './multiview-tile-resolver';
import { MultiviewXtreamLock } from './multiview-xtream-lock';

describe('MultiviewTileResolverService', () => {
    const catalog = { resolve: jest.fn() };
    const streams = { resolvePlayback: jest.fn() };
    const isLocked = jest.fn();
    const vod = { resolve: jest.fn() };
    const positions = {
        savePlaybackPosition: jest.fn(),
        getPlaybackPosition: jest.fn(),
    };
    let playlist: Record<string, unknown> | undefined;

    beforeEach(() => {
        jest.resetAllMocks();
        isLocked.mockResolvedValue(false);
        playlist = undefined;
        TestBed.configureTestingModule({
            providers: [
                { provide: MultiviewCatalogService, useValue: catalog },
                { provide: StreamResolverService, useValue: streams },
                { provide: MultiviewXtreamLock, useValue: { isLocked } },
                { provide: VodSourceResolverService, useValue: vod },
                { provide: PORTAL_PLAYBACK_POSITIONS, useValue: positions },
                {
                    provide: PlaylistsService,
                    useValue: { getPlaylistById: () => of(playlist) },
                },
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
        streams.resolvePlayback.mockResolvedValue(playback);
        const row = toPickerRow(liveItem(7), []);

        await expect(service().resolve(row)).resolves.toEqual({
            playback,
            playbackSessionKey: row.sessionKey,
            kind: 'live',
            playlistId: 'playlist-1',
            contentId: '7',
            title: 'Synthetic Channel 7',
            reopen: expect.any(Function),
        });
        expect(streams.resolvePlayback).toHaveBeenCalledWith(row.item);
        expect(isLocked).toHaveBeenCalledTimes(2);
    });

    it("gives an Xtream channel its source's headers (D4)", async () => {
        playlist = {
            _id: 'playlist-1',
            userAgent: ' Synthetic-Agent ',
            referrer: 'https://ref.example/',
            origin: 'https://origin.example',
        };
        streams.resolvePlayback.mockResolvedValue({
            streamUrl: 'http://xtream.example/live/u/p/7.ts',
            title: 'Synthetic Channel 7',
            isLive: true,
        });

        const source = await service().resolve(toPickerRow(liveItem(7), []));

        expect(source.playback).toMatchObject({
            userAgent: 'Synthetic-Agent',
            referer: 'https://ref.example/',
            origin: 'https://origin.example',
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

    it('resumes a film picked outside Continue at its saved position', async () => {
        positions.getPlaybackPosition.mockResolvedValue({
            contentXtreamId: 4,
            contentType: 'vod',
            positionSeconds: 300,
        });
        vod.resolve.mockResolvedValue({
            playback: {
                streamUrl: 'http://xtream.example/movie/u/p/4.mkv',
                title: 'f',
            },
            candidate: {},
        });

        const source = await service().resolve(toPickerRow(movieItem(4), []));

        expect(positions.getPlaybackPosition).toHaveBeenCalledWith(
            'playlist-1',
            4,
            'vod'
        );
        expect(vod.resolve).toHaveBeenCalledWith(expect.anything(), {
            startTime: 300,
        });
        expect(source.position).toBe(300);
    });

    it('starts a watched film from the beginning', async () => {
        positions.getPlaybackPosition.mockResolvedValue({
            contentXtreamId: 4,
            contentType: 'vod',
            positionSeconds: 5000,
            watched: true,
        });
        vod.resolve.mockResolvedValue({
            playback: {
                streamUrl: 'http://xtream.example/movie/u/p/4.mkv',
                title: 'f',
            },
            candidate: {},
        });

        await service().resolve(toPickerRow(movieItem(4), []));

        expect(vod.resolve).toHaveBeenCalledWith(expect.anything(), {
            startTime: undefined,
        });
    });

    it('resolves M3U and Stalker channels through the catalog', async () => {
        catalog.resolve.mockResolvedValue({
            streamUrl: 'https://stream.example/s.m3u8',
            title: 's',
        });
        const row = toPickerRow(liveItem(7, { sourceType: 'stalker' }), []);

        await service().resolve(row);

        expect(catalog.resolve).toHaveBeenCalledWith({
            item: row.item,
            group: '',
        });
        expect(streams.resolvePlayback).not.toHaveBeenCalled();
    });

    it.each([
        ['a locked Xtream channel', () => toPickerRow(liveItem(7), [])],
        ['a locked Xtream film', () => toPickerRow(movieItem(4), [])],
    ])('refuses %s (R11)', async (_label, row) => {
        isLocked.mockResolvedValue(true);

        await expect(service().resolve(row())).rejects.toBeInstanceOf(
            MultiviewUnresolvableError
        );
        expect(streams.resolvePlayback).not.toHaveBeenCalled();
        expect(vod.resolve).not.toHaveBeenCalled();
    });

    it('refuses a film whose source cannot be resolved', async () => {
        vod.resolve.mockResolvedValue(null);

        await expect(
            service().resolve(toPickerRow(movieItem(4), []))
        ).rejects.toBeInstanceOf(MultiviewUnresolvableError);
    });
});
