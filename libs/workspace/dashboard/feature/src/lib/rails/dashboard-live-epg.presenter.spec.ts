import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, EMPTY, of, Subject, throwError } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import {
    DEFAULT_DASHBOARD_RAILS_SETTINGS,
    type EpgProgram,
    type PlaylistMeta,
    type PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import { DashboardDataService } from '@iptvnator/workspace/dashboard/data-access';
import { DashboardLiveEpgPresenter } from './dashboard-live-epg.presenter';
import { DashboardPortalLiveEpgPresenter } from './dashboard-portal-live-epg.presenter';
import { DashboardLiveEpgClock } from './dashboard-live-epg-clock';
import type { DashboardRailCard } from './dashboard-rail.component';

const guideA = 'https://a.example/guide.xml';
const guideB = 'https://b.example/guide.xml';

const m3uPlaylist = (id: string, epgUrls: string[]): PlaylistMeta =>
    ({ _id: id, epgUrls }) as PlaylistMeta;

const card = (overrides: Partial<DashboardRailCard>): DashboardRailCard =>
    ({
        id: 'card',
        title: 'Das Erste HD',
        icon: 'live_tv',
        contentType: 'live',
        link: ['/workspace'],
        ...overrides,
    }) as DashboardRailCard;

const program = (title: string): EpgProgram =>
    ({
        channel: 'ard.de',
        title,
        start: '2026-05-23T10:00:00.000Z',
        stop: '2026-05-23T11:00:00.000Z',
    }) as EpgProgram;

describe('DashboardLiveEpgPresenter', () => {
    let presenter: DashboardLiveEpgPresenter;
    let getCurrentProgramsForChannels: jest.Mock;
    let epgAvailable: BehaviorSubject<boolean>;
    let playlists: ReturnType<typeof signal<PlaylistMeta[]>>;
    let recentItems: ReturnType<typeof signal<PortalActivityItem[]>>;
    let favoriteLiveItems: ReturnType<typeof signal<PortalActivityItem[]>>;
    let recentLiveItems: ReturnType<typeof signal<PortalActivityItem[]>>;
    let dashboardRails: ReturnType<
        typeof signal<typeof DEFAULT_DASHBOARD_RAILS_SETTINGS>
    >;
    /** Portal answers are the sibling presenter's job; stub it out here. */
    let portal: {
        connect: jest.Mock;
        setPinnedKeys: jest.Mock;
        setVisibleCards: jest.Mock;
        programFor: jest.Mock;
        isPending: jest.Mock;
        awaitsFirstAnswer: jest.Mock;
    };

    const setup = (cards: DashboardRailCard[]) => {
        presenter.connect(signal(cards));
        // `toObservable` pushes through an effect, so the connected cards
        // only reach the lookup once effects run.
        TestBed.tick();
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-05-23T10:30:00.000Z'));
        getCurrentProgramsForChannels = jest.fn(() => of(new Map()));
        epgAvailable = new BehaviorSubject(false);
        playlists = signal<PlaylistMeta[]>([
            m3uPlaylist('a', [guideA]),
            m3uPlaylist('a2', [guideA]),
            m3uPlaylist('b', [guideB]),
            { _id: 'portal', serverUrl: 'http://portal' } as PlaylistMeta,
        ]);

        recentItems = signal<PortalActivityItem[]>([]);
        favoriteLiveItems = signal<PortalActivityItem[]>([]);
        recentLiveItems = signal<PortalActivityItem[]>([]);
        dashboardRails = signal({ ...DEFAULT_DASHBOARD_RAILS_SETTINGS });
        portal = {
            connect: jest.fn(),
            setPinnedKeys: jest.fn(),
            setVisibleCards: jest.fn(),
            programFor: jest.fn(() => undefined),
            isPending: jest.fn(() => false),
            awaitsFirstAnswer: jest.fn(() => false),
        };

        TestBed.configureTestingModule({
            providers: [
                DashboardLiveEpgClock,
                DashboardLiveEpgPresenter,
                {
                    provide: DashboardPortalLiveEpgPresenter,
                    useValue: portal,
                },
                {
                    provide: DashboardDataService,
                    useValue: {
                        playlists,
                        // The presenter also derives the portal source list.
                        globalRecentItems: recentItems,
                        globalFavoriteLiveItems: favoriteLiveItems,
                        globalRecentLiveItems: recentLiveItems,
                    },
                },
                {
                    provide: EpgService,
                    useValue: {
                        getCurrentProgramsForChannels,
                        epgAvailable$: epgAvailable,
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        resolvedEpgOffsetMinutes: () => 0,
                        dashboardRails,
                    },
                },
            ],
        });
        presenter = TestBed.inject(DashboardLiveEpgPresenter);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('asks each guide once and lets playlists on the same guide share the lookup', () => {
        setup([
            card({ id: 'a', epgLookupKey: 'ard.de', epgPlaylistId: 'a' }),
            card({ id: 'a2', epgLookupKey: 'zdf.de', epgPlaylistId: 'a2' }),
            card({ id: 'b', epgLookupKey: 'ard.de', epgPlaylistId: 'b' }),
        ]);

        expect(
            getCurrentProgramsForChannels.mock.calls.map(([keys, options]) => [
                keys,
                options.sourceUrls,
            ])
        ).toEqual([
            [['ard.de', 'zdf.de'], [guideA]],
            [['ard.de'], [guideB]],
        ]);
    });

    it('keeps a portal card out of the any-source retry and in its own answer space', () => {
        const portalCard = card({ id: 'p', epgPlaylistId: 'portal' });
        const m3uCard = card({
            id: 'm',
            epgLookupKey: 'Das Erste HD',
            epgPlaylistId: 'guideless',
        });
        getCurrentProgramsForChannels.mockImplementation((keys, options) =>
            of(
                new Map<string, EpgProgram | null>([
                    [
                        'Das Erste HD',
                        program(
                            options.anySourceFallback
                                ? 'From any guide'
                                : 'From Settings only'
                        ),
                    ],
                ])
            )
        );

        setup([m3uCard, portalCard]);

        expect(
            getCurrentProgramsForChannels.mock.calls.map(
                ([, options]) => options.anySourceFallback
            )
        ).toEqual([true, false]);
        // Both resolve against Settings, both key on the same title, and they
        // still do not share an answer.
        expect(presenter.detailsFor(m3uCard)?.nowPlayingTitle).toBe(
            'From any guide'
        );
        expect(presenter.detailsFor(portalCard)?.nowPlayingTitle).toBe(
            'From Settings only'
        );
    });

    it('pins the hero live candidates only while the hero is enabled', () => {
        const live = (id: number, title: string) =>
            ({
                id: `x-${id}`,
                title,
                type: 'live',
                source: 'xtream',
                playlist_id: 'p',
                category_id: '1',
                xtream_id: id,
            }) as PortalActivityItem;
        favoriteLiveItems.set([live(7, 'Favourite channel')]);
        recentLiveItems.set([live(8, 'Recent channel'), live(7, 'Dup')]);
        TestBed.tick();

        // Favourites first, then recent channels, each channel once.
        expect(
            presenter
                .heroLiveCandidates()
                .map(({ origin, item }) => [origin, item.title])
        ).toEqual([
            ['favorite', 'Favourite channel'],
            ['recent', 'Recent channel'],
        ]);
        expect(portal.setPinnedKeys).toHaveBeenLastCalledWith([
            'xtream::p::7',
            'xtream::p::8',
        ]);

        // With the hero hidden nothing is pinned: a rail card nobody can
        // see must not keep the portal queue busy.
        dashboardRails.set({
            ...DEFAULT_DASHBOARD_RAILS_SETTINGS,
            hero: false,
        });
        TestBed.tick();
        expect(presenter.heroLiveCandidates()).toEqual([]);
        expect(portal.setPinnedKeys).toHaveBeenLastCalledWith([]);
    });

    it('looks up hero candidates even when no live rail is connected', () => {
        getCurrentProgramsForChannels.mockImplementation(() =>
            of(
                new Map<string, EpgProgram | null>([
                    ['ard.de', program('Tagesschau')],
                ])
            )
        );
        const channel = {
            id: 'ard-hd',
            title: 'Das Erste HD',
            type: 'live',
            source: 'm3u',
            playlist_id: 'a',
            category_id: '',
            xtream_id: 'ard-hd',
            epg_lookup_key: 'ard.de',
        } as PortalActivityItem;
        favoriteLiveItems.set([channel]);

        setup([]);

        expect(getCurrentProgramsForChannels).toHaveBeenCalledWith(
            ['ard.de'],
            expect.objectContaining({ sourceUrls: [guideA] })
        );
        expect(presenter.heroDetailsFor(channel)?.nowPlayingTitle).toBe(
            'Tagesschau'
        );
    });

    it('reports a hero live candidate still waiting for its first programme', () => {
        const xmltvAnswer = new Subject<Map<string, EpgProgram | null>>();
        getCurrentProgramsForChannels.mockImplementation(() => xmltvAnswer);
        expect(presenter.heroLiveAwaitingFirstAnswer()).toBe(false);

        const m3uChannel = {
            id: 'ard-hd',
            title: 'Das Erste HD',
            type: 'live',
            source: 'm3u',
            playlist_id: 'a',
            category_id: '',
            xtream_id: 'ard-hd',
            epg_lookup_key: 'ard.de',
        } as PortalActivityItem;
        favoriteLiveItems.set([m3uChannel]);
        setup([]);
        // The XMLTV batch for the candidate has not answered yet.
        expect(presenter.heroLiveAwaitingFirstAnswer()).toBe(true);

        xmltvAnswer.next(new Map([['ard.de', null]]));
        xmltvAnswer.complete();
        expect(presenter.heroLiveAwaitingFirstAnswer()).toBe(false);

        // A portal candidate also waits for its portal's first answer.
        portal.awaitsFirstAnswer.mockReturnValue(true);
        favoriteLiveItems.set([
            m3uChannel,
            {
                ...m3uChannel,
                id: 7,
                source: 'xtream',
                playlist_id: 'portal',
                xtream_id: 7,
                epg_lookup_key: undefined,
            } as PortalActivityItem,
        ]);
        getCurrentProgramsForChannels.mockImplementation(() =>
            of(new Map<string, EpgProgram | null>())
        );
        TestBed.tick();
        expect(presenter.heroLiveAwaitingFirstAnswer()).toBe(true);

        portal.awaitsFirstAnswer.mockReturnValue(false);
        favoriteLiveItems.update((items) => [...items]);
        TestBed.tick();
        expect(presenter.heroLiveAwaitingFirstAnswer()).toBe(false);
    });

    it('prefers the portal answer and forwards what the portal presenter owns', () => {
        const xmltvCard = card({
            id: 'x',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'a',
            liveEpgSourceKey: 'xtream::p::7',
        });
        getCurrentProgramsForChannels.mockImplementation(() =>
            of(
                new Map<string, EpgProgram | null>([
                    ['ard.de', program('From XMLTV')],
                ])
            )
        );
        portal.programFor.mockImplementation(
            (key: string | null | undefined) =>
                key === 'xtream::p::7' ? program('From the portal') : undefined
        );

        setup([xmltvCard]);

        expect(presenter.detailsFor(xmltvCard)?.nowPlayingTitle).toBe(
            'From the portal'
        );

        // A portal that answered "nothing on air" falls back to XMLTV.
        portal.programFor.mockReturnValue(null);
        expect(presenter.detailsFor(xmltvCard)?.nowPlayingTitle).toBe(
            'From XMLTV'
        );

        // The placeholder is only for a card still awaiting its FIRST answer.
        getCurrentProgramsForChannels.mockImplementation(() =>
            of(new Map<string, EpgProgram | null>())
        );
        setup([xmltvCard]);
        portal.programFor.mockReturnValue(undefined);
        portal.isPending.mockReturnValue(true);
        expect(presenter.enrich([xmltvCard])[0].nowPlayingState).toBe(
            'pending'
        );
        // An answered card keeps what it has instead of flashing.
        portal.programFor.mockReturnValue(program('Answered'));
        expect(presenter.enrich([xmltvCard])[0].nowPlayingState).toBeNull();
        expect(presenter.enrich([xmltvCard])[0].nowPlayingTitle).toBe(
            'Answered'
        );

        // The portal source list and the hero pin are the presenter's own
        // job; the rails only report what they can see.
        expect(portal.connect).toHaveBeenCalled();
        presenter.setVisibleCards('favorites', [xmltvCard]);
        expect(portal.setVisibleCards).toHaveBeenCalledWith('favorites', [
            xmltvCard,
        ]);
    });

    it('never hands a card the programme another guide resolved for the same id', () => {
        const fromA = card({
            id: 'a',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'a',
        });
        const fromB = card({
            id: 'b',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'b',
        });
        getCurrentProgramsForChannels.mockImplementation((keys, options) =>
            of(
                new Map<string, EpgProgram | null>([
                    [
                        'ard.de',
                        program(
                            options.sourceUrls[0] === guideA
                                ? 'Guide A bulletin'
                                : 'Guide B bulletin'
                        ),
                    ],
                ])
            )
        );

        setup([fromA, fromB]);

        expect(presenter.detailsFor(fromA)?.nowPlayingTitle).toBe(
            'Guide A bulletin'
        );
        expect(presenter.detailsFor(fromB)?.nowPlayingTitle).toBe(
            'Guide B bulletin'
        );
    });

    /** One clock tick: the interval fires, then effects flush. */
    const tick = (count = 1) => {
        for (let index = 0; index < count; index++) {
            jest.advanceTimersByTime(30_000);
            TestBed.tick();
        }
    };

    it('asks a guide again once a programme on air has ended', () => {
        const fromA = card({
            id: 'a',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'a',
        });
        getCurrentProgramsForChannels.mockImplementation(() =>
            of(
                new Map([
                    [
                        'ard.de',
                        {
                            ...program('Short'),
                            stop: '2026-05-23T10:32:00.000Z',
                        },
                    ],
                ])
            )
        );
        setup([fromA]);
        expect(getCurrentProgramsForChannels).toHaveBeenCalledTimes(1);

        // 10:30 → 10:31:30: still on air.
        tick(3);
        expect(getCurrentProgramsForChannels).toHaveBeenCalledTimes(1);

        // The 10:32 tick sees it ended and asks again.
        tick();
        expect(getCurrentProgramsForChannels).toHaveBeenCalledTimes(2);
    });

    it('asks again at least every five minutes while a programme is on air', () => {
        const fromA = card({
            id: 'a',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'a',
        });
        getCurrentProgramsForChannels.mockImplementation(() =>
            of(new Map([['ard.de', program('Tagesschau')]]))
        );
        setup([fromA]);

        // 10:30 → 10:34:30: the 10:00–11:00 programme is on air and fresh.
        tick(9);
        expect(getCurrentProgramsForChannels).toHaveBeenCalledTimes(1);

        // 10:35: the answer is five minutes old; a guide may have changed.
        tick();
        expect(getCurrentProgramsForChannels).toHaveBeenCalledTimes(2);
    });

    it('asks again at once when a guide import or source change lands', () => {
        const fromA = card({
            id: 'a',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'a',
        });
        getCurrentProgramsForChannels.mockImplementation(() =>
            of(new Map([['ard.de', program('Tagesschau')]]))
        );
        setup([fromA]);
        expect(getCurrentProgramsForChannels).toHaveBeenCalledTimes(1);

        getCurrentProgramsForChannels.mockImplementation(() =>
            of(new Map([['ard.de', program('Corrected')]]))
        );
        epgAvailable.next(true);
        TestBed.tick();

        expect(getCurrentProgramsForChannels).toHaveBeenCalledTimes(2);
        expect(presenter.detailsFor(fromA)?.nowPlayingTitle).toBe('Corrected');
    });

    it('moves progress on every clock tick while the programme is unchanged', () => {
        const fromA = card({
            id: 'a',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'a',
        });
        getCurrentProgramsForChannels.mockImplementation(() =>
            of(new Map([['ard.de', program('Tagesschau')]]))
        );
        setup([fromA]);
        const progress = TestBed.runInInjectionContext(() =>
            computed(() => presenter.detailsFor(fromA)?.nowPlayingProgress)
        );
        expect(progress()).toBe(50);

        jest.advanceTimersByTime(6 * 60_000);
        TestBed.tick();

        expect(progress()).toBe(60);
    });

    it('keeps the other guides when one lookup is retired or fails mid-tick', () => {
        const fromA = card({
            id: 'a',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'a',
        });
        const fromB = card({
            id: 'b',
            epgLookupKey: 'ard.de',
            epgPlaylistId: 'b',
        });
        getCurrentProgramsForChannels.mockImplementation((keys, options) =>
            options.sourceUrls[0] === guideA
                ? of(
                      new Map<string, EpgProgram | null>([
                          ['ard.de', program('Guide A bulletin')],
                      ])
                  )
                : // What the EPG source-change guard does to work in flight:
                  // complete without ever emitting.
                  EMPTY
        );

        setup([fromA, fromB]);

        expect(presenter.detailsFor(fromA)?.nowPlayingTitle).toBe(
            'Guide A bulletin'
        );
        expect(presenter.detailsFor(fromB)).toBeNull();

        getCurrentProgramsForChannels.mockImplementation((keys, options) =>
            options.sourceUrls[0] === guideA
                ? of(
                      new Map<string, EpgProgram | null>([
                          ['ard.de', program('Guide A bulletin')],
                      ])
                  )
                : throwError(() => new Error('lookup failed'))
        );
        const callsBeforeTick = getCurrentProgramsForChannels.mock.calls.length;
        jest.advanceTimersByTime(30_000);
        TestBed.tick();
        // Guide B never answered, so the tick asks both guides again.
        expect(getCurrentProgramsForChannels.mock.calls.length).toBe(
            callsBeforeTick + 2
        );

        expect(presenter.detailsFor(fromA)?.nowPlayingTitle).toBe(
            'Guide A bulletin'
        );
        expect(presenter.detailsFor(fromB)).toBeNull();
    });
});
