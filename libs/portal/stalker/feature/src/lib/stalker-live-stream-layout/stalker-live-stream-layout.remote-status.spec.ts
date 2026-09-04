import { EventEmitter, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';

/**
 * Focused spec for the remote-control status lifecycle (ITV + radio modes
 * and the destroy-time reset). Kept separate from the main layout spec,
 * which sits at the max-lines test budget; the template is overridden to
 * empty because these behaviors live entirely in constructor effects.
 */
describe('StalkerLiveStreamLayoutComponent remote status', () => {
    let fixture: ComponentFixture<StalkerLiveStreamLayoutComponent>;
    const originalElectron = window.electron;

    const itvChannels = signal([
        { id: '10001', cmd: 'ffrt4://itv/1', name: 'Alpha TV', o_name: 'Alpha TV', logo: 'a.png' },
        { id: '10002', cmd: 'ffrt4://itv/2', name: 'Beta TV', o_name: 'Beta TV', logo: 'b.png' },
    ]);
    const radioChannels = signal([
        { id: 'radio-1', cmd: 'ifm https://s/jazz.mp3', name: 'Jazz FM', o_name: 'Jazz FM', logo: 'j.png' },
        { id: 'radio-2', cmd: 'ifm https://s/news.mp3', name: 'News Radio', o_name: 'News Radio', logo: 'n.png' },
    ]);
    const selectedItem = signal<{
        id: string;
        cmd: string;
        name: string;
        o_name: string;
        logo: string;
    } | null>(null);
    const selectedContentType = signal<'itv' | 'vod' | 'series' | 'radio'>(
        'itv'
    );
    const selectedItvId = signal<string | undefined>(undefined);

    const stalkerStore = {
        getSelectedCategoryName: signal('News'),
        itvChannels,
        radioChannels,
        searchPhrase: signal(''),
        hasMoreChannels: signal(false),
        itvFullListActive: signal(false),
        itvFullListLoading: signal(false),
        itvFullListProgress: signal(null),
        itvFullChannelList: signal([]),
        itvSelectedCategoryFromCache: signal(false),
        isPaginatedContentLoading: signal(false),
        preloadItvChannels: jest.fn(),
        refreshItvChannels: jest.fn().mockResolvedValue(undefined),
        selectedItvId,
        currentPlaylist: signal({ _id: 'playlist-1', title: 'Demo Stalker' }),
        selectedItvEpgPrograms: signal<EpgProgram[]>([]),
        bulkItvEpgByChannel: signal<Record<string, EpgProgram[]>>({}),
        bulkItvEpgLoaded: signal(false),
        bulkItvEpgPlaylistId: signal<string | null>(null),
        bulkItvEpgPeriodHours: signal<number | null>(null),
        isLoadingBulkItvEpg: signal(false),
        selectedCategoryId: signal<string | null>('1001'),
        selectedItem,
        selectedContentType,
        page: signal(0),
        setItvChannels: jest.fn(),
        setRadioChannels: jest.fn(),
        setPage: jest.fn(),
        setSelectedItem: jest.fn(),
        resolveItvPlayback: jest.fn().mockResolvedValue({
            streamUrl: 'https://example.com/alpha.m3u8',
        }),
        resolveRadioPlayback: jest.fn().mockResolvedValue({
            streamUrl: 'https://s/jazz.mp3',
        }),
        fetchChannelEpg: jest.fn().mockResolvedValue([]),
        ensureBulkItvEpg: jest.fn().mockResolvedValue(undefined),
        applyMappedItvEpg: jest.fn().mockResolvedValue(undefined),
        hasItvEpgMappingOverride: jest.fn(() => false),
        clearBulkItvEpgCache: jest.fn(),
        addToFavorites: jest.fn(),
        removeFromFavorites: jest.fn(),
    };

    const updateRemoteControlStatus = jest.fn();

    beforeEach(async () => {
        updateRemoteControlStatus.mockClear();
        window.electron = {
            platform: 'darwin',
            setUserAgent: jest.fn().mockResolvedValue(true),
            updateRemoteControlStatus,
            onChannelChange: jest.fn(() => jest.fn()),
            onRemoteControlCommand: jest.fn(() => jest.fn()),
        } as typeof window.electron;

        selectedContentType.set('itv');
        selectedItem.set(itvChannels()[0]);
        selectedItvId.set('10001');
        stalkerStore.selectedItvEpgPrograms.set([]);

        await TestBed.configureTestingModule({
            imports: [StalkerLiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                { provide: StalkerStore, useValue: stalkerStore },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                        get isElectron() {
                            return Boolean(window.electron);
                        },
                        get supportsEpgMapping() {
                            return Boolean(window.electron);
                        },
                        // Mirrors the real capability check: every
                        // remote-control bridge method must be present.
                        get supportsRemoteControl() {
                            const bridge = window.electron as
                                | Record<string, unknown>
                                | undefined;
                            return [
                                'updateRemoteControlStatus',
                                'onChannelChange',
                                'onRemoteControlCommand',
                            ].every(
                                (method) =>
                                    typeof bridge?.[method] === 'function'
                            );
                        },
                    },
                },
                {
                    provide: PlaylistsService,
                    useValue: { getPortalFavorites: jest.fn(() => of([])) },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: jest.fn(() => true),
                        openResolvedPlayback: jest.fn(),
                        openExternalPlayback: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((value: string) => value),
                        get: jest.fn((value: string) => of(value)),
                        stream: jest.fn((value: string) => of(value)),
                        onTranslationChange: new EventEmitter(),
                        onLangChange: new EventEmitter(),
                        onDefaultLangChange: new EventEmitter(),
                    },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: {
                        supportsEpgMapping: false,
                        getEpgMapping: jest.fn().mockResolvedValue(null),
                        getEpgMappingsBatch: jest.fn().mockResolvedValue(null),
                    },
                },
            ],
        })
            .overrideComponent(StalkerLiveStreamLayoutComponent, {
                set: { template: '' },
            })
            .compileComponents();

        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
    });

    afterEach(() => {
        fixture?.destroy();
        window.electron = originalElectron;
    });

    it('publishes live status with EPG for the selected ITV channel', () => {
        stalkerStore.selectedItvEpgPrograms.set([nowProgram('Evening News')]);

        fixture.detectChanges();

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                portal: 'stalker',
                isLiveView: true,
                channelName: 'Alpha TV',
                channelNumber: 1,
                epgTitle: 'Evening News',
                supportsVolume: false,
            })
        );
    });

    it('publishes radio live status without leaking ITV EPG from the bulk cache', () => {
        selectedContentType.set('radio');
        selectedItem.set(radioChannels()[1]);
        selectedItvId.set('radio-2');
        // The ITV-keyed bulk cache survives itv→radio navigation, and small
        // integer ids collide across the two lists — radio status must not
        // read it.
        stalkerStore.selectedItvEpgPrograms.set([nowProgram('TV Show')]);

        fixture.detectChanges();

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith(
            expect.objectContaining({
                portal: 'stalker',
                isLiveView: true,
                channelName: 'News Radio',
                channelNumber: 2,
                epgTitle: undefined,
                epgStart: undefined,
                epgEnd: undefined,
                supportsVolume: false,
            })
        );
    });

    it('publishes a non-live snapshot while VOD content is selected', () => {
        selectedContentType.set('vod');

        fixture.detectChanges();

        expect(updateRemoteControlStatus).toHaveBeenLastCalledWith({
            portal: 'stalker',
            isLiveView: false,
            supportsVolume: false,
        });
    });

    it('publishes a remote status reset when the live view is destroyed', () => {
        fixture.detectChanges();
        updateRemoteControlStatus.mockClear();

        fixture.destroy();

        expect(updateRemoteControlStatus).toHaveBeenCalledWith({
            portal: 'unknown',
            isLiveView: false,
            supportsVolume: false,
        });
    });
});

function nowProgram(title: string): EpgProgram {
    const now = Date.now();
    return {
        start: new Date(now - 10 * 60 * 1000).toISOString(),
        stop: new Date(now + 10 * 60 * 1000).toISOString(),
        channel: '10001',
        title,
        desc: null,
        category: null,
    };
}
