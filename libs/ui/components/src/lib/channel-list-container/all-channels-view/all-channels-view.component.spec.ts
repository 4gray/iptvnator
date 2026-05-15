import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { Channel } from '@iptvnator/shared/interfaces';
import { ChannelDetailsDialogComponent } from '../channel-details-dialog/channel-details-dialog.component';
import { AllChannelsViewComponent } from './all-channels-view.component';

const ALL_CHANNELS_SORT_STORAGE_KEY = 'm3u-all-channels-sort-mode';

function createChannel(id: string, name: string, url: string): Channel {
    return {
        epgParams: '',
        group: {
            title: 'News',
        },
        http: {
            origin: '',
            referrer: '',
            'user-agent': '',
        },
        id,
        name,
        radio: 'false',
        tvg: {
            id: `${id}-tvg`,
            logo: '',
            name,
            rec: '7',
            url: '',
        },
        url,
        catchup: {
            days: '7',
            type: 'shift',
        },
    } as Channel;
}

describe('AllChannelsViewComponent', () => {
    let fixture: ComponentFixture<AllChannelsViewComponent>;
    let component: AllChannelsViewComponent;
    let dialog: { open: jest.Mock };

    const primaryChannel = createChannel(
        'channel-1',
        'News One',
        'https://example.com/news-one.m3u8'
    );

    beforeEach(async () => {
        localStorage.removeItem(ALL_CHANNELS_SORT_STORAGE_KEY);

        dialog = {
            open: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [
                AllChannelsViewComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AllChannelsViewComponent);
        component = fixture.componentInstance;

        fixture.componentRef.setInput('channels', [primaryChannel]);
        fixture.componentRef.setInput('searchTerm', '');
        fixture.componentRef.setInput('channelEpgMap', new Map<string, null>());
        fixture.componentRef.setInput(
            'channelIconMap',
            new Map<string, string>()
        );
        fixture.componentRef.setInput('progressTick', 0);
        fixture.componentRef.setInput('shouldShowEpg', false);
        fixture.componentRef.setInput('itemSize', 48);
        fixture.componentRef.setInput('favoriteIds', new Set<string>());
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        localStorage.removeItem(ALL_CHANNELS_SORT_STORAGE_KEY);
    });

    it('defaults to playlist order when no saved sort mode exists', () => {
        expect(component.allChannelsSortMode()).toBe('server');
        expect(component.allChannelsSortLabel()).toBe('Playlist Order');
    });

    it('restores a saved valid sort mode and ignores invalid stored values', () => {
        fixture.destroy();
        localStorage.setItem(ALL_CHANNELS_SORT_STORAGE_KEY, 'name-asc');

        fixture = TestBed.createComponent(AllChannelsViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('channels', [primaryChannel]);
        fixture.componentRef.setInput('searchTerm', '');
        fixture.componentRef.setInput('channelEpgMap', new Map<string, null>());
        fixture.componentRef.setInput(
            'channelIconMap',
            new Map<string, string>()
        );
        fixture.componentRef.setInput('progressTick', 0);
        fixture.componentRef.setInput('shouldShowEpg', false);
        fixture.componentRef.setInput('itemSize', 48);
        fixture.componentRef.setInput('favoriteIds', new Set<string>());
        fixture.detectChanges();

        expect(component.allChannelsSortMode()).toBe('name-asc');
        expect(component.allChannelsSortLabel()).toBe('Name A-Z');

        fixture.destroy();
        localStorage.setItem(ALL_CHANNELS_SORT_STORAGE_KEY, 'invalid');

        fixture = TestBed.createComponent(AllChannelsViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('channels', [primaryChannel]);
        fixture.componentRef.setInput('searchTerm', '');
        fixture.componentRef.setInput('channelEpgMap', new Map<string, null>());
        fixture.componentRef.setInput(
            'channelIconMap',
            new Map<string, string>()
        );
        fixture.componentRef.setInput('progressTick', 0);
        fixture.componentRef.setInput('shouldShowEpg', false);
        fixture.componentRef.setInput('itemSize', 48);
        fixture.componentRef.setInput('favoriteIds', new Set<string>());
        fixture.detectChanges();

        expect(component.allChannelsSortMode()).toBe('server');
    });

    it('persists sort mode changes', () => {
        component.setAllChannelsSortMode('name-desc');

        expect(component.allChannelsSortMode()).toBe('name-desc');
        expect(localStorage.getItem(ALL_CHANNELS_SORT_STORAGE_KEY)).toBe(
            'name-desc'
        );
    });

    it('sorts all channels by playlist order, name ascending, and name descending', () => {
        const alphaSignal = createChannel(
            'sort-1',
            'Alpha Signal',
            'https://example.com/alpha-signal.m3u8'
        );
        const zuluVision = createChannel(
            'sort-2',
            'Zulu Vision',
            'https://example.com/zulu-vision.m3u8'
        );
        const middleNews = createChannel(
            'sort-3',
            'Middle News',
            'https://example.com/middle-news.m3u8'
        );

        fixture.componentRef.setInput('channels', [
            zuluVision,
            alphaSignal,
            middleNews,
        ]);
        fixture.detectChanges();

        expect(
            component.filteredChannels().map((channel) => channel.name)
        ).toEqual(['Zulu Vision', 'Alpha Signal', 'Middle News']);

        component.setAllChannelsSortMode('name-asc');
        fixture.detectChanges();

        expect(
            component.filteredChannels().map((channel) => channel.name)
        ).toEqual(['Alpha Signal', 'Middle News', 'Zulu Vision']);

        component.setAllChannelsSortMode('name-desc');
        fixture.detectChanges();

        expect(
            component.filteredChannels().map((channel) => channel.name)
        ).toEqual(['Zulu Vision', 'Middle News', 'Alpha Signal']);
    });

    it('emits sidebar toggle requests from the inline header action', () => {
        const sidebarToggleRequested = jest.fn();
        component.sidebarToggleRequested.subscribe(sidebarToggleRequested);

        const toggleButton = fixture.nativeElement.querySelector(
            '.all-channels-sidebar-toggle'
        ) as HTMLButtonElement;

        toggleButton.click();

        expect(sidebarToggleRequested).toHaveBeenCalledTimes(1);
    });

    it('stores viewport coordinates for the context menu and opens the dialog for that channel', async () => {
        const openMenuSpy = jest
            .spyOn(component.contextMenuTrigger(), 'openMenu')
            .mockImplementation();

        component.onChannelContextMenu(primaryChannel, {
            clientX: 144,
            clientY: 188,
        } as MouseEvent);
        await Promise.resolve();

        expect(component.contextMenuChannel()).toBe(primaryChannel);
        expect(component.contextMenuPosition()).toEqual({
            x: '144px',
            y: '188px',
        });
        expect(openMenuSpy).toHaveBeenCalled();

        component.openChannelDetails();

        expect(dialog.open).toHaveBeenCalledWith(
            ChannelDetailsDialogComponent,
            expect.objectContaining({
                data: primaryChannel,
                maxWidth: '720px',
                width: 'calc(100vw - 32px)',
            })
        );
    });

    it('keeps the playlist logo when an EPG icon is also available', () => {
        const playlistLogo = 'https://example.com/playlist-logo.png';
        const channel = {
            ...primaryChannel,
            tvg: {
                ...primaryChannel.tvg,
                logo: playlistLogo,
            },
        };

        fixture.componentRef.setInput('channels', [channel]);
        fixture.componentRef.setInput(
            'channelIconMap',
            new Map([[channel.tvg.id, 'https://example.com/epg-logo.png']])
        );
        fixture.detectChanges();

        expect(
            component.getLogoForChannel(component.filteredChannels()[0])
        ).toBe(playlistLogo);
    });

    it('falls back to the EPG icon using tvg-name when tvg-id and playlist logo are missing', () => {
        const channel = {
            ...primaryChannel,
            tvg: {
                ...primaryChannel.tvg,
                id: '',
                logo: '',
                name: 'Guide News',
            },
        };

        fixture.componentRef.setInput('channels', [channel]);
        fixture.componentRef.setInput(
            'channelIconMap',
            new Map([['Guide News', 'https://example.com/guide-news.png']])
        );
        fixture.detectChanges();

        expect(
            component.getLogoForChannel(component.filteredChannels()[0])
        ).toBe('https://example.com/guide-news.png');
    });
});
