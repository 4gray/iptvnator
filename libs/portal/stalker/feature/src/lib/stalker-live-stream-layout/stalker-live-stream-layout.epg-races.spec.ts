import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    LiveLayoutSidebarStateService,
    PORTAL_PLAYER,
} from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import type { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import { ElectronStreamHeadersService } from '@iptvnator/ui/playback';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';

/**
 * Race regressions for the short-EPG fallback:
 *
 * 1. The panel fallback is scoped to the channel it was fetched for — a
 *    channel switch moves the selection synchronously, while the previous
 *    channel's fallback is only replaced once the new channel's EPG load
 *    runs. An unscoped merge mixed channel A's programmes into channel B's
 *    panel during (or after a failed) playback resolution.
 * 2. A queued row-preview fetch can complete after a manual XMLTV mapping
 *    (or a bulk refresh) claimed the row; the late portal response must not
 *    overwrite the installed owner.
 */
describe('StalkerLiveStreamLayoutComponent EPG fallback races', () => {
    let fixture: ComponentFixture<StalkerLiveStreamLayoutComponent>;
    let component: StalkerLiveStreamLayoutComponent;
    const playlist = signal({ _id: 'playlist-one', title: 'Portal One' });
    const channels = [
        {
            id: 'channel-one',
            cmd: 'ffrt4://itv/channel-one',
            name: 'One',
            o_name: 'One',
            logo: 'one.png',
        },
        {
            id: 'channel-two',
            cmd: 'ffrt4://itv/channel-two',
            name: 'Two',
            o_name: 'Two',
            logo: 'two.png',
        },
    ];
    const itvChannels = signal(channels);
    const selectedItvId = signal<string | undefined>(channels[0].id);
    const selectedItem = signal<(typeof channels)[number] | null>(channels[0]);
    const selectedContentType = signal<'itv' | 'radio'>('itv');
    const selectedItvEpgPrograms = signal<EpgProgram[]>([]);
    const bulkItvEpgByChannel = signal<Record<string, EpgProgram[]>>({});
    const bulkItvEpgLoaded = signal(false);
    const resolveItvPlayback = jest.fn();
    const fetchChannelEpg = jest.fn();
    const hasItvEpgMappingOverride = jest.fn(() => false);
    const store = {
        getSelectedCategoryName: signal('All'),
        currentPlaylist: playlist,
        selectedContentType,
        selectedCategoryId: signal<string | null>('all'),
        selectedItvId,
        selectedItem,
        itvChannels,
        radioChannels: signal([]),
        searchPhrase: signal(''),
        hasMoreChannels: signal(false),
        itvFullListActive: signal(false),
        itvSelectedCategoryFromCache: signal(false),
        itvFullListLoading: signal(false),
        itvFullListProgress: signal(null),
        itvFullChannelList: signal([]),
        isPaginatedContentLoading: signal(false),
        selectedItvEpgPrograms,
        bulkItvEpgByChannel,
        bulkItvEpgLoaded,
        bulkItvEpgPlaylistId: signal<string | null>('playlist-one'),
        bulkItvEpgPeriodHours: signal<number | null>(168),
        isLoadingBulkItvEpg: signal(false),
        setItvChannels: jest.fn(),
        setRadioChannels: jest.fn(),
        setPage: jest.fn(),
        preloadItvChannels: jest.fn(),
        applyMappedItvEpg: jest.fn().mockResolvedValue(undefined),
        hasItvEpgMappingOverride,
        clearBulkItvEpgCache: jest.fn(),
        ensureBulkItvEpg: jest.fn().mockResolvedValue(undefined),
        fetchChannelEpg,
        resolveItvPlayback,
        resolveRadioPlayback: jest.fn(),
        addToFavorites: jest.fn(),
        removeFromFavorites: jest.fn(),
        setSelectedItem: jest.fn((item: (typeof channels)[number]) => {
            selectedItem.set(item);
            selectedItvId.set(String(item.id));
            selectedItvEpgPrograms.set(
                bulkItvEpgByChannel()[String(item.id)] ?? []
            );
        }),
    };

    beforeEach(async () => {
        playlist.set({ _id: 'playlist-one', title: 'Portal One' });
        selectedContentType.set('itv');
        selectedItvId.set(channels[0].id);
        selectedItem.set(channels[0]);
        bulkItvEpgByChannel.set({
            'channel-one': [buildProgram('channel-one', 'Future A', 120)],
            'channel-two': [buildProgram('channel-two', 'Future B', 120)],
        });
        bulkItvEpgLoaded.set(true);
        selectedItvEpgPrograms.set(bulkItvEpgByChannel()['channel-one']);
        resolveItvPlayback.mockReset();
        resolveItvPlayback.mockResolvedValue({
            streamUrl: 'https://one.example/live.m3u8',
        });
        fetchChannelEpg.mockReset();
        fetchChannelEpg.mockImplementation(
            async (channelId: string | number) => [
                buildEpgItem(String(channelId), `Now ${channelId}`),
            ]
        );
        hasItvEpgMappingOverride.mockReset();
        hasItvEpgMappingOverride.mockReturnValue(false);
        await TestBed.configureTestingModule({
            imports: [StalkerLiveStreamLayoutComponent],
            providers: [
                { provide: StalkerStore, useValue: store },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: true,
                        isElectron: true,
                        supportsEpgMapping: false,
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getPortalFavorites: () => of([]) },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: () => true,
                        openResolvedPlayback: jest.fn(),
                    },
                },
                {
                    provide: ElectronStreamHeadersService,
                    useValue: { apply: jest.fn(), clear: jest.fn() },
                },
                {
                    provide: LiveLayoutSidebarStateService,
                    useValue: { isCollapsed: signal(false), toggle: jest.fn() },
                },
                { provide: EpgRuntimeBridgeService, useValue: {} },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        })
            .overrideComponent(StalkerLiveStreamLayoutComponent, {
                set: { template: '' },
            })
            .compileComponents();
        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => fixture.destroy());

    it('drops the previous channel fallback from the panel as soon as the selection moves', async () => {
        await component.playChannel(channels[0]);
        await fixture.whenStable();

        expect(
            component.activeEpgPrograms().map((program) => program.title)
        ).toEqual(['Now channel-one', 'Future A']);

        // A channel switch moves the selection synchronously; the EPG load
        // that replaces the fallback only runs after (slow or failing)
        // playback resolution. The stale fallback must not leak into B.
        store.setSelectedItem(channels[1]);

        expect(
            component.activeEpgPrograms().map((program) => program.title)
        ).toEqual(['Future B']);
    });

    it('stops the preview backlog when the view leaves ITV', async () => {
        // Let init settle: the playlist effect's first run resets the queue,
        // discarding whatever the init sync dispatched.
        await fixture.whenStable();
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        fetchChannelEpg.mockClear();

        // Re-arm the backlog: a bulk-loaded transition re-runs the preview
        // sync, which enqueues both future-only channels and dispatches the
        // first one immediately.
        bulkItvEpgLoaded.set(false);
        fixture.detectChanges();
        bulkItvEpgLoaded.set(true);
        fixture.detectChanges();
        const callsAtSwitch = fetchChannelEpg.mock.calls.length;
        expect(callsAtSwitch).toBeGreaterThan(0);

        // Leaving ITV must supersede the rest of the backlog — an abandoned
        // view must not keep spending portal requests on vanished rows.
        selectedContentType.set('radio');
        fixture.detectChanges();
        await new Promise<void>((resolve) => setTimeout(resolve, 600));

        expect(fetchChannelEpg.mock.calls.length).toBe(callsAtSwitch);
    });

    it('does not let a late queued fallback overwrite an installed owner', () => {
        const apply = (channelId: string) =>
            (
                component as unknown as {
                    applyFallbackPreviewPrograms(
                        id: string,
                        programs: EpgProgram[]
                    ): void;
                }
            ).applyFallbackPreviewPrograms(channelId, [
                buildProgram(channelId, `Portal ${channelId}`, -10),
            ]);

        // Mapping override installed while the fetch was in flight.
        hasItvEpgMappingOverride.mockReturnValue(true);
        apply('channel-one');
        expect(component.epgPreviewPrograms.get('channel-one')).toBeUndefined();

        // Bulk data claimed the row while the fetch was in flight.
        hasItvEpgMappingOverride.mockReturnValue(false);
        bulkItvEpgByChannel.set({
            'channel-two': [buildProgram('channel-two', 'Bulk Now', -10)],
        });
        apply('channel-two');
        expect(component.epgPreviewPrograms.get('channel-two')).toBeUndefined();

        // No owner — the fallback applies.
        apply('channel-one');
        expect(component.epgPreviewPrograms.get('channel-one')?.title).toBe(
            'Portal channel-one'
        );
    });
});

function buildProgram(
    channelId: string,
    title: string,
    startOffsetMinutes: number
): EpgProgram {
    const startTimestamp =
        Math.floor(Date.now() / 1000) + startOffsetMinutes * 60;
    const stopTimestamp = startTimestamp + 30 * 60;

    return {
        start: new Date(startTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        channel: channelId,
        title,
        desc: null,
        category: null,
        startTimestamp,
        stopTimestamp,
    };
}

function buildEpgItem(channelId: string, title: string): EpgItem {
    const program = buildProgram(channelId, title, -10);
    return {
        id: `${channelId}-${title}`,
        epg_id: '',
        title,
        lang: '',
        start: program.start,
        end: program.stop,
        stop: program.stop,
        description: `${title} description`,
        channel_id: channelId,
        start_timestamp: String(program.startTimestamp),
        stop_timestamp: String(program.stopTimestamp),
    };
}
