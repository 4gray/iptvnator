import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { ParentalLockService, SettingsStore } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import {
    M3uCatalogIndexService,
    selectChannelsPlaylistId,
} from './m3u-catalog-index.service';
import { selectChannelsLoading } from './selectors';

const channel = (url: string, name: string, group: string) =>
    ({ url, name, group: { title: group } }) as unknown as Channel;

const LIVE = channel(
    'http://h.example/live/u/p/1.ts',
    'KANAL ORNEK 1',
    'Ulusal'
);
const MOVIE = channel('http://h.example/movie/u/p/2.mkv', 'Sandline', 'Films');
const EPISODE = channel(
    'http://h.example/series/u/p/3.mp4',
    'Hollow S01E01',
    'Shows'
);

describe('M3uCatalogIndexService', () => {
    const channels = signal<Channel[]>([]);

    const loading = signal(false);
    const rowsPlaylistId = signal<string | null>('pl-a');

    beforeEach(() => {
        channels.set([]);
        loading.set(false);
        rowsPlaylistId.set('pl-a');
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: Store,
                    useValue: {
                        selectSignal: (selector: unknown) =>
                            selector === selectChannelsLoading
                                ? loading
                                : selector === selectChannelsPlaylistId
                                  ? rowsPlaylistId
                                  : channels,
                    },
                },
            ],
        });
    });

    it('splits the loaded channels by kind', () => {
        channels.set([LIVE, MOVIE, EPISODE]);
        const service = TestBed.inject(M3uCatalogIndexService);

        expect(service.index().counts).toEqual({
            live: 1,
            movie: 1,
            episode: 1,
            radio: 0,
        });
        expect(service.channelsOfKind('movie')()).toEqual([MOVIE]);
        expect(
            service
                .groupsOfKind('episode')()
                .map((g) => g.title)
        ).toEqual(['Shows']);
    });

    it('exposes no catalog rows while the next playlist is loading', () => {
        // A playlist switch leaves the previous playlist's rows in the store
        // until the new ones arrive, under the new playlist's id.
        channels.set([LIVE, MOVIE, EPISODE]);
        const service = TestBed.inject(M3uCatalogIndexService);

        loading.set(true);

        expect(service.index().counts).toEqual({
            live: 0,
            movie: 0,
            episode: 0,
            radio: 0,
        });
        expect(service.channelsOfKind('movie')()).toEqual([]);

        loading.set(false);

        expect(service.channelsOfKind('movie')()).toEqual([MOVIE]);
    });

    it('keeps the live list as it was while a load is in flight', () => {
        // The live sidebar is not a catalog surface: blanking it would be a
        // change of its own, outside this split.
        channels.set([LIVE, MOVIE, EPISODE]);
        const service = TestBed.inject(M3uCatalogIndexService);

        loading.set(true);

        expect(service.liveChannels()).toEqual([LIVE]);
    });

    it('reports a live-only playlist as having no other content', () => {
        channels.set([LIVE]);
        const service = TestBed.inject(M3uCatalogIndexService);

        expect(service.hasNonLiveContent()).toBe(false);
    });

    it('reuses the index while the channel array is unchanged', () => {
        channels.set([LIVE, MOVIE]);
        const service = TestBed.inject(M3uCatalogIndexService);

        // Identity, not equality: the whole point of the memo is that
        // consumers can compare references instead of re-deriving.
        expect(service.index()).toBe(service.index());
    });

    it('rebuilds when the store replaces the channel array', () => {
        channels.set([LIVE]);
        const service = TestBed.inject(M3uCatalogIndexService);
        const before = service.index();

        channels.set([LIVE, MOVIE]);

        expect(service.index()).not.toBe(before);
        expect(service.index().counts.movie).toBe(1);
    });

    describe('sectionsOf', () => {
        it('answers from the rows while they belong to that playlist', () => {
            channels.set([LIVE, MOVIE]);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.sectionsOf('pl-a')).toEqual({
                movies: true,
                series: false,
            });
        });

        it('does not know a playlist it has not seen', () => {
            channels.set([LIVE, MOVIE]);

            expect(
                TestBed.inject(M3uCatalogIndexService).sectionsOf('pl-b')
            ).toBeNull();
        });

        it('keeps the last answer while the same playlist reloads', () => {
            // The index is empty during a load; without the last answer the
            // rail links blink out on every reload.
            channels.set([LIVE, MOVIE, EPISODE]);
            const service = TestBed.inject(M3uCatalogIndexService);
            service.sectionsOf('pl-a');

            loading.set(true);

            expect(service.sectionsOf('pl-a')).toEqual({
                movies: true,
                series: true,
            });
        });

        it('never gives one playlist the answer of another', () => {
            // Off an M3U route the active playlist can change while the
            // rows stay those of the last playlist opened.
            channels.set([LIVE, MOVIE]);
            const service = TestBed.inject(M3uCatalogIndexService);
            service.sectionsOf('pl-a');

            expect(service.sectionsOf('pl-b')).toBeNull();

            rowsPlaylistId.set('pl-b');
            channels.set([LIVE, EPISODE]);

            expect(service.sectionsOf('pl-b')).toEqual({
                movies: false,
                series: true,
            });
            // ...and pl-a is still remembered once the rows have moved on.
            expect(service.sectionsOf('pl-a')).toEqual({
                movies: true,
                series: false,
            });
        });

        it('follows a refresh that empties a section', () => {
            channels.set([LIVE, MOVIE]);
            const service = TestBed.inject(M3uCatalogIndexService);
            expect(service.sectionsOf('pl-a')?.movies).toBe(true);

            channels.set([LIVE]);

            expect(service.sectionsOf('pl-a')?.movies).toBe(false);
        });
    });

    describe('the split setting', () => {
        const withSetting = (m3uCatalogTabs?: () => boolean) => {
            TestBed.overrideProvider(SettingsStore, {
                useValue: m3uCatalogTabs ? { m3uCatalogTabs } : {},
            });
            channels.set([LIVE, MOVIE, EPISODE]);
            return TestBed.inject(M3uCatalogIndexService);
        };

        it('hands the live views every row when the setting is off', () => {
            const service = withSetting(() => false);

            expect(service.splitsCatalog()).toBe(false);
            expect(service.liveChannels()).toEqual([LIVE, MOVIE, EPISODE]);
        });

        it('splits when the setting is on or was never stored', () => {
            expect(withSetting(() => true).splitsCatalog()).toBe(true);
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    {
                        provide: Store,
                        useValue: {
                            selectSignal: (selector: unknown) =>
                                selector === selectChannelsLoading
                                    ? loading
                                    : selector === selectChannelsPlaylistId
                                      ? rowsPlaylistId
                                      : channels,
                        },
                    },
                ],
            });
            expect(withSetting().splitsCatalog()).toBe(true);
        });
    });

    describe('zapping', () => {
        it('steps through the live list, past the films filed behind it', () => {
            const withId = (row: Channel, id: string) => ({ ...row, id });
            const first = withId(LIVE, 'live-1');
            const film = withId(MOVIE, 'film-1');
            const second = withId(
                channel(
                    'http://h.example/live/u/p/9.ts',
                    'KANAL ORNEK 2',
                    'Ulusal'
                ),
                'live-2'
            );
            const all = [first, film, second];
            channels.set(all);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.adjacentChannel('next', first, all)).toBe(second);
            expect(service.adjacentChannel('previous', second, all)).toBe(
                first
            );
            expect(
                service.adjacentChannel('next', second, all)
            ).toBeUndefined();
        });
    });

    describe('parental lock', () => {
        const active = signal(true);
        const everything = signal(false);
        const locked = signal<string[]>(['Films']);
        const version = signal(0);

        beforeEach(() => {
            active.set(true);
            everything.set(false);
            locked.set(['Films']);
            TestBed.overrideProvider(ParentalLockService, {
                useValue: {
                    version,
                    active,
                    withholdsEverything: everything,
                    lockedGroupTitles: (playlistId: string) =>
                        playlistId === 'pl-a' ? locked() : [],
                },
            });
            channels.set([LIVE, MOVIE, EPISODE]);
        });

        it('takes the rows of a locked group out of every section', () => {
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.channelsOfKind('movie')()).toEqual([]);
            expect(
                service
                    .groupsOfKind('movie')()
                    .map((g) => g.title)
            ).toEqual([]);
            expect(service.channelsOfKind('episode')()).toEqual([EPISODE]);
            // The split stays on: the film is withheld, not a channel.
            expect(service.splitsCatalog()).toBe(true);
            expect(service.liveChannels()).toEqual([LIVE]);
        });

        it('leaves a locked live group to the channel list', () => {
            // The channel list withholds locked groups itself and offers
            // its "Enter PIN to show" row from them; filtering here would
            // take that way back away.
            locked.set(['Ulusal']);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.liveChannels()).toEqual([LIVE]);
        });

        it('keeps every episode for the series layer to withhold later', () => {
            locked.set(['Shows']);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.channelsOfKind('episode')()).toEqual([]);
            expect(service.allEpisodes()).toEqual([EPISODE]);
            expect(service.withheldGroups()).toEqual(new Set(['Shows']));
        });

        it('shows the rows again once unlocked', () => {
            const service = TestBed.inject(M3uCatalogIndexService);
            expect(service.channelsOfKind('movie')()).toEqual([]);

            active.set(false);
            version.update((value) => value + 1);

            expect(service.channelsOfKind('movie')()).toEqual([MOVIE]);
            expect(service.withheldGroups()).toBeNull();
        });

        it('withholds nothing when the playlist has no locked groups', () => {
            locked.set([]);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.withheldGroups()).toBeNull();
            expect(service.channelsOfKind('movie')()).toEqual([MOVIE]);
        });

        it('withholds nothing while the rows belong to no known playlist', () => {
            rowsPlaylistId.set(null);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.withheldGroups()).toBeNull();
        });

        it('withholds every group when the lock store cannot be read', () => {
            everything.set(true);
            const service = TestBed.inject(M3uCatalogIndexService);

            expect(service.withheldGroups()).toBe('all');
            expect(service.index().counts).toEqual({
                live: 0,
                movie: 0,
                episode: 0,
                radio: 0,
            });
        });
    });

    it('survives an empty playlist', () => {
        const service = TestBed.inject(M3uCatalogIndexService);

        expect(service.index().counts.live).toBe(0);
        expect(service.hasNonLiveContent()).toBe(false);
    });
});
