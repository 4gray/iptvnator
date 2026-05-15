import { Component, Directive, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
import {
    LIVE_EPG_PANEL_STATE_STORAGE_KEY,
    PORTAL_PLAYER,
    ResizableDirective,
} from '@iptvnator/portal/shared/util';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { EpgListComponent } from '@iptvnator/ui/epg';
import { AudioPlayerComponent } from '@iptvnator/ui/playback';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ChannelListItemComponent } from '@iptvnator/ui/components';
import { MockPipe } from 'ng-mocks';
import { of } from 'rxjs';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    LiveEpgPanelComponent,
    LiveEpgPanelSummary,
    WebPlayerViewComponent,
} from '@iptvnator/ui/shared-portals';
import { StalkerLiveStreamLayoutComponent } from './stalker-live-stream-layout.component';

@Component({
    selector: 'app-channel-list-item',
    standalone: true,
    template: '',
})
class StubChannelListItemComponent {
    readonly name = input('');
    readonly logo = input<string | null | undefined>(null);
    readonly selected = input(false);
    readonly epgProgram = input<unknown>(null);
    readonly progressPercentage = input(0);
    readonly showFavoriteButton = input(false);
    readonly showProgramInfoButton = input(false);
    readonly isFavorite = input(false);
    readonly clicked = output<void>();
    readonly activated = output<void>();
    readonly favoriteToggled = output<void>();
}

@Component({
    selector: 'app-web-player-view',
    standalone: true,
    template: '',
})
class StubWebPlayerViewComponent {
    readonly streamUrl = input('');
    readonly title = input('');
    readonly playback = input<unknown>(null);
    readonly externalFallbackRequested = output<unknown>();
}

@Component({
    selector: 'app-audio-player',
    standalone: true,
    template: '',
})
class StubAudioPlayerComponent {
    readonly url = input.required<string>();
    readonly icon = input('');
    readonly channelName = input('');
    readonly dispatchAdjacentChannelAction = input(true);
    readonly channelSwitchRequested = output<'next' | 'previous'>();
}

@Component({
    selector: 'app-epg-list',
    standalone: true,
    template: '',
})
class StubEpgListComponent {
    readonly controlledChannel = input<unknown>(null);
    readonly controlledPrograms = input<EpgProgram[] | null>(null);
    readonly controlledArchiveDays = input<number | null>(null);
    readonly archivePlaybackAvailable = input<boolean | null>(null);
    readonly selectedDate = input<string | null>(null);
    readonly showDateNavigator = input(true);
    readonly selectedDateChange = output<string>();
}

@Component({
    selector: 'app-live-epg-panel',
    standalone: true,
    template: `
        <div class="live-epg-panel-summary">{{ summary()?.title }}</div>
        <ng-content />
    `,
})
class StubLiveEpgPanelComponent {
    readonly collapsed = input(false);
    readonly summary = input<LiveEpgPanelSummary | null>(null);
    readonly loading = input(false);
    readonly showDateNavigator = input(false);
    readonly selectedDate = input<string | null>(null);
    readonly collapsedChange = output<boolean>();
    readonly dateNavigation = output<'next' | 'prev'>();
}

