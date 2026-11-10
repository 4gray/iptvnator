import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    FavoritesService,
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
    xtream_id: 101,
    category_id: 7,
    title: 'Synthetic Channel A',
    epg_channel_id: 'sample.a',
};
const two = { xtream_id: 102, category_id: 8, title: 'Synthetic Channel B' };
const hidden = { xtream_id: 103, category_id: 9, title: 'Synthetic Hidden' };
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
    const load = jest.fn<Promise<EpgItem[]>, unknown[]>();
    const locked = jest.fn(
        (_playlist: string, _type: string, id: number) => id === 80
    );
    let service: XtreamEpgGuideSourceService;

    beforeEach(() => {
        currentPlaylist.set(playlist);
        selectedType.set('live');
        sourceRevision.set(0);
        lockRevision.set(0);
        load.mockReset().mockResolvedValue([program(101)]);
        locked
            .mockReset()
            .mockImplementation((_playlist, _type, id) => id === 80);
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
                        liveStreams: signal([one, two, hidden]),
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
                    useValue: { supportsXtreamSqliteDataSource: true },
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
                    provide: FavoritesService,
                    useValue: {
                        getFavorites: () =>
                            of([
                                { xtream_id: 101, type: 'movie' },
                                { xtream_id: 102, type: 'live' },
                            ]),
                    },
                },
            ],
        });
        service = TestBed.inject(XtreamEpgGuideSourceService);
        service.open();
    });
    afterEach(() => service.close());

    it('uses provider stream identity, excludes hidden and locked categories and does no eager schedule work', () => {
        expect(service.channels().map((channel) => channel.id)).toEqual([
            '101',
        ]);
        expect(service.channels()[0].epgKey).toBe('101');
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
        await Promise.resolve();
        service.setScope('favorites');
        expect(service.channels()).toEqual([]);
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
        expect(load).toHaveBeenCalledWith(playlist, 101, 'sample.a');
        const coverage = await service.loadCoverage({
            channels: service.channels(),
            fromMs: 100000,
            toMs: 200000,
        });
        expect([...coverage]).toEqual(['101']);
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
                channelId: null,
                channelName: two.title,
            }),
        ]);
        expect(load.mock.calls.map((call) => call[1])).toEqual([101, 102]);
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
