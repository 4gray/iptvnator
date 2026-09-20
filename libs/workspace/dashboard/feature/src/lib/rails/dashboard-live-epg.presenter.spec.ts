import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY, of, throwError } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import type { EpgProgram, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import { DashboardDataService } from '@iptvnator/workspace/dashboard/data-access';
import { DashboardLiveEpgPresenter } from './dashboard-live-epg.presenter';
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
    let playlists: ReturnType<typeof signal<PlaylistMeta[]>>;

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
        playlists = signal<PlaylistMeta[]>([
            m3uPlaylist('a', [guideA]),
            m3uPlaylist('a2', [guideA]),
            m3uPlaylist('b', [guideB]),
            { _id: 'portal', serverUrl: 'http://portal' } as PlaylistMeta,
        ]);

        TestBed.configureTestingModule({
            providers: [
                DashboardLiveEpgPresenter,
                {
                    provide: DashboardDataService,
                    useValue: { playlists },
                },
                {
                    provide: EpgService,
                    useValue: { getCurrentProgramsForChannels },
                },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: () => 0 },
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
        jest.advanceTimersByTime(30_000);

        expect(presenter.detailsFor(fromA)?.nowPlayingTitle).toBe(
            'Guide A bulletin'
        );
        expect(presenter.detailsFor(fromB)).toBeNull();
    });
});
