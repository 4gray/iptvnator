import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
    EpgProgram,
    PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import {
    DashboardPortalLiveEpgService,
    type DashboardPortalLiveEpgEntry,
} from '@iptvnator/workspace/dashboard/data-access';
import { DashboardPortalLiveEpgPresenter } from './dashboard-portal-live-epg.presenter';

const xtreamLive = (id: number, playlist = 'p'): PortalActivityItem =>
    ({
        id: `x-${id}`,
        title: `Channel ${id}`,
        type: 'live',
        source: 'xtream',
        playlist_id: playlist,
        category_id: '1',
        xtream_id: id,
    }) as PortalActivityItem;

describe('DashboardPortalLiveEpgPresenter', () => {
    let presenter: DashboardPortalLiveEpgPresenter;
    let sync: jest.Mock;
    let programs: ReturnType<
        typeof signal<ReadonlyMap<string, EpgProgram | null>>
    >;
    let pending: ReturnType<typeof signal<ReadonlySet<string>>>;
    let offsetMinutes: ReturnType<typeof signal<number>>;

    /** Keys of every sync call, sorted: the wanted set has no order. */
    const wantedKeys = (): string[][] =>
        sync.mock.calls.map(([entries]: [DashboardPortalLiveEpgEntry[]]) =>
            entries.map((entry) => entry.key).sort()
        );

    beforeEach(() => {
        sync = jest.fn();
        programs = signal<ReadonlyMap<string, EpgProgram | null>>(new Map());
        pending = signal<ReadonlySet<string>>(new Set());
        offsetMinutes = signal(0);
        TestBed.configureTestingModule({
            providers: [
                DashboardPortalLiveEpgPresenter,
                {
                    provide: DashboardPortalLiveEpgService,
                    useValue: { sync, programs, pending },
                },
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: offsetMinutes },
                },
            ],
        });
        presenter = TestBed.inject(DashboardPortalLiveEpgPresenter);
    });

    it('asks only for pinned and visible cards, deduplicated across rails', () => {
        const items = signal<readonly PortalActivityItem[]>([
            xtreamLive(1),
            xtreamLive(2),
            xtreamLive(3),
            // The same channel in the recent rail shares its key.
            xtreamLive(2),
        ]);
        presenter.connect(items);
        TestBed.tick();
        expect(wantedKeys().at(-1)).toEqual([]);

        presenter.setPinnedKeys(['xtream::p::1', null, undefined]);
        presenter.setVisibleCards('favorites', [
            { id: 'f2', liveEpgSourceKey: 'xtream::p::2' },
            { id: 'f3', liveEpgSourceKey: 'xtream::p::3' },
        ] as never);
        presenter.setVisibleCards('recent', [
            { id: 'r2', liveEpgSourceKey: 'xtream::p::2' },
            { id: 'm3u', liveEpgSourceKey: null },
        ] as never);
        TestBed.tick();
        expect(wantedKeys().at(-1)).toEqual([
            'xtream::p::1',
            'xtream::p::2',
            'xtream::p::3',
        ]);

        // Scrolled away: the favourites rail now shows only channel 3.
        presenter.setVisibleCards('favorites', [
            { id: 'f3', liveEpgSourceKey: 'xtream::p::3' },
        ] as never);
        TestBed.tick();
        expect(wantedKeys().at(-1)).toEqual([
            'xtream::p::1',
            'xtream::p::2',
            'xtream::p::3',
        ]);
        presenter.setVisibleCards('recent', []);
        TestBed.tick();
        expect(wantedKeys().at(-1)).toEqual(['xtream::p::1', 'xtream::p::3']);
    });

    it('ignores visible keys whose item is no longer on the dashboard', () => {
        const items = signal<readonly PortalActivityItem[]>([xtreamLive(1)]);
        presenter.connect(items);
        presenter.setVisibleCards('favorites', [
            { id: 'f1', liveEpgSourceKey: 'xtream::p::1' },
            { id: 'gone', liveEpgSourceKey: 'xtream::p::9' },
        ] as never);
        TestBed.tick();
        expect(wantedKeys().at(-1)).toEqual(['xtream::p::1']);

        items.set([]);
        TestBed.tick();
        expect(wantedKeys().at(-1)).toEqual([]);
    });

    it('re-syncs the same wanted set when the display offset changes', () => {
        presenter.connect(
            signal<readonly PortalActivityItem[]>([xtreamLive(1)])
        );
        presenter.setPinnedKeys(['xtream::p::1']);
        TestBed.tick();
        const before = sync.mock.calls.length;

        offsetMinutes.set(30);
        TestBed.tick();
        expect(sync.mock.calls.length).toBe(before + 1);
        expect(wantedKeys().at(-1)).toEqual(['xtream::p::1']);
    });

    it('hands its wanted set back to the root service when the dashboard is destroyed', () => {
        presenter.connect(
            signal<readonly PortalActivityItem[]>([xtreamLive(1)])
        );
        presenter.setPinnedKeys(['xtream::p::1']);
        TestBed.tick();
        expect(wantedKeys().at(-1)).toEqual(['xtream::p::1']);

        // The queue lives in the root service and would otherwise keep
        // asking for cards on a page the user has left.
        TestBed.resetTestingModule();
        expect(wantedKeys().at(-1)).toEqual([]);
    });

    it('answers a card from the service: undefined until asked, null when nothing is on air', () => {
        const program = { title: 'Now' } as EpgProgram;
        expect(presenter.programFor('xtream::p::1')).toBeUndefined();
        expect(presenter.programFor(null)).toBeUndefined();
        expect(presenter.isPending('xtream::p::1')).toBe(false);

        pending.set(new Set(['xtream::p::1']));
        expect(presenter.isPending('xtream::p::1')).toBe(true);
        expect(presenter.isPending(undefined)).toBe(false);

        programs.set(
            new Map([
                ['xtream::p::1', program],
                ['xtream::p::2', null],
            ])
        );
        expect(presenter.programFor('xtream::p::1')).toBe(program);
        expect(presenter.programFor('xtream::p::2')).toBeNull();
    });
});
