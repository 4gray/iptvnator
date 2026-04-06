import {
    ChangeDetectionStrategy,
    Component,
    Directive,
    input,
    output,
    signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
    GlobalFavoritesListComponent,
    UnifiedLiveTabComponent,
} from '@iptvnator/portal/shared/ui';
import {
    ArtPlayerComponent,
    HtmlVideoPlayerComponent,
    VjsPlayerComponent,
} from '@iptvnator/ui/playback';
import { EpgListComponent } from '@iptvnator/ui/epg';
import { ResizableDirective } from 'components';
import { SettingsStore } from 'services';
import { Channel, EpgItem, EpgProgram } from 'shared-interfaces';
import { EpgViewComponent } from 'shared-portals';
import {
    PORTAL_PLAYER,
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
    readonly epgMap = input<Map<string, EpgProgram | null>>(new Map());
    readonly progressTick = input(0);
    readonly activeUid = input<string | null>(null);
    readonly searchTermInput = input('');
    readonly draggable = input(true);

    readonly channelSelected = output<UnifiedFavoriteChannel>();
    readonly channelsReordered = output<UnifiedFavoriteChannel[]>();
    readonly favoriteToggled = output<UnifiedFavoriteChannel>();
}

@Component({
    selector: 'app-epg-list',
    template: '<div class="stub-epg-list"></div>',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubEpgListComponent {
    readonly controlledChannel = input<Channel | null>(null);
    readonly controlledPrograms = input<EpgProgram[] | null>(null);
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
            imports: [UnifiedLiveTabComponent],
            providers: [
                { provide: StreamResolverService, useValue: streamResolver },
                { provide: UnifiedRecentDataService, useValue: recentData },
                {
                    provide: SettingsStore,
                    useValue: {
                        player: signal('videojs'),
                    },
                },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
            ],
        })
            .overrideComponent(UnifiedLiveTabComponent, {
                remove: {
                    imports: [
                        ArtPlayerComponent,
                        EpgListComponent,
                        EpgViewComponent,
                        GlobalFavoritesListComponent,
                        HtmlVideoPlayerComponent,
                        ResizableDirective,
                        VjsPlayerComponent,
                    ],
                },
                add: {
                    imports: [
                        StubArtPlayerComponent,
                        StubEpgListComponent,
                        StubEpgViewComponent,
                        StubGlobalFavoritesListComponent,
                        StubHtmlVideoPlayerComponent,
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

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}
