import {
    ChangeDetectionStrategy,
    Component,
    Directive,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import {
    GlobalFavoritesListComponent,
    UnifiedLiveTabComponent,
} from '@iptvnator/portal/shared/ui';
import {
    AudioPlayerComponent,
    ArtPlayerComponent,
    HtmlVideoPlayerComponent,
    VjsPlayerComponent,
} from '@iptvnator/ui/playback';
import {
    EpgDateNavigationDirection,
    EpgListComponent,
    getTodayEpgDateKey,
    shiftEpgDateKey,
} from '@iptvnator/ui/epg';
import { ResizableDirective } from 'components';
import { SettingsStore } from 'services';
import { Channel, EpgItem, EpgProgram } from 'shared-interfaces';
import {
    EpgViewComponent,
    LiveEpgPanelComponent,
    LiveEpgPanelSummary,
} from 'shared-portals';
import {
    DEFAULT_FAVORITES_CHANNEL_SORT_MODE,
    PORTAL_PLAYER,
    FavoritesChannelSortMode,
    StreamResolverService,
    UnifiedCollectionItem,
    UnifiedFavoriteChannel,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/util';

@Directive({
    selector: '[appResizable]',
})
class StubResizableDirective {
    readonly minWidth = input<number>();
    readonly maxWidth = input<number>();
    readonly defaultWidth = input<number>();
    readonly storageKey = input<string>('');
}

@Component({
    selector: 'app-global-favorites-list',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubGlobalFavoritesListComponent {
    readonly channels = input.required<UnifiedFavoriteChannel[]>();
    readonly mode = input<'favorites' | 'recent'>('favorites');
    readonly favoriteUids = input<ReadonlySet<string>>(new Set<string>());
    readonly epgMap = input<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = input(0);
    readonly activeUid = input<string | null>(null);
    readonly searchTermInput = input('');
    readonly draggable = input(true);
    readonly sortMode = input<FavoritesChannelSortMode>(
        DEFAULT_FAVORITES_CHANNEL_SORT_MODE
    );

    readonly channelSelected = output<UnifiedFavoriteChannel>();
    readonly channelsReordered = output<UnifiedFavoriteChannel[]>();
    readonly favoriteToggled = output<UnifiedFavoriteChannel>();
    readonly removeRequested = output<UnifiedFavoriteChannel>();
}

@Component({
    selector: 'app-epg-list',
    template: '<div class="stub-epg-list"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubEpgListComponent {
    readonly controlledChannel = input<Channel | null>(null);
    readonly controlledPrograms = input<EpgProgram[] | null>(null);
    readonly archivePlaybackAvailable = input<boolean | null>(null);
    readonly selectedDate = input<string | null>(null);
    readonly showDateNavigator = input(true);
    readonly selectedDateChange = output<string>();
}

@Component({
    selector: 'app-epg-view',
    template: '<div class="stub-epg-view"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubEpgViewComponent {
    readonly epgItems = input<EpgItem[]>([]);
}

@Component({
    selector: 'app-live-epg-panel',
    template: '<section class="stub-live-epg-panel"><ng-content /></section>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubLiveEpgPanelComponent {
    readonly collapsed = input(false);
    readonly summary = input<LiveEpgPanelSummary | null>(null);
    readonly loading = input(false);
    readonly showDateNavigator = input(false);
    readonly selectedDate = input<string | null>(null);
    readonly collapsedChange = output<boolean>();
    readonly dateNavigation = output<EpgDateNavigationDirection>();
}

@Component({
    selector: 'app-vjs-player',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubVjsPlayerComponent {
    readonly options = input<unknown>();
    readonly volume = input(1);
}

@Component({
    selector: 'app-html-video-player',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubHtmlVideoPlayerComponent {
    readonly channel = input<Channel | null>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
}

@Component({
    selector: 'app-art-player',
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubArtPlayerComponent {
    readonly channel = input<Channel | null>(null);
    readonly volume = input(1);
    readonly showCaptions = input(false);
}

@Component({
    selector: 'app-audio-player',
    template: '<div class="stub-audio-player"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubAudioPlayerComponent {
    readonly icon = input('');
    readonly url = input.required<string>();
    readonly channelName = input('');
}

describe('UnifiedLiveTabComponent', () => {
    let fixture: ComponentFixture<UnifiedLiveTabComponent>;
    let component: UnifiedLiveTabComponent;
    let streamResolver: {
        resolveLiveDetail: jest.Mock;
        resolveM3uPlaybackDetail: jest.Mock;
        loadM3uProgramsForItem: jest.Mock;
        loadEpgForItems: jest.Mock;
    };
    let recentData: {
        recordLivePlayback: jest.Mock;
    };
    let portalPlayer: {
        isEmbeddedPlayer: jest.Mock;
        openResolvedPlayback: jest.Mock;
    };

    beforeEach(async () => {
        localStorage.removeItem('live-epg-panel-state');

        streamResolver = {
            resolveLiveDetail: jest.fn(),
            resolveM3uPlaybackDetail: jest.fn(),
            loadM3uProgramsForItem: jest.fn().mockResolvedValue([]),
            loadEpgForItems: jest.fn().mockResolvedValue(new Map()),
        };
        recentData = {
            recordLivePlayback: jest.fn(),
        };
        portalPlayer = {
            isEmbeddedPlayer: jest.fn().mockReturnValue(false),
            openResolvedPlayback: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), UnifiedLiveTabComponent],
            providers: [
                { provide: StreamResolverService, useValue: streamResolver },
                { provide: UnifiedRecentDataService, useValue: recentData },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        player: signal('videojs'),
                    },
                },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
            ],
        })
            .overrideComponent(UnifiedLiveTabComponent, {
                remove: {
                    imports: [
                        AudioPlayerComponent,
                        ArtPlayerComponent,
                        EpgListComponent,
                        EpgViewComponent,
                        GlobalFavoritesListComponent,
                        HtmlVideoPlayerComponent,
                        LiveEpgPanelComponent,
                        ResizableDirective,
                        VjsPlayerComponent,
                    ],
                },
                add: {
                    imports: [
                        StubAudioPlayerComponent,
                        StubArtPlayerComponent,
                        StubEpgListComponent,
                        StubEpgViewComponent,
                        StubGlobalFavoritesListComponent,
                        StubHtmlVideoPlayerComponent,
                        StubLiveEpgPanelComponent,
                        StubResizableDirective,
                        StubVjsPlayerComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
        component = fixture.componentInstance;
    });

    it('renders controlled M3U EPG and records recent history on selection', async () => {
        const item = buildLiveItem('m3u');
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/m3u.m3u8',
                title: 'M3U Live',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Live',
                url: 'https://example.com/m3u.m3u8',
                group: { title: 'News' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: '',
                    logo: 'm3u.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [],
        });
        streamResolver.loadM3uProgramsForItem.mockResolvedValue([
            buildProgram('M3U Show'),
        ]);
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(streamResolver.loadM3uProgramsForItem).toHaveBeenCalledWith(
            item,
            expect.objectContaining({
                id: 'm3u-channel',
            })
        );
        expect(
            fixture.nativeElement.querySelector('app-epg-list')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-view')).toBeNull();
    });

    it('passes recent mode and favorite state to the shared live collection list', async () => {
        const item = buildLiveItem('m3u');
        const favoriteUids = new Set<string>([item.uid]);
        const toggledItems: UnifiedCollectionItem[] = [];
        const subscription = component.favoriteToggled.subscribe((toggled) =>
            toggledItems.push(toggled)
        );

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.componentRef.setInput('favoriteUids', favoriteUids);
        fixture.detectChanges();
        await fixture.whenStable();

        const list = fixture.debugElement.query(
            By.directive(StubGlobalFavoritesListComponent)
        ).componentInstance as StubGlobalFavoritesListComponent;

        expect(list.mode()).toBe('recent');
        expect(list.favoriteUids()).toBe(favoriteUids);

        list.favoriteToggled.emit(list.channels()[0]);

        expect(toggledItems).toEqual([item]);
        subscription.unsubscribe();
    });

    it('maps shared live list remove requests back to collection items', async () => {
        const item = buildLiveItem('xtream');
        const removedItems: UnifiedCollectionItem[] = [];
        const subscription = component.removeItem.subscribe((removed) =>
            removedItems.push(removed)
        );

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        const list = fixture.debugElement.query(
            By.directive(StubGlobalFavoritesListComponent)
        ).componentInstance as StubGlobalFavoritesListComponent;

        list.removeRequested.emit(list.channels()[0]);

        expect(removedItems).toEqual([item]);
        subscription.unsubscribe();
    });

    it('wraps inline M3U EPG in the live panel with shared date navigation', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        const item = buildLiveItem('m3u');
        const currentProgram = buildCurrentProgram('M3U Now');
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/m3u.m3u8',
                title: 'M3U Live',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Live',
                url: 'https://example.com/m3u.m3u8',
                group: { title: 'News' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: '',
                    logo: 'm3u.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [currentProgram],
        });
        streamResolver.loadM3uProgramsForItem.mockResolvedValue([
            currentProgram,
        ]);
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        const panel = fixture.debugElement.query(
            By.directive(StubLiveEpgPanelComponent)
        ).componentInstance as StubLiveEpgPanelComponent;
        const epgList = fixture.debugElement.query(
            By.directive(StubEpgListComponent)
        ).componentInstance as StubEpgListComponent;

        expect(panel.showDateNavigator()).toBe(true);
        expect(panel.summary()).toEqual(
            expect.objectContaining({ title: 'M3U Now' })
        );
        expect(epgList.showDateNavigator()).toBe(false);
        expect(epgList.selectedDate()).toBe(getTodayEpgDateKey());

        panel.dateNavigation.emit('next');
        fixture.detectChanges();

        const nextDate = shiftEpgDateKey(getTodayEpgDateKey(), 'next');
        expect(component.selectedLiveEpgDate()).toBe(nextDate);
        expect(epgList.selectedDate()).toBe(nextDate);
    });

    it('wraps inline portal EPG in the live panel without date navigation', async () => {
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);
        const item = buildLiveItem('xtream');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [buildCurrentEpgItem('Xtream Now')],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        const panel = fixture.debugElement.query(
            By.directive(StubLiveEpgPanelComponent)
        ).componentInstance as StubLiveEpgPanelComponent;

        expect(panel.showDateNavigator()).toBe(false);
        expect(panel.summary()).toEqual(
            expect.objectContaining({ title: 'Xtream Now' })
        );
        expect(
            fixture.nativeElement.querySelector('app-epg-view')
        ).not.toBeNull();

        panel.collapsedChange.emit(true);
        fixture.detectChanges();

        expect(component.isLiveEpgPanelCollapsed()).toBe(true);
        expect(localStorage.getItem('live-epg-panel-state')).toBe('collapsed');
    });

    it('does not wait for M3U program lookup before opening playback', async () => {
        const item = buildLiveItem('m3u');
        const pendingPrograms = createDeferred<EpgProgram[]>();
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/m3u.m3u8',
                title: 'M3U Live',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Live',
                url: 'https://example.com/m3u.m3u8',
                group: { title: 'News' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Live',
                    url: '',
                    logo: 'm3u.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [buildProgram('M3U Show')],
        });
        streamResolver.loadM3uProgramsForItem.mockReturnValue(
            pendingPrograms.promise
        );
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(portalPlayer.openResolvedPlayback).toHaveBeenCalledWith(
            expect.objectContaining({
                streamUrl: 'https://example.com/m3u.m3u8',
            })
        );
        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(streamResolver.loadM3uProgramsForItem).toHaveBeenCalled();

        pendingPrograms.resolve([buildProgram('M3U Show')]);
        await fixture.whenStable();
    });

    it('renders inline audio for M3U radio items and skips external playback', async () => {
        const item = {
            ...buildLiveItem('m3u'),
            radio: 'true',
        } satisfies UnifiedCollectionItem;
        streamResolver.resolveM3uPlaybackDetail.mockResolvedValue({
            epgMode: 'm3u',
            playback: {
                streamUrl: 'https://example.com/radio.m3u8',
                title: 'M3U Radio',
                thumbnail: 'radio.png',
            },
            channel: {
                id: 'm3u-channel',
                name: 'M3U Radio',
                url: 'https://example.com/radio.m3u8',
                group: { title: 'Radio' },
                tvg: {
                    id: 'm3u-channel',
                    name: 'M3U Radio',
                    url: '',
                    logo: 'radio.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'true',
                epgParams: '',
            },
            epgPrograms: [],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(
            fixture.nativeElement.querySelector('app-audio-player')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-list')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-view')).toBeNull();
    });

    it('renders inline audio for Stalker radio items and skips external playback', async () => {
        const item = {
            ...buildLiveItem('stalker'),
            name: 'Jazz Radio',
            radio: 'true',
        } satisfies UnifiedCollectionItem;
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/jazz.mp3',
                title: 'Jazz Radio',
                thumbnail: 'jazz.png',
            },
            channel: {
                id: '40001',
                name: 'Jazz Radio',
                url: 'https://example.com/jazz.mp3',
                group: { title: 'Radio' },
                tvg: {
                    id: '40001',
                    name: 'Jazz Radio',
                    url: '',
                    logo: 'jazz.png',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'true',
                epgParams: '',
            },
            epgItems: [],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(portalPlayer.openResolvedPlayback).not.toHaveBeenCalled();
        expect(
            fixture.nativeElement.querySelector('app-audio-player')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-list')).toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-view')).toBeNull();

        const audioPlayer = fixture.debugElement.query(
            By.directive(StubAudioPlayerComponent)
        ).componentInstance as StubAudioPlayerComponent;
        expect(audioPlayer.url()).toBe('https://example.com/jazz.mp3');
        expect(audioPlayer.icon()).toBe('jazz.png');
        expect(audioPlayer.channelName()).toBe('Jazz Radio');
    });

    it('renders shared EPG view for Xtream items and records recent history', async () => {
        const item = buildLiveItem('xtream');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [buildEpgItem('Xtream Show')],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(
            fixture.nativeElement.querySelector('app-epg-view')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('app-epg-list')).toBeNull();
    });

    it('renders shared EPG view for Stalker items and records recent history', async () => {
        const item = buildLiveItem('stalker');
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/stalker.m3u8',
                title: 'Stalker Live',
            },
            epgItems: [buildEpgItem('Stalker Show')],
        });
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(recentData.recordLivePlayback).toHaveBeenCalledWith(item);
        expect(
            fixture.nativeElement.querySelector('app-epg-view')
        ).not.toBeNull();
    });

    it('does not restart auto-open while the same live item is still resolving', async () => {
        const item = buildLiveItem('xtream');
        const pendingDetail = createDeferred<{
            epgMode: 'portal';
            playback: {
                streamUrl: string;
                title: string;
            };
            epgItems: EpgItem[];
        }>();
        const autoOpenHandledSpy = jest.spyOn(
            component.autoOpenHandled,
            'emit'
        );

        streamResolver.resolveLiveDetail.mockReturnValue(pendingDetail.promise);
        recentData.recordLivePlayback.mockResolvedValue({
            ...item,
            viewedAt: '2026-03-26T12:00:00.000Z',
        });

        fixture.componentRef.setInput('items', [item]);
        fixture.componentRef.setInput('autoOpenItem', {
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: item.playlistId,
            itemId: String(item.xtreamId),
            title: item.name,
            imageUrl: item.logo,
        });
        fixture.detectChanges();
        await Promise.resolve();

        expect(streamResolver.resolveLiveDetail).toHaveBeenCalledTimes(1);
        expect(component.isSelecting()).toBe(true);

        fixture.componentRef.setInput('items', [{ ...item }]);
        fixture.detectChanges();
        await Promise.resolve();

        expect(streamResolver.resolveLiveDetail).toHaveBeenCalledTimes(1);

        pendingDetail.resolve({
            epgMode: 'portal',
            playback: {
                streamUrl: 'https://example.com/xtream.m3u8',
                title: 'Xtream Live',
            },
            epgItems: [buildEpgItem('Xtream Show')],
        });
        await fixture.whenStable();
        fixture.detectChanges();

        expect(component.activeDetail()).toEqual(
            expect.objectContaining({
                playback: expect.objectContaining({
                    streamUrl: 'https://example.com/xtream.m3u8',
                }),
            })
        );
        expect(autoOpenHandledSpy).toHaveBeenCalledTimes(1);
    });
});

function buildLiveItem(
    sourceType: 'm3u' | 'xtream' | 'stalker'
): UnifiedCollectionItem {
    if (sourceType === 'm3u') {
        return {
            uid: 'm3u::pl-1::m3u-channel',
            name: 'M3U Live',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'pl-1',
            playlistName: 'Playlist One',
            streamUrl: 'https://example.com/m3u.m3u8',
            channelId: 'm3u-channel',
            tvgId: 'm3u-channel',
            logo: 'm3u.png',
            radio: 'false',
        };
    }

    if (sourceType === 'xtream') {
        return {
            uid: 'xtream::pl-2::20',
            name: 'Xtream Live',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'pl-2',
            playlistName: 'Playlist Two',
            xtreamId: 20,
            tvgId: '20',
            logo: 'xtream.png',
        };
    }

    return {
        uid: 'stalker::pl-3::30',
        name: 'Stalker Live',
        contentType: 'live',
        sourceType: 'stalker',
        playlistId: 'pl-3',
        playlistName: 'Playlist Three',
        stalkerId: '30',
        stalkerCmd: 'ffmpeg http://stalker/30',
        tvgId: '30',
        logo: 'stalker.png',
    };
}

function buildProgram(title: string): EpgProgram {
    return {
        start: '2026-03-26T11:00:00.000Z',
        stop: '2026-03-26T12:00:00.000Z',
        channel: 'test-channel',
        title,
        desc: `${title} description`,
        category: null,
    };
}

function buildCurrentProgram(title: string): EpgProgram {
    const now = Date.now();
    return {
        start: new Date(now - 10 * 60 * 1000).toISOString(),
        stop: new Date(now + 10 * 60 * 1000).toISOString(),
        channel: 'test-channel',
        title,
        desc: `${title} description`,
        category: null,
    };
}

function buildEpgItem(title: string): EpgItem {
    return {
        id: '1',
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: '2026-03-26T11:00:00.000Z',
        end: '2026-03-26T12:00:00.000Z',
        stop: '2026-03-26T12:00:00.000Z',
        channel_id: '1',
        start_timestamp: '1774522800',
        stop_timestamp: '1774526400',
    };
}

function buildCurrentEpgItem(title: string): EpgItem {
    const now = Date.now();
    const start = now - 10 * 60 * 1000;
    const stop = now + 10 * 60 * 1000;

    return {
        id: '1',
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: new Date(start).toISOString(),
        end: new Date(stop).toISOString(),
        stop: new Date(stop).toISOString(),
        channel_id: '1',
        start_timestamp: String(Math.floor(start / 1000)),
        stop_timestamp: String(Math.floor(stop / 1000)),
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}
