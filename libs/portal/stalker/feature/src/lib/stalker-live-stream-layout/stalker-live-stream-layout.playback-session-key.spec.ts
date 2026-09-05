import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
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
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { ElectronStreamHeadersService } from '@iptvnator/ui/playback';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

describe('StalkerLiveStreamLayoutComponent playback session ownership', () => {
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
    const resolveItvPlayback = jest.fn();
    const snackBar = { open: jest.fn() };
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
        selectedItvEpgPrograms: signal([]),
        bulkItvEpgByChannel: signal({}),
        isLoadingBulkItvEpg: signal(false),
        setItvChannels: jest.fn(),
        setRadioChannels: jest.fn(),
        setPage: jest.fn(),
        preloadItvChannels: jest.fn(),
        applyMappedItvEpg: jest.fn(),
        clearBulkItvEpgCache: jest.fn(),
        ensureBulkItvEpg: jest.fn(),
        fetchChannelEpg: jest.fn(),
        resolveItvPlayback,
        resolveRadioPlayback: jest.fn(),
        addToFavorites: jest.fn(),
        removeFromFavorites: jest.fn(),
        setSelectedItem: jest.fn((item: (typeof channels)[number]) => {
            selectedItem.set(item);
            selectedItvId.set(String(item.id));
        }),
    };

    beforeEach(async () => {
        playlist.set({ _id: 'playlist-one', title: 'Portal One' });
        selectedContentType.set('itv');
        selectedItvId.set(channels[0].id);
        selectedItem.set(channels[0]);
        resolveItvPlayback.mockReset();
        snackBar.open.mockReset();
        store.setSelectedItem.mockClear();
        await TestBed.configureTestingModule({
            imports: [StalkerLiveStreamLayoutComponent],
            providers: [
                { provide: StalkerStore, useValue: store },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: false,
                        isElectron: false,
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
                { provide: MatSnackBar, useValue: snackBar },
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

    it('changes identity only when the current embedded playback commits', async () => {
        const firstPlayback = { streamUrl: 'https://one.example/live.m3u8' };
        resolveItvPlayback.mockResolvedValueOnce(firstPlayback);
        await component.playChannel(channels[0]);
        const firstKey = component.playbackSessionKey();
        const session = () => [
            component.activePlayback(),
            component.playbackSessionKey(),
        ];
        expect(session()).toEqual([firstPlayback, firstKey]);

        const failed = deferred<ResolvedPortalPlayback>();
        resolveItvPlayback.mockReturnValueOnce(failed.promise);
        const failedSelection = component.playChannel(channels[1]);
        expect(selectedItem()).toBe(channels[0]);
        expect(component.isSelectedChannel(channels[0])).toBe(true);
        failed.reject(new Error('resolution failed'));
        await failedSelection;
        expect(session()).toEqual([firstPlayback, firstKey]);
        expect(selectedItem()).toBe(channels[0]);
        expect(component.isSelectedChannel(channels[0])).toBe(true);

        const stale = deferred<ResolvedPortalPlayback>();
        const current = deferred<ResolvedPortalPlayback>();
        resolveItvPlayback
            .mockReturnValueOnce(stale.promise)
            .mockReturnValueOnce(current.promise);
        const staleSelection = component.playChannel(channels[0]);
        const currentSelection = component.playChannel(channels[1]);
        expect(selectedItem()).toBe(channels[0]);
        const currentPlayback = {
            streamUrl: 'https://two.example/live.m3u8',
        };
        current.resolve(currentPlayback);
        stale.resolve({ streamUrl: 'https://stale.example/live.m3u8' });
        await Promise.all([staleSelection, currentSelection]);
        expect(selectedItem()).toBe(channels[1]);
        expect(component.isSelectedChannel(channels[1])).toBe(true);
        expect(session()).toEqual([
            currentPlayback,
            createPlaybackSessionKey({
                kind: 'live',
                sourceId: 'playlist-one',
                contentId: 'channel-two',
            }),
        ]);
    });

    it('does not dedupe the same channel id across playlist owners', async () => {
        const sourceA = deferred<ResolvedPortalPlayback>();
        const sourceB = deferred<ResolvedPortalPlayback>();
        resolveItvPlayback
            .mockReturnValueOnce(sourceA.promise)
            .mockReturnValueOnce(sourceB.promise);
        const shared = { ...channels[0], id: 'shared-channel' };
        playlist.set({ _id: 'playlist-a', title: 'Portal A' });
        const requestA = component.playChannel(shared);
        playlist.set({ _id: 'playlist-b', title: 'Portal B' });
        const requestB = component.playChannel(shared);
        const playbackB = { streamUrl: 'https://b.example/shared.m3u8' };

        sourceB.resolve(playbackB);
        sourceA.resolve({ streamUrl: 'https://a.example/shared.m3u8' });
        await Promise.all([requestA, requestB]);

        expect(resolveItvPlayback).toHaveBeenCalledTimes(2);
        expect(component.activePlayback()).toBe(playbackB);
        expect(component.playbackSessionKey()).toBe(
            createPlaybackSessionKey({
                kind: 'live',
                sourceId: 'playlist-b',
                contentId: 'shared-channel',
            })
        );
    });

    it('preserves the committed pair when source or channel identity is absent', async () => {
        const valid = { streamUrl: 'https://valid.example/live.m3u8' };
        resolveItvPlayback.mockResolvedValueOnce(valid);
        await component.playChannel(channels[0]);
        const key = component.playbackSessionKey();

        playlist.set({ _id: '', title: 'Missing source' });
        resolveItvPlayback.mockResolvedValueOnce({
            streamUrl: 'https://invalid.example/source.m3u8',
        });
        await component.playChannel(channels[1]);
        expect([
            component.activePlayback(),
            component.playbackSessionKey(),
        ]).toEqual([valid, key]);

        playlist.set({ _id: 'playlist-one', title: 'Portal One' });
        resolveItvPlayback.mockResolvedValueOnce({
            streamUrl: 'https://invalid.example/channel.m3u8',
        });
        await component.playChannel({ ...channels[1], id: '' });
        expect([
            component.activePlayback(),
            component.playbackSessionKey(),
        ]).toEqual([valid, key]);
    });

    it('does not commit a pending ITV request after the mode changes to radio with the same channel id', async () => {
        const pending = deferred<ResolvedPortalPlayback>();
        resolveItvPlayback.mockReturnValue(pending.promise);
        const request = component.playChannel(channels[0]);

        selectedContentType.set('radio');
        pending.resolve({ streamUrl: 'https://stale.example/itv.m3u8' });
        await request;

        expect(component.activePlayback()).toBeNull();
        expect(component.playbackSessionKey()).toBe('');
    });

    it('suppresses a stale rejection after playlist, mode, and channel ownership change', async () => {
        const pending = deferred<ResolvedPortalPlayback>();
        resolveItvPlayback.mockReturnValue(pending.promise);
        const request = component.playChannel(channels[0]);

        playlist.set({ _id: 'playlist-two', title: 'Portal Two' });
        selectedContentType.set('radio');
        selectedItvId.set(channels[1].id);
        pending.reject(new Error('stale owner failure'));
        await request;

        expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('still reports an error for the current full owner', async () => {
        resolveItvPlayback.mockRejectedValueOnce(new Error('current failure'));

        await component.playChannel(channels[0]);

        expect(snackBar.open).toHaveBeenCalledWith(
            'PORTALS.PLAYBACK_ERROR',
            undefined,
            { duration: 3000 }
        );
    });

    it('does not overwrite a selection changed outside the pending playback request', async () => {
        const pending = deferred<ResolvedPortalPlayback>();
        resolveItvPlayback.mockReturnValueOnce(pending.promise);
        const request = component.playChannel(channels[0]);
        store.setSelectedItem(channels[1]);
        pending.resolve({ streamUrl: 'https://stale.example/live.m3u8' });
        await request;
        expect(selectedItem()).toBe(channels[1]);
        expect(component.activePlayback()).toBeNull();
    });
});
