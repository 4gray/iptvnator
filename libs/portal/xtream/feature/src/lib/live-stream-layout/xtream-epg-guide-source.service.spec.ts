import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    FavoritesService,
    XtreamApiService,
    type TypedXtreamCollectionRef,
    FavoriteItem,
    XtreamFullEpgService,
    XtreamPlaylistData,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    EpgSourceSettingsService,
    ParentalLockService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { EpgItem } from '@iptvnator/shared/interfaces';
import { XtreamEpgGuideSourceService } from './xtream-epg-guide-source.service';
import {
    XtreamLiveChannelItem,
    XtreamLiveChannelNavigationService,
} from './xtream-live-channel-navigation.service';

const playlist: XtreamPlaylistData = {
    id: 'synthetic-portal',
    name: 'Synthetic Portal',
    type: 'xtream',
    serverUrl: 'https://provider.example',
    username: 'sample',
    password: 'sample',
};
const one = {
    id: 11,
    xtream_id: 101,
    category_id: 7,
    title: 'Synthetic Channel A',
    epg_channel_id: 'sample.a',
};
const two = {
    id: 12,
    xtream_id: 102,
    category_id: 8,
    title: 'Synthetic Channel B',
};
const hidden = {
    id: 13,
    xtream_id: 103,
    category_id: 9,
    title: 'Synthetic Hidden',
};
const categories = [
    {
        id: 7,
        category_id: '7',
        xtream_id: 70,
        category_name: 'Synthetic Group A',
        hidden: false,
    },
    {
        id: 8,
        category_id: '8',
        xtream_id: 80,
        category_name: 'Synthetic Group B',
        hidden: false,
    },
    {
        id: 9,
        category_id: '9',
        xtream_id: 90,
        category_name: 'Synthetic Hidden Group',
        hidden: true,
    },
];
function program(id: number, start = 100, stop = 200): EpgItem {
    return {
        id: `sample-${id}`,
        channel_id: `sample-${id}`,
        epg_id: '',
        lang: '',
        title: 'Synthetic Programme',
        description: 'Synthetic description',
        start: new Date(start * 1000).toISOString(),
        end: new Date(stop * 1000).toISOString(),
        stop: new Date(stop * 1000).toISOString(),
        start_timestamp: String(start),
        stop_timestamp: String(stop),
    };
}