@Component({
    selector: 'app-portal-empty-state',
    standalone: true,
    template: '',
})
class StubPortalEmptyStateComponent {
    readonly icon = input('');
    readonly message = input('');
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
class StubResizableDirective {}

describe('StalkerLiveStreamLayoutComponent', () => {
    let fixture: ComponentFixture<StalkerLiveStreamLayoutComponent>;
    let component: StalkerLiveStreamLayoutComponent;
    let fetchChannelEpg: jest.Mock;
    let ensureBulkItvEpg: jest.Mock;
    let resolveItvPlayback: jest.Mock;
    let resolveRadioPlayback: jest.Mock;

    const playlist = signal({
        _id: 'playlist-1',
        title: 'Demo Stalker',
    });
    const selectedCategoryId = signal<string | null>('1001');
    const searchPhrase = signal('');
    const itvChannels = signal([
        {
            id: '10001',
            cmd: 'ffrt4://itv/10001',
            name: 'Alpha TV',
            o_name: 'Alpha TV',
            logo: 'alpha.png',
        },
        {
            id: '10002',
            cmd: 'ffrt4://itv/10002',
            name: 'Beta TV',
            o_name: 'Beta TV',
            logo: 'beta.png',
        },
    ]);
    const radioChannels = signal([
        {
            id: 'radio-1',
            cmd: 'ifm https://stream.example/jazz.mp3',
            name: 'Jazz FM',
            o_name: 'Jazz FM',
            logo: 'jazz.png',
        },
        {
            id: 'radio-2',
            cmd: 'ifm https://stream.example/news.mp3',
            name: 'News Radio',
            o_name: 'News Radio',
            logo: 'news-radio.png',
        },
    ]);
    const selectedItvId = signal<string | undefined>('10001');
    const selectedItem = signal<{
        id: string;
        cmd: string;
        name: string;
        o_name: string;
        logo: string;
    } | null>(itvChannels()[0]);
    const selectedItvEpgPrograms = signal<EpgProgram[]>([]);
    const bulkItvEpgByChannel = signal<Record<string, EpgProgram[]>>({});
    const bulkItvEpgLoaded = signal(false);
    const bulkItvEpgPlaylistId = signal<string | null>(null);
    const bulkItvEpgPeriodHours = signal<number | null>(null);
    const isLoadingBulkItvEpg = signal(false);
    const hasMoreChannels = signal(false);
    const page = signal(0);

    const stalkerStore = {
        getSelectedCategoryName: signal('News'),
        itvChannels,
        radioChannels,
        searchPhrase,
        hasMoreChannels,
        selectedItvId,
        currentPlaylist: playlist,
        selectedItvEpgPrograms,
        bulkItvEpgByChannel,
        bulkItvEpgLoaded,
        bulkItvEpgPlaylistId,
        bulkItvEpgPeriodHours,
        isLoadingBulkItvEpg,
        selectedCategoryId,
        selectedItem,
        selectedContentType: signal<'itv' | 'vod' | 'series' | 'radio'>('itv'),
        page,
        setItvChannels: jest.fn(),
        setRadioChannels: jest.fn(),
        setPage: jest.fn(),
        setSelectedItem: jest.fn((item) => {
            selectedItem.set(item);
            selectedItvId.set(String(item.id));
            selectedItvEpgPrograms.set(
                bulkItvEpgByChannel()[String(item.id)] ?? []
            );
        }),
        resolveItvPlayback: jest.fn(),
        resolveRadioPlayback: jest.fn(),
        fetchChannelEpg: jest.fn(),
        ensureBulkItvEpg: jest.fn(),
        clearBulkItvEpgCache: jest.fn(() => {
            bulkItvEpgByChannel.set({});
            bulkItvEpgLoaded.set(false);
            bulkItvEpgPlaylistId.set(null);
            bulkItvEpgPeriodHours.set(null);
            selectedItvEpgPrograms.set([]);
        }),
        addToFavorites: jest.fn(),
        removeFromFavorites: jest.fn(),
    };

    const playlistService = {
        getPortalFavorites: jest.fn(() => of([])),
    };
    const portalPlayer = {
        isEmbeddedPlayer: jest.fn(() => true),
        openResolvedPlayback: jest.fn(),
    };
    const settingsStore = {
        openStreamOnDoubleClick: signal(false),
    };

    beforeEach(async () => {
        fetchChannelEpg = stalkerStore.fetchChannelEpg;
        ensureBulkItvEpg = stalkerStore.ensureBulkItvEpg;
        resolveItvPlayback = stalkerStore.resolveItvPlayback;
        resolveRadioPlayback = stalkerStore.resolveRadioPlayback;

        selectedCategoryId.set('1001');
        searchPhrase.set('');
        stalkerStore.selectedContentType.set('itv');
        selectedItvId.set('10001');
        selectedItem.set(itvChannels()[0]);
        selectedItvEpgPrograms.set([]);
        bulkItvEpgByChannel.set({});
        bulkItvEpgLoaded.set(false);
        bulkItvEpgPlaylistId.set(null);
        bulkItvEpgPeriodHours.set(null);
        isLoadingBulkItvEpg.set(false);
        hasMoreChannels.set(false);
        page.set(0);
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
        settingsStore.openStreamOnDoubleClick.set(false);

        resolveItvPlayback.mockReset();
        resolveItvPlayback.mockResolvedValue({
            streamUrl: 'https://example.com/alpha.m3u8',
        });
        resolveRadioPlayback.mockReset();
        resolveRadioPlayback.mockResolvedValue({
            streamUrl: 'https://stream.example/jazz.mp3',
            title: 'Jazz FM',
            thumbnail: 'jazz.png',
        });
        portalPlayer.isEmbeddedPlayer.mockReset();
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        portalPlayer.openResolvedPlayback.mockClear();
        fetchChannelEpg.mockReset();
        fetchChannelEpg.mockResolvedValue([]);
        ensureBulkItvEpg.mockReset();
        ensureBulkItvEpg.mockImplementation(async () => {
            const bulkPrograms = {
                '10001': [buildProgram('10001', 'Current Show')],
                '10002': [buildProgram('10002', 'Next Channel Show')],
            };
            bulkItvEpgByChannel.set(bulkPrograms);
            bulkItvEpgLoaded.set(true);
            bulkItvEpgPlaylistId.set('playlist-1');
            bulkItvEpgPeriodHours.set(168);
            selectedItvEpgPrograms.set(
                bulkPrograms[selectedItvId() ?? ''] ?? []
            );
        });
        stalkerStore.setItvChannels.mockClear();
        stalkerStore.setRadioChannels.mockClear();
        stalkerStore.setPage.mockReset();
        stalkerStore.setPage.mockImplementation((nextPage: number) => {
            if (page() === nextPage) {
                return;
            }

            page.set(nextPage);
        });
        stalkerStore.setSelectedItem.mockClear();
        stalkerStore.clearBulkItvEpgCache.mockClear();

        await TestBed.configureTestingModule({
            imports: [StalkerLiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                { provide: StalkerStore, useValue: stalkerStore },
                { provide: PlaylistsService, useValue: playlistService },
                { provide: SettingsStore, useValue: settingsStore },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((value: string) => value),
                    },
                },
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn(),
                    },
                },
            ],
        })
            .overrideComponent(StalkerLiveStreamLayoutComponent, {
                remove: {
                    imports: [
                        ChannelListItemComponent,
                        AudioPlayerComponent,
                        EpgListComponent,
                        LiveEpgPanelComponent,
                        PortalEmptyStateComponent,
                        ResizableDirective,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubChannelListItemComponent,
                        StubAudioPlayerComponent,
                        StubEpgListComponent,
                        StubLiveEpgPanelComponent,
                        StubPortalEmptyStateComponent,
                        StubResizableDirective,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                        StubWebPlayerViewComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture?.destroy();
        localStorage.removeItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY);
    });

    it('renders the controlled epg list and removes the load-more button', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.load-more-epg')
        ).toBeNull();
    });

    it('restores the collapsed live EPG panel state after embedded playback starts', async () => {
        fixture.destroy();
        localStorage.setItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY, 'collapsed');

        fixture = TestBed.createComponent(StalkerLiveStreamLayoutComponent);
        component = fixture.componentInstance;
        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.isLiveEpgPanelCollapsed()).toBe(true);
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                .classList.contains('epg-collapsed')
        ).toBe(true);
    });

    it('persists live EPG panel toggle changes', () => {
        component.onLiveEpgPanelCollapsedChange(true);

        expect(component.isLiveEpgPanelCollapsed()).toBe(true);
        expect(localStorage.getItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY)).toBe(
            'collapsed'
        );

        component.onLiveEpgPanelCollapsedChange(false);

        expect(localStorage.getItem(LIVE_EPG_PANEL_STATE_STORAGE_KEY)).toBe(
            'expanded'
        );
    });

    it('does not render the collapsible panel for external playback', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('app-live-epg-panel')
        ).toBeNull();
        expect(
            fixture.nativeElement
                .querySelector('.epg')
                .classList.contains('epg-collapsed')
        ).toBe(false);
    });

    it('reuses a pending playback resolution during double-click activation', async () => {
        settingsStore.openStreamOnDoubleClick.set(true);
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        let resolvePlayback!: (value: { streamUrl: string }) => void;
        resolveItvPlayback.mockReturnValue(
            new Promise((resolve) => {
                resolvePlayback = resolve;
            })
        );

        const firstClick = component.playChannel(itvChannels()[0], false);
        const secondClick = component.playChannel(itvChannels()[0], false);
        const doubleClick = component.playChannel(itvChannels()[0], true);

        expect(resolveItvPlayback).toHaveBeenCalledTimes(1);

        resolvePlayback({
            streamUrl: 'https://example.com/alpha.m3u8',
        });
        await Promise.all([firstClick, secondClick, doubleClick]);

        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledTimes(1);
        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            { streamUrl: 'https://example.com/alpha.m3u8' },
            true
        );
    });

    it('does not attach a dangling finally cleanup to failed playback resolution', async () => {
        const playbackError = new Error('nothing_to_play');
        const playbackPromise = Promise.reject(playbackError);
        const finallySpy = jest.spyOn(playbackPromise, 'finally');
        resolveItvPlayback.mockReturnValue(playbackPromise);

        await component.playChannel(itvChannels()[0]);

        expect(finallySpy).not.toHaveBeenCalled();
    });

    it('starts external playback from remote channel navigation when double-click opening is enabled', async () => {
        settingsStore.openStreamOnDoubleClick.set(true);
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);
        selectedItem.set(itvChannels()[0]);
        selectedItvId.set('10001');

        (
            component as unknown as {
                handleRemoteChannelChange(direction: 'up' | 'down'): void;
            }
        ).handleRemoteChannelChange('down');
        await fixture.whenStable();

        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            { streamUrl: 'https://example.com/alpha.m3u8' },
            true
        );
    });

    it('starts external playback from remote number selection when double-click opening is enabled', async () => {
        settingsStore.openStreamOnDoubleClick.set(true);
        portalPlayer.isEmbeddedPlayer.mockReturnValue(false);

        (
            component as unknown as {
                handleRemoteControlCommand(command: {
                    type: 'channel-select-number';
                    number: number;
                }): void;
            }
        ).handleRemoteControlCommand({
            type: 'channel-select-number',
            number: 2,
        });
        await fixture.whenStable();

        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            { streamUrl: 'https://example.com/alpha.m3u8' },
            true
        );
    });

    it('renders the current EPG program in the collapsible panel summary', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.live-epg-panel-summary')
                .textContent
        ).toContain('Current Show');
    });

    it('does not reset live channels when loading the next lazy page', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise<void>((resolve) => setTimeout(resolve, 120));

        page.set(0);
        hasMoreChannels.set(true);
        stalkerStore.setItvChannels.mockClear();
        stalkerStore.setPage.mockClear();

        component.loadMore();
        await fixture.whenStable();

        expect(page()).toBe(1);
        expect(stalkerStore.setPage).toHaveBeenCalledWith(1);
        expect(stalkerStore.setItvChannels).not.toHaveBeenCalled();
    });

    it('keeps row previews empty before bulk epg is loaded', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.epgPreviewPrograms.size).toBe(0);
        expect(fetchChannelEpg).not.toHaveBeenCalled();
        expect(ensureBulkItvEpg).not.toHaveBeenCalled();
    });

    it('derives row previews from cached bulk epg after first playback', async () => {
        fixture.detectChanges();

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.epgPreviewPrograms.get('10001')?.title).toBe(
            'Current Show'
        );
        expect(component.epgPreviewPrograms.get('10002')?.title).toBe(
            'Next Channel Show'
        );
        expect(fetchChannelEpg).not.toHaveBeenCalled();
    });

    it('ensures bulk EPG only once across channel switches for the same playlist', async () => {
        fixture.detectChanges();

        await component.playChannel(itvChannels()[0]);
        await fixture.whenStable();
        await component.playChannel(itvChannels()[1]);
        await fixture.whenStable();

        expect(ensureBulkItvEpg).toHaveBeenCalledTimes(1);
        expect(ensureBulkItvEpg).toHaveBeenCalledWith(168);
    });

    it('renders inline audio playback and no EPG for radio stations', async () => {
        stalkerStore.selectedContentType.set('radio');
        selectedCategoryId.set('radio-all');
        selectedItem.set(null);
        selectedItvId.set(undefined);
        fixture.detectChanges();

        await component.playChannel(radioChannels()[0]);
        await fixture.whenStable();
        fixture.detectChanges();

        expect(resolveRadioPlayback).toHaveBeenCalledWith(radioChannels()[0]);
        expect(resolveItvPlayback).not.toHaveBeenCalled();
        expect(ensureBulkItvEpg).not.toHaveBeenCalled();
        expect(fetchChannelEpg).not.toHaveBeenCalled();
        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('app-epg-list')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('app-audio-player')
        ).not.toBeNull();

        const audioPlayer = fixture.debugElement.query(
            By.directive(StubAudioPlayerComponent)
        ).componentInstance as StubAudioPlayerComponent;
        expect(audioPlayer.url()).toBe('https://stream.example/jazz.mp3');
        expect(audioPlayer.icon()).toBe('jazz.png');
        expect(audioPlayer.channelName()).toBe('Jazz FM');
        expect(audioPlayer.dispatchAdjacentChannelAction()).toBe(false);
    });
});

function buildProgram(channelId: string, title: string): EpgProgram {
    const startTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    const stopTimestamp = startTimestamp + 30 * 60;

    return {
        start: new Date(startTimestamp * 1000).toISOString(),
        stop: new Date(stopTimestamp * 1000).toISOString(),
        channel: channelId,
        title,
        desc: `${title} description`,
        category: null,
        startTimestamp,
        stopTimestamp,
    };
}
