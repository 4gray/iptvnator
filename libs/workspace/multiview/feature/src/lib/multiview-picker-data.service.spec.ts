import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    MultiviewCatalogService,
    StreamResolverService,
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { collectionEpgKey } from '@iptvnator/portal/shared/util';
import {
    ParentalLockService,
    PlaybackPositionService,
} from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { MultiviewOnScreenSources } from './multiview-on-screen';
import { liveItem, movieItem, tile } from './multiview-picker.fixtures';
import {
    isResumable,
    MultiviewPickerDataService,
} from './multiview-picker-data.service';
import {
    MULTIVIEW_PICKER_EPG_CAP,
    MultiviewEpgAllowance,
} from './multiview-picker-epg';

const position = (
    positionSeconds: number,
    extra: Partial<PlaybackPositionData> = {}
) =>
    ({
        contentXtreamId: 1,
        contentType: 'vod',
        positionSeconds,
        durationSeconds: 1000,
        ...extra,
    }) as PlaybackPositionData;

describe('isResumable', () => {
    it.each([
        [null, false],
        [position(0), false],
        [position(400), true],
        [position(960), false],
        [position(400, { watched: true }), false],
        [position(400, { durationSeconds: undefined }), true],
    ])('%j → %s', (value, expected) => {
        expect(isResumable(value)).toBe(expected);
    });
});

describe('MultiviewEpgAllowance', () => {
    it('requests visible live rows once, at most 20 per open (Q1)', () => {
        const allowance = new MultiviewEpgAllowance();
        const channels = Array.from({ length: 30 }, (_, i) => liveItem(i + 1));

        expect(allowance.take(channels.slice(0, 12))).toHaveLength(12);
        expect(allowance.take(channels.slice(0, 12))).toEqual([]);
        expect(allowance.take([movieItem(99), ...channels])).toHaveLength(
            MULTIVIEW_PICKER_EPG_CAP - 12
        );
        expect(allowance.left).toBe(0);
        expect(allowance.take(channels)).toEqual([]);
    });
});

describe('MultiviewPickerDataService', () => {
    const favorites = { getFavorites: jest.fn() };
    const recent = { getRecentItems: jest.fn() };
    const catalog = {
        load: jest.fn(),
        isAllowed: jest.fn(),
        loadGroup: jest.fn(),
    };
    const resolver = { loadEpgForItems: jest.fn() };
    const positions = { getPlaybackPosition: jest.fn() };
    const withholdsEverything = signal(false);

    beforeEach(() => {
        jest.resetAllMocks();
        withholdsEverything.set(false);
        favorites.getFavorites.mockResolvedValue([liveItem(1), movieItem(5)]);
        recent.getRecentItems.mockResolvedValue([
            movieItem(6),
            movieItem(7),
            liveItem(2),
        ]);
        catalog.load.mockResolvedValue({
            groups: [{ id: '10', name: 'News' }],
            channels: [{ item: liveItem(3), group: '10' }],
        });
        catalog.loadGroup.mockResolvedValue([
            { item: liveItem(4), group: '20' },
            { item: liveItem(5, { radio: 'true' }), group: '20' },
        ]);
        catalog.isAllowed.mockReturnValue(true);
        positions.getPlaybackPosition.mockImplementation(
            async (_playlist: string, id: number) =>
                id === 6 ? position(300) : position(990)
        );
        TestBed.configureTestingModule({
            providers: [
                { provide: UnifiedFavoritesDataService, useValue: favorites },
                { provide: UnifiedRecentDataService, useValue: recent },
                { provide: MultiviewCatalogService, useValue: catalog },
                { provide: StreamResolverService, useValue: resolver },
                { provide: PlaybackPositionService, useValue: positions },
                {
                    provide: ParentalLockService,
                    useValue: { withholdsEverything },
                },
                {
                    provide: MultiviewOnScreenSources,
                    useValue: {
                        current: () => [tile({ id: 'a', contentId: '1' })],
                    },
                },
            ],
        });
    });

    const service = () => TestBed.inject(MultiviewPickerDataService);
    const signalOf = () => new AbortController().signal;

    it('composes every section from the existing sources', async () => {
        const data = await service().load('playlist-1', signalOf());
        const section = (id: string) => data.sections.find((s) => s.id === id);

        expect(favorites.getFavorites).toHaveBeenCalledWith('all');
        expect(recent.getRecentItems).toHaveBeenCalledWith('all');
        expect(catalog.load).toHaveBeenCalledWith(
            'playlist-1',
            expect.anything()
        );
        expect(section('live-now')?.count).toBe(3);
        expect(
            section('continue')?.groups[0].rows.map((r) => r.item.xtreamId)
        ).toEqual([6]);
        expect(section('playlist')?.count).toBe(1);
        expect(section('live-now')?.groups[0].rows[0].inTile).toBe(1);
        expect(data.playlistGroups).toEqual([{ id: '10', name: 'News' }]);
        expect([...data.playlistRowGroups.values()]).toEqual(['10']);
        expect(data.playlistPaged).toBe(false);
    });

    it('marks a portal that lists channels per group only as paged', async () => {
        catalog.load.mockResolvedValue({
            groups: [{ id: '20', name: 'Sport' }],
            channels: [],
        });

        const data = await service().load('playlist-1', signalOf());

        expect(data.playlistPaged).toBe(true);
    });

    it('loads one group of a paged portal as rows, without radio', async () => {
        const rows = await service().loadPlaylistGroup(
            'playlist-1',
            '20',
            signalOf()
        );

        expect(catalog.loadGroup).toHaveBeenCalledWith(
            'playlist-1',
            '20',
            expect.anything()
        );
        expect(rows.map((row) => row.item.xtreamId)).toEqual([4]);
    });

    it('lists no playlist without a current one', async () => {
        const data = await service().load(null, signalOf());

        expect(catalog.load).not.toHaveBeenCalled();
        expect(data.sections.find((s) => s.id === 'playlist')?.count).toBe(0);
    });

    it('shows the other sources when one fails', async () => {
        favorites.getFavorites.mockRejectedValue(new Error('db'));
        catalog.load.mockRejectedValue(new Error('offline'));

        const data = await service().load('playlist-1', signalOf());

        expect(data.sections.find((s) => s.id === 'recent')?.count).toBe(3);
    });

    it('checks M3U and Stalker channels like their lists and withholds the rest while locks load', () => {
        catalog.isAllowed.mockReturnValue(false);
        expect(
            service().isAllowed(liveItem(1, { sourceType: 'stalker' }))
        ).toBe(false);
        // Xtream rows are checked by stream id when resolved.
        expect(service().isAllowed(liveItem(1))).toBe(true);
        expect(service().isAllowed(movieItem(2))).toBe(true);

        withholdsEverything.set(true);
        expect(service().isAllowed(movieItem(2))).toBe(false);
    });

    it('loads EPG for visible rows within the allowance', async () => {
        const program = { title: 'Synthetic News' };
        resolver.loadEpgForItems.mockResolvedValue(
            new Map([[collectionEpgKey(liveItem(1)), program]])
        );
        const allowance = new MultiviewEpgAllowance(1);

        const programs = await service().loadEpg(
            [liveItem(1), liveItem(2)],
            allowance
        );

        expect(resolver.loadEpgForItems).toHaveBeenCalledWith([liveItem(1)]);
        expect(service().programFor(liveItem(1), programs)).toBe(program);
        await service().loadEpg([liveItem(2)], allowance);
        expect(resolver.loadEpgForItems).toHaveBeenCalledTimes(1);
    });
});
