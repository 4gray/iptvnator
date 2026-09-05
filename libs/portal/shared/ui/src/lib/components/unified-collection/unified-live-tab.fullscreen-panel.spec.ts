import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import {
    AudioPlayerComponent,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { EpgListViewComponent, EpgTimelineComponent } from '@iptvnator/ui/epg';
import { ResizableDirective } from '@iptvnator/ui/components';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { EpgProgram, VideoPlayer } from '@iptvnator/shared/interfaces';
import {
    PORTAL_PLAYER,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import {
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';
import {
    StubAudioPlayerComponent,
    StubEpgTimelineComponent,
    StubGlobalFavoritesListComponent,
    StubResizableDirective,
    StubWebPlayerViewComponent,
} from './unified-live-tab.spec-stubs';

/**
 * Focused spec for the fullscreen channel panel's zapping contract — kept
 * separate from the main layout spec, which sits at the max-lines test budget.
 */
describe('UnifiedLiveTabComponent fullscreen channel panel', () => {
    let fixture: ComponentFixture<UnifiedLiveTabComponent>;
    let component: UnifiedLiveTabComponent;
    let streamResolver: {
        resolveLiveDetail: jest.Mock;
        resolveM3uPlaybackDetail: jest.Mock;
        resolveXtreamCatchupUrl: jest.Mock;
        loadM3uProgramsForItem: jest.Mock;
        loadEpgForItems: jest.Mock;
    };
    let recentData: { recordLivePlayback: jest.Mock };
    let portalPlayer: {
        isEmbeddedPlayer: jest.Mock;
        openResolvedPlayback: jest.Mock;
        openExternalPlayback: jest.Mock;
    };
    const originalElectron = window.electron;

    beforeEach(async () => {
        window.electron = { platform: 'darwin' } as typeof window.electron;
        localStorage.removeItem('live-epg-panel-state');

        streamResolver = {
            resolveLiveDetail: jest.fn(),
            resolveM3uPlaybackDetail: jest.fn(),
            resolveXtreamCatchupUrl: jest.fn().mockResolvedValue(null),
            loadM3uProgramsForItem: jest.fn().mockResolvedValue([]),
            loadEpgForItems: jest.fn().mockResolvedValue(new Map()),
        };
        recentData = { recordLivePlayback: jest.fn() };
        portalPlayer = {
            isEmbeddedPlayer: jest.fn().mockReturnValue(false),
            openResolvedPlayback: jest.fn(),
            openExternalPlayback: jest.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), UnifiedLiveTabComponent],
            providers: [
                { provide: StreamResolverService, useValue: streamResolver },
                { provide: UnifiedRecentDataService, useValue: recentData },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        get supportsEpg() {
                            return Boolean(window.electron);
                        },
                    },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        player: signal(VideoPlayer.VideoJs),
                        stripCountryPrefix: signal(false),
                        resolvedEpgViewMode: signal('timeline'),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                { provide: PORTAL_PLAYER, useValue: portalPlayer },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        })
            .overrideComponent(UnifiedLiveTabComponent, {
                remove: {
                    imports: [
                        AudioPlayerComponent,
                        EpgListViewComponent,
                        EpgTimelineComponent,
                        GlobalFavoritesListComponent,
                        ResizableDirective,
                        WebPlayerViewComponent,
                    ],
                },
                add: {
                    imports: [
                        StubAudioPlayerComponent,
                        StubEpgTimelineComponent,
                        StubGlobalFavoritesListComponent,
                        StubResizableDirective,
                        StubWebPlayerViewComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture?.destroy();
        window.electron = originalElectron;
    });

    it('keeps the current detail (and its fullscreen player) mounted while the next selection resolves', async () => {
        const first = buildM3uLiveItem();
        const second: UnifiedCollectionItem = {
            ...first,
            uid: 'm3u::pl-1::m3u-channel-2',
            name: 'M3U Live 2',
            channelId: 'm3u-channel-2',
            tvgId: 'm3u-channel-2',
            streamUrl: 'https://example.com/m3u-2.m3u8',
        };
        const detailFor = (item: UnifiedCollectionItem) => ({
            epgMode: 'm3u' as const,
            playback: { streamUrl: item.streamUrl, title: item.name },
            channel: {
                id: item.channelId,
                name: item.name,
                url: item.streamUrl,
                group: { title: 'News' },
                tvg: {
                    id: item.tvgId,
                    name: item.name,
                    url: '',
                    logo: '',
                    rec: '',
                },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [],
        });
        let resolveSecond: (detail: ReturnType<typeof detailFor>) => void =
            () => undefined;
        streamResolver.resolveM3uPlaybackDetail
            .mockResolvedValueOnce(detailFor(first))
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveSecond = resolve;
                    })
            );
        recentData.recordLivePlayback.mockImplementation(
            async (item: UnifiedCollectionItem) => item
        );
        // The inline web player (the fullscreen owner) only mounts for an
        // embedded player; external MPV/VLC never render it.
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);

        fixture.componentRef.setInput('items', [first, second]);
        fixture.componentRef.setInput('mode', 'favorites');
        fixture.detectChanges();
        await fixture.whenStable();

        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        const firstDetail = component.activeDetail();
        expect(firstDetail?.playback.streamUrl).toBe(first.streamUrl);
        const firstSessionKey = component.playbackSessionKey();
        const playerView = () =>
            fixture.debugElement.query(By.directive(StubWebPlayerViewComponent));
        expect(playerView()).not.toBeNull();

        // A zap from the fullscreen panel: the mounted player (the fullscreen
        // element) must survive the resolution round-trip. Only the row
        // highlight moves ahead; the item stays paired with the detail the
        // player is still showing, so the session key and the recording/
        // archive metadata derived from it keep describing that stream.
        const pending = component.onChannelSelected(
            component.channelsForList()[1]
        );
        fixture.detectChanges();
        expect(component.activeUid()).toBe(second.uid);
        expect(component.activeItem()).toBe(first);
        expect(component.activeDetail()).toBe(firstDetail);
        expect(component.playbackSessionKey()).toBe(firstSessionKey);
        expect(playerView()).not.toBeNull();

        resolveSecond(detailFor(second));
        await pending;
        fixture.detectChanges();
        expect(component.activeItem()).toBe(second);
        expect(component.activeDetail()?.playback.streamUrl).toBe(
            second.streamUrl
        );
        expect(component.playbackSessionKey()).not.toBe(firstSessionKey);
    });

    it('keeps a catch-up override on the retained detail until the next one is in', async () => {
        // The mounted player is showing an archive programme; clearing the
        // override before the replacement resolves would drop it back to the
        // old channel's live URL for the length of the round-trip.
        const first = buildM3uLiveItem();
        const second: UnifiedCollectionItem = {
            ...first,
            uid: 'm3u::pl-1::m3u-channel-2',
            name: 'M3U Live 2',
            channelId: 'm3u-channel-2',
            tvgId: 'm3u-channel-2',
            streamUrl: 'https://example.com/m3u-2.m3u8',
        };
        const detailFor = (item: UnifiedCollectionItem) => ({
            epgMode: 'm3u' as const,
            playback: { streamUrl: item.streamUrl, title: item.name },
            channel: {
                id: item.channelId,
                name: item.name,
                url: item.streamUrl,
                group: { title: 'News' },
                tvg: { id: item.tvgId, name: item.name, url: '', logo: '', rec: '' },
                http: { referrer: '', 'user-agent': '', origin: '' },
                radio: 'false',
                epgParams: '',
            },
            epgPrograms: [],
        });
        let resolveSecond: (detail: ReturnType<typeof detailFor>) => void =
            () => undefined;
        streamResolver.resolveM3uPlaybackDetail
            .mockResolvedValueOnce(detailFor(first))
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveSecond = resolve;
                    })
            );
        recentData.recordLivePlayback.mockImplementation(
            async (item: UnifiedCollectionItem) => item
        );
        portalPlayer.isEmbeddedPlayer.mockReturnValue(true);

        fixture.componentRef.setInput('items', [first, second]);
        fixture.componentRef.setInput('mode', 'favorites');
        fixture.detectChanges();
        await fixture.whenStable();
        await component.onChannelSelected(component.channelsForList()[0]);
        const archiveUrl = 'https://example.com/m3u-archive.m3u8';
        component.activeTimeshift.set({
            url: archiveUrl,
            program: { title: 'Archived show' } as EpgProgram,
        });
        expect(component.inlinePlayback()?.streamUrl).toBe(archiveUrl);

        const pending = component.onChannelSelected(
            component.channelsForList()[1]
        );
        expect(component.inlinePlayback()?.streamUrl).toBe(archiveUrl);

        resolveSecond(detailFor(second));
        await pending;
        expect(component.activeTimeshift()).toBeNull();
        expect(component.inlinePlayback()?.streamUrl).toBe(second.streamUrl);
    });
});

function buildM3uLiveItem(): UnifiedCollectionItem {
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
