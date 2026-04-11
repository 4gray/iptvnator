import { Component, Directive, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockPipe } from 'ng-mocks';
import { of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PORTAL_PLAYER, ResizableDirective } from '@iptvnator/portal/shared/util';
import { EpgListComponent } from '@iptvnator/ui/epg';
import { WebPlayerViewComponent } from 'shared-portals';
import { ChannelListItemComponent } from 'components';
import { PlaylistsService } from 'services';
import { EpgProgram } from 'shared-interfaces';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { PortalEmptyStateComponent } from '@iptvnator/portal/shared/ui';
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
    readonly favoriteToggled = output<void>();
}

@Component({
    selector: 'app-web-player-view',
    standalone: true,
    template: '',
})
class StubWebPlayerViewComponent {
    readonly streamUrl = input('');
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

    const stalkerStore = {
        getSelectedCategoryName: signal('News'),
        itvChannels,
        searchPhrase,
        hasMoreChannels: signal(false),
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
        selectedContentType: signal<'itv' | 'vod' | 'series'>('itv'),
        page: signal(0),
        setItvChannels: jest.fn(),
        setPage: jest.fn(),
        setSelectedItem: jest.fn((item) => {
            selectedItem.set(item);
            selectedItvId.set(String(item.id));
            selectedItvEpgPrograms.set(
                bulkItvEpgByChannel()[String(item.id)] ?? []
            );
        }),
        resolveItvPlayback: jest.fn(),
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

    beforeEach(async () => {
        fetchChannelEpg = stalkerStore.fetchChannelEpg;
        ensureBulkItvEpg = stalkerStore.ensureBulkItvEpg;
        resolveItvPlayback = stalkerStore.resolveItvPlayback;

        selectedCategoryId.set('1001');
        searchPhrase.set('');
        selectedItvId.set('10001');
        selectedItem.set(itvChannels()[0]);
        selectedItvEpgPrograms.set([]);
        bulkItvEpgByChannel.set({});
        bulkItvEpgLoaded.set(false);
        bulkItvEpgPlaylistId.set(null);
        bulkItvEpgPeriodHours.set(null);
        isLoadingBulkItvEpg.set(false);

        resolveItvPlayback.mockReset();
        resolveItvPlayback.mockResolvedValue({
            streamUrl: 'https://example.com/alpha.m3u8',
        });
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
        stalkerStore.setPage.mockClear();
        stalkerStore.setSelectedItem.mockClear();
        stalkerStore.clearBulkItvEpgCache.mockClear();

        await TestBed.configureTestingModule({
            imports: [StalkerLiveStreamLayoutComponent, NoopAnimationsModule],
            providers: [
                { provide: StalkerStore, useValue: stalkerStore },
                { provide: PlaylistsService, useValue: playlistService },
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
                        EpgListComponent,
                        PortalEmptyStateComponent,
                        ResizableDirective,
                        TranslatePipe,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubChannelListItemComponent,
                        StubEpgListComponent,
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