describe('XtreamEpgGuideSourceService', () => {
    const currentPlaylist = signal(playlist);
    const selectedType = signal('live');
    const lockRevision = signal(0);
    const sourceRevision = signal(0);
    const liveStreams = signal<XtreamLiveChannelItem[]>([]);
    const runtime = { supportsXtreamSqliteDataSource: true };
    let favorites: Pick<
        FavoriteItem,
        'content_id' | 'xtream_id' | 'type' | 'catalog_status' | 'category_id'
    >[];
    const load = jest.fn<Promise<EpgItem[]>, unknown[]>();
    const isFavorite = jest.fn<
        Promise<boolean>,
        [TypedXtreamCollectionRef, string]
    >();
    const locked = jest.fn<boolean, [string, string, number]>();
    let service: XtreamEpgGuideSourceService;

    async function settleFavorites(): Promise<void> {
        TestBed.flushEffects();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    beforeEach(() => {
        currentPlaylist.set(playlist);
        selectedType.set('live');
        sourceRevision.set(0);
        lockRevision.set(0);
        runtime.supportsXtreamSqliteDataSource = true;
        liveStreams.set([one, two, hidden]);
        favorites = [
            {
                content_id: one.id,
                xtream_id: one.xtream_id,
                category_id: one.category_id,
                type: 'movie',
            },
            {
                content_id: two.id,
                xtream_id: two.xtream_id,
                category_id: two.category_id,
                type: 'live',
            },
        ];
        load.mockReset().mockResolvedValue([program(101)]);
        isFavorite.mockReset().mockResolvedValue(false);
        locked.mockReset().mockImplementation((...args) => args[2] === 80);
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                XtreamEpgGuideSourceService,
                {
                    provide: XtreamStore,
                    useValue: {
                        currentPlaylist,
                        selectedContentType: selectedType,
                        selectedCategoryId: signal<number | null>(null),
                        getCategoriesBySelectedType: signal(categories),
                        liveStreams,
                    },
                },
                {
                    provide: XtreamLiveChannelNavigationService,
                    useValue: {
                        sortMode: signal('server'),
                        activeItem: signal<XtreamLiveChannelItem | null>(one),
                    },
                },
                {
                    provide: EpgSourceSettingsService,
                    useValue: { revision: sourceRevision },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
                {
                    provide: SettingsStore,
                    useValue: { preferUploadedEpgOverXtream: signal(false) },
                },
                {
                    provide: ParentalLockService,
                    useValue: {
                        version: lockRevision,
                        isXtreamCategoryLocked: locked,
                    },
                },
                { provide: XtreamFullEpgService, useValue: { load } },
                {
                    provide: XtreamApiService,
                    useValue: { cancelSession: jest.fn() },
                },
                {
                    provide: FavoritesService,
                    useValue: {
                        getFavorites: () => of(favorites),
                        isFavorite,
                    },
                },
            ],
        });
        service = TestBed.inject(XtreamEpgGuideSourceService);
        service.open();
    });
    afterEach(() => service.close());

    it('does not read or sort the live catalogue for the dock while the guide is closed', () => {
        service.close();
        const sortMode = jest.spyOn(
            TestBed.inject(XtreamLiveChannelNavigationService),
            'sortMode'
        );
        service.setPlayback(one, true);
        expect(service.playingScheduleItems()).toBeNull();
        expect(sortMode).not.toHaveBeenCalled();
    });

    it('refreshes the dock schedule for a playing stream outside the guide scope', async () => {
        jest.useFakeTimers();
        try {
            locked.mockReturnValue(false);
            lockRevision.update((value) => value + 1);
            service.setScope('8');
            service.setPlayback(one, true);
            const first = {
                ...program(101),
                title: 'Synthetic Initial Programme',
            };
            const next = {
                ...program(101),
                title: 'Synthetic Updated Programme',
            };
            load.mockResolvedValueOnce([first]).mockResolvedValueOnce([next]);
            TestBed.flushEffects();
            await jest.advanceTimersByTimeAsync(0);
            expect(service.channels().map(({ id }) => id)).toEqual(['102']);
            expect(service.playingSchedule()?.[0].title).toBe(first.title);
            await jest.advanceTimersByTimeAsync(300_000);
            expect(service.playingSchedule()?.[0].title).toBe(next.title);
            expect(load.mock.calls.map(([, streamId]) => streamId)).toEqual([
                101, 101,
            ]);

            service.close();
            TestBed.flushEffects();
            await jest.advanceTimersByTimeAsync(300_000);
            expect(load).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('shares an in-flight and cached grid schedule with the player', async () => {
        let finish!: (items: EpgItem[]) => void;
        load.mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve))
        );
        const rows = service.loadPrograms({
            channels: service.channels(),
            fromMs: 100000,
            toMs: 200000,
        });
        const playing = service.playbackSchedule(one);
        const raw = [program(101)];
        expect(load).toHaveBeenCalledTimes(1);
        finish(raw);
        await rows;
        await expect(playing).resolves.toBe(raw);
        const cached = service.playbackSchedule(one);
        service.close();
        await expect(cached).resolves.toBe(raw);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('refreshes the playing copy when a catalogue recheck changes its EPG ID', async () => {
        service.setPlayback(one, true);
        const initial = [program(1)];
        const refreshed = [program(2)];
        load.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
        TestBed.flushEffects();
        await service.playbackSchedule(one);
        expect(service.playingScheduleItems()).toBe(initial);

        const updated = { ...one, epg_channel_id: 'synthetic.updated' };
        liveStreams.set([updated, two]);
        TestBed.flushEffects();
        await service.playbackSchedule(updated);
        expect(service.playingScheduleItems()).toBe(refreshed);
    });

    it('does not replace the playing copy schedule when another category uses a different EPG key', async () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        const copy = {
            ...one,
            id: 21,
            category_id: 8,
            epg_channel_id: 'synthetic.copy',
        };
        liveStreams.set([one, copy]);
        load.mockImplementation(async (_playlist, _id, key) => [
            {
                ...program(101),
                title:
                    key === copy.epg_channel_id
                        ? 'Synthetic Copy Programme'
                        : 'Synthetic Original Programme',
            },
        ]);
        service.setPlayback(copy, true);
        TestBed.flushEffects();
        for (const scope of ['8', '7']) {
            service.setScope(scope);
            const rows = await service.loadPrograms({
                channels: service.channels(),
                fromMs: 100000,
                toMs: 200000,
            });
            if (scope === '7')
                expect(rows.get('101')?.[0].title).toBe(
                    'Synthetic Original Programme'
                );
            expect(service.playingSchedule()?.[0].title).toBe(
                'Synthetic Copy Programme'
            );
        }
    });

    it('uses provider stream identity, excludes hidden and locked categories and does no eager schedule work', () => {
        expect(service.channels().map((channel) => channel.id)).toEqual([
            '101',
        ]);
        expect(service.channels()[0].epgKey).toBe('7:101:sample.a');
        expect(locked).toHaveBeenCalledWith(playlist.id, 'live', 80);
        expect(service.scopes().map((scope) => scope.id)).toEqual([
            'all',
            'favorites',
            '7',
        ]);
        expect(service.deferredCoverage).toBe(true);
        expect(load).not.toHaveBeenCalled();
    });

    it('keeps movie favorites with a colliding stream ID out of the live favorites scope', async () => {
        await settleFavorites();
        service.setScope('favorites');
        expect(service.channels()).toEqual([]);
    });

    it('keeps duplicate stream copies in their respective categories and plays the scoped copy', () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        const copy = {
            ...one,
            id: 21,
            category_id: '008',
            title: 'Synthetic Channel A Copy',
        };
        liveStreams.set([one, two, copy]);
        const play = jest.fn();
        service.bind(play);
        expect(
            service.channels().filter((channel) => channel.id === '101')
        ).toHaveLength(1);
        service.setScope('7');
        expect(service.channels()).toEqual([
            expect.objectContaining({ name: one.title }),
        ]);
        const originalKey = service.channels()[0].epgKey;
        service.setScope('8');
        expect(service.channels().map((channel) => channel.name)).toContain(
            copy.title
        );
        service.activate('101');
        expect(play).toHaveBeenCalledWith(
            copy,
            expect.arrayContaining([copy, two])
        );
        play.mockClear();
        service.activate('101', originalKey);
        expect(play).toHaveBeenCalledWith(one, [one]);
        play.mockClear();
        locked.mockImplementation(
            (_playlist, _type, category) => category === 70
        );
        lockRevision.update((value) => value + 1);
        service.activate('101', originalKey);
        expect(play).not.toHaveBeenCalled();
    });

    it('keeps uncategorized and unknown-category PWA streams in All Channels without including locked streams', async () => {
        runtime.supportsXtreamSqliteDataSource = false;
        locked.mockImplementation((...args) => args[2] === 8);
        lockRevision.update((value) => value + 1);
        const uncategorized = {
            id: 104,
            xtream_id: 104,
            title: 'Synthetic Unassigned',
        };
        const unknown = {
            id: 105,
            xtream_id: 105,
            category_id: '99',
            title: 'Synthetic Unknown Group',
        };
        liveStreams.set([
            { ...one, category_id: '007' },
            { ...two, category_id: '008' },
            uncategorized,
            unknown,
        ]);
        expect(service.channels().map((channel) => channel.id)).toEqual([
            '101',
            '104',
            '105',
        ]);
        service.setScope('7');
        expect(service.channels().map((channel) => channel.id)).toEqual([
            '101',
        ]);
        load.mockImplementation(async (_playlist, id) =>
            id === 104 ? [program(104)] : []
        );
        expect(await service.searchPrograms('programme')).toEqual([
            expect.objectContaining({
                channelName: uncategorized.title,
                channelId: '104',
            }),
        ]);
    });

    it('excludes unresolved favorites and chooses the resolved catalog row among duplicate streams', async () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        const copy = {
            ...two,
            id: 22,
            category_id: 7,
            title: 'Synthetic Channel B Copy',
        };
        liveStreams.set([one, copy, { ...two, id: String(two.id) }]);
        favorites = [
            {
                content_id: one.id,
                xtream_id: one.xtream_id,
                category_id: one.category_id,
                type: 'live',
                catalog_status: 'missing',
            },
            {
                content_id: two.id,
                xtream_id: two.xtream_id,
                category_id: two.category_id,
                type: 'live',
                catalog_status: 'present',
            },
        ];
        service.open();
        await settleFavorites();
        service.setScope('favorites');
        expect(service.channels()).toEqual([
            expect.objectContaining({ name: two.title }),
        ]);
    });

    it('uses the resolved PWA favorite category when provider stream IDs repeat', async () => {
        runtime.supportsXtreamSqliteDataSource = false;
        const favorite = {
            ...one,
            id: one.xtream_id,
            category_id: '008',
            title: 'Synthetic Channel A Copy',
            epg_channel_id: 'sample.copy',
        };
        liveStreams.set([{ ...one, id: one.xtream_id }, favorite]);
        favorites = [
            {
                content_id: one.xtream_id,
                xtream_id: one.xtream_id,
                category_id: 8,
                type: 'live',
            },
        ];
        service.open();
        await settleFavorites();
        service.setScope('favorites');
        expect(service.channels()).toEqual([
            expect.objectContaining({ name: favorite.title }),
        ]);
        await service.loadPrograms({
            channels: service.channels(),
            fromMs: 100000,
            toMs: 200000,
        });
        expect(load).toHaveBeenCalledWith(
            playlist,
            one.xtream_id,
            'sample.copy',
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });

    it('uses a compatible visible copy when the native favorite resolves to a hidden row', async () => {
        const compatible = {
            ...one,
            id: 15,
            title: 'Synthetic Compatible Copy',
            tmdb_id: 10,
            release_year: 2020,
        };
        liveStreams.set([
            one,
            compatible,
            { ...hidden, xtream_id: one.xtream_id },
        ]);
        favorites = [
            {
                content_id: hidden.id,
                xtream_id: one.xtream_id,
                category_id: hidden.category_id,
                type: 'live',
            },
        ];
        isFavorite.mockImplementation(
            async (ref) =>
                ref.identity?.tmdbId === compatible.tmdb_id &&
                ref.identity.releaseYear === compatible.release_year
        );
        service.open();
        service.setScope('favorites');
        await settleFavorites();
        expect(isFavorite.mock.calls).toEqual([
            [
                expect.objectContaining({
                    id: one.id,
                    type: 'live',
                    providerId: one.xtream_id,
                }),
                playlist.id,
            ],
            [
                expect.objectContaining({
                    id: compatible.id,
                    type: 'live',
                    providerId: compatible.xtream_id,
                    identity: {
                        tmdbId: compatible.tmdb_id,
                        releaseYear: compatible.release_year,
                    },
                }),
                playlist.id,
            ],
        ]);
        expect(service.channels()).toEqual([
            expect.objectContaining({ name: compatible.title }),
        ]);
    });

    it('re-resolves a favorite when the visible copy changes while the guide stays open', async () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        const copy = {
            ...one,
            id: 24,
            category_id: 8,
            title: 'Synthetic Favorite Copy',
        };
        liveStreams.set([one, copy]);
        favorites = [
            {
                content_id: one.id,
                xtream_id: one.xtream_id,
                category_id: one.category_id,
                type: 'live',
            },
        ];
        isFavorite.mockResolvedValue(true);
        service.setScope('favorites');
        await settleFavorites();
        expect(service.channels().map(({ name }) => name)).toEqual([one.title]);

        locked.mockImplementation((_id, _type, category) => category === 70);
        lockRevision.update((value) => value + 1);
        await settleFavorites();
        expect(service.scopeId()).toBe('favorites');
        expect(service.channels().map(({ name }) => name)).toEqual([
            copy.title,
        ]);
        expect(isFavorite).toHaveBeenCalledWith(
            expect.objectContaining({
                id: copy.id,
                type: 'live',
                providerId: copy.xtream_id,
            }),
            playlist.id
        );
    });

    it('refreshes favorite membership after the sync runtime announces a change', async () => {
        favorites = [];
        service.setScope('favorites');
        await settleFavorites();
        expect(service.channels()).toEqual([]);

        favorites = [
            {
                content_id: one.id,
                xtream_id: one.xtream_id,
                category_id: one.category_id,
                type: 'live',
            },
        ];
        window.dispatchEvent(new Event('iptvnator-favorites-changed'));
        await settleFavorites();
        expect(service.channels().map(({ id }) => id)).toEqual(['101']);
    });

    it('falls back to All Channels when the browsed category becomes locked', () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        service.setScope('8');
        expect(service.scopeId()).toBe('8');
        locked.mockImplementation((_id, _type, category) => category === 80);
        lockRevision.update((value) => value + 1);
        expect(service.scopeId()).toBe('all');
        expect(service.channels().map(({ id }) => id)).toEqual(['101']);
    });

    it('keeps successful search matches on both sides of a failed channel', async () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        const third = {
            id: 14,
            xtream_id: 104,
            category_id: 7,
            title: 'Synthetic Channel C',
        };
        liveStreams.set([one, two, third]);
        load.mockImplementation(async (_playlist, id) => {
            if (id === 102) throw new Error('synthetic provider failure');
            return [program(Number(id))];
        });
        const report = jest.fn();
        expect(
            (await service.searchPrograms('programme', undefined, report)).map(
                (hit) => hit.channelId
            )
        ).toEqual(['101', '104']);
        expect(report).toHaveBeenNthCalledWith(1, {
            checked: 1,
            total: 3,
            matches: [expect.objectContaining({ channelId: '101' })],
        });
    });

    it('loads full schedules with the shared source-priority resolver and clips by overlap', async () => {
        load.mockResolvedValue([
            program(101, 0, 100),
            program(101, 100, 200),
            program(101, 200, 300),
        ]);
        const result = await service.loadPrograms({
            channels: service.channels(),
            fromMs: 100000,
            toMs: 200000,
        });
        expect(result.get('101')).toHaveLength(1);
        expect(load).toHaveBeenCalledWith(
            playlist,
            101,
            'sample.a',
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        const report = jest.fn();
        const coverage = await service.loadCoverage(
            { channels: service.channels(), fromMs: 100000, toMs: 200000 },
            report
        );
        expect([...coverage]).toEqual(['101']);
        expect(report).toHaveBeenCalledWith('101', result.get('101'));
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('searches eligible channels outside the current scope and never queries hidden channels', async () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        service.setScope('7');
        load.mockImplementation(async (_playlist, id) =>
            id === 102 ? [program(102)] : []
        );
        const result = await service.searchPrograms('programme');
        expect(result).toEqual([
            expect.objectContaining({
                channelId: '102',
                channelName: two.title,
            }),
        ]);
        expect(load.mock.calls.map((call) => call[1])).toEqual([101, 102]);
    });

    it('searches distinct schedules and identifies the copy that produced the hit', async () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        const copy = {
            ...one,
            id: 21,
            category_id: 8,
            epg_channel_id: 'synthetic.copy',
        };
        liveStreams.set([one, copy]);
        service.setScope('all');
        expect(service.channels()).toHaveLength(1);
        load.mockImplementation(async (_playlist, _id, epgKey) =>
            epgKey === copy.epg_channel_id ? [program(copy.xtream_id)] : []
        );
        const [hit] = await service.searchPrograms('programme');
        expect(hit.channelId).toBe(service.channels()[0].id);
        expect(hit.channelEpgKey).not.toBe(service.channels()[0].epgKey);
        service.setScope('8');
        expect(hit.channelEpgKey).toBe(service.channels()[0].epgKey);
    });

    it('filters confirmed empty schedules and continues after a failed lookup', async () => {
        locked.mockReturnValue(false);
        lockRevision.update((value) => value + 1);
        const third = { ...one, id: 14, xtream_id: 104 };
        liveStreams.set([one, two, third]);
        load.mockImplementation(async (_playlist, id) => {
            if (id === 101) throw new Error('synthetic provider failure');
            return id === 104 ? [program(104)] : [];
        });
        const report = jest.fn();
        const coverage = await service.loadCoverage(
            { channels: service.channels(), fromMs: 100000, toMs: 200000 },
            report
        );
        expect([...coverage]).toEqual(['101', '104']);
        expect(report).toHaveBeenCalledWith('101', null);
        expect(report).toHaveBeenCalledWith('102', []);
    });

    it('discards replies and stops scans after changing the playlist or guide source', async () => {
        let finish!: (items: EpgItem[]) => void;
        load.mockImplementation(
            () => new Promise((resolve) => (finish = resolve))
        );
        const request = service.searchPrograms('programme');
        const rejected = expect(request).rejects.toMatchObject({
            name: 'AbortError',
        });
        currentPlaylist.set({ ...playlist, id: 'another-synthetic-portal' });
        finish([program(101)]);
        await rejected;
        expect(load).toHaveBeenCalledTimes(1);
        load.mockResolvedValue([program(101)]);
        service.open();
        await service.loadPrograms({
            channels: service.channels(),
            fromMs: 100000,
            toMs: 200000,
        });
        sourceRevision.update((value) => value + 1);
        const next = service.loadPrograms({
            channels: service.channels(),
            fromMs: 100000,
            toMs: 200000,
        });
        await next;
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('cancels a catalogue search when the user clears the query or closes the guide', async () => {
        let finish!: (items: EpgItem[]) => void;
        load.mockImplementation(
            () => new Promise((resolve) => (finish = resolve))
        );
        const controller = new AbortController();
        const request = service.searchPrograms('programme', controller.signal);
        const rejected = expect(request).rejects.toMatchObject({
            name: 'AbortError',
        });
        controller.abort();
        finish([program(101)]);
        await rejected;
        const play = jest.fn();
        service.bind(play);
        service.close();
        service.activate('101');
        expect(play).not.toHaveBeenCalled();
    });
});
