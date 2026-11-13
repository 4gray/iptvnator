import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { PORTAL_PLAYER } from '@iptvnator/portal/shared/util';
import {
    StreamResolverService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { ResizableDirective } from '@iptvnator/ui/components';
import { EpgListViewComponent, EpgTimelineComponent } from '@iptvnator/ui/epg';
import {
    AudioPlayerComponent,
    WebPlayerViewComponent,
} from '@iptvnator/ui/playback';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { GlobalFavoritesListComponent } from '../global-favorites-list/global-favorites-list.component';
import {
    buildCurrentEpgItem,
    buildLiveItem,
} from './unified-live-tab.spec-data';
import {
    StubAudioPlayerComponent,
    StubEpgTimelineComponent,
    StubGlobalFavoritesListComponent,
    StubResizableDirective,
    StubWebPlayerViewComponent,
} from './unified-live-tab.spec-stubs';
import {
    MultiviewEntryService,
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { UnifiedLiveTabComponent } from './unified-live-tab.component';

/**
 * The Favorites / Recently viewed live tab as a multiview anchor
 * (spec 11.2.4).
 */
describe('UnifiedLiveTabComponent multiview anchor', () => {
    let fixture: ComponentFixture<UnifiedLiveTabComponent>;
    let component: UnifiedLiveTabComponent;
    let streamResolver: {
        resolveLiveDetail: jest.Mock;
        loadEpgItems: jest.Mock;
        resolveM3uPlaybackDetail: jest.Mock;
        resolveXtreamCatchupUrl: jest.Mock;
        loadM3uProgramsForItem: jest.Mock;
        loadEpgForItems: jest.Mock;
    };
    let recentData: { recordLivePlayback: jest.Mock };
    const originalElectron = window.electron;

    beforeEach(async () => {
        window.electron = { platform: 'darwin' } as typeof window.electron;
        localStorage.removeItem('live-epg-panel-state');

        streamResolver = {
            loadEpgItems: jest.fn(
                async () =>
                    (
                        await streamResolver.resolveLiveDetail.mock.results.at(
                            -1
                        )?.value
                    )?.epgItems ?? []
            ),
            resolveLiveDetail: jest.fn(),
            resolveM3uPlaybackDetail: jest.fn(),
            resolveXtreamCatchupUrl: jest.fn().mockResolvedValue(null),
            loadM3uProgramsForItem: jest.fn().mockResolvedValue([]),
            loadEpgForItems: jest.fn().mockResolvedValue(new Map()),
        };
        recentData = { recordLivePlayback: jest.fn() };

        await TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot(), UnifiedLiveTabComponent],
            providers: [
                provideRouter([]),
                { provide: StreamResolverService, useValue: streamResolver },
                { provide: UnifiedRecentDataService, useValue: recentData },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsEpg: true, supportsProviderEpg: true },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        openStreamOnDoubleClick: signal(false),
                        player: signal(VideoPlayer.VideoJs),
                        stripCountryPrefix: signal(false),
                        resolvedEpgViewMode: signal<'timeline' | 'list'>(
                            'timeline'
                        ),
                        resolvedEpgOffsetMinutes: signal(0),
                    },
                },
                {
                    provide: PORTAL_PLAYER,
                    useValue: {
                        isEmbeddedPlayer: jest.fn().mockReturnValue(true),
                        openResolvedPlayback: jest.fn(),
                        openExternalPlayback: jest.fn(),
                    },
                },
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

        jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
        window.electron = originalElectron;
    });

    const xtream = buildLiveItem('xtream');
    const stalker = buildLiveItem('stalker');
    const OTHER: MultiviewTileSource = {
        playback: {
            streamUrl: 'https://example.com/stalker.m3u8',
            title: 'Stalker Live',
            isLive: true,
        },
        playbackSessionKey: 'live|pl-3|30',
        kind: 'live',
        playlistId: 'pl-3',
        contentId: stalker.uid,
        title: 'Stalker Live',
    };

    const inlinePlayer = (): HTMLElement | null =>
        fixture.nativeElement.querySelector('app-web-player-view');
    const placeholder = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="multiview-anchor-placeholder"]'
        );

    async function activateXtream(): Promise<void> {
        streamResolver.resolveLiveDetail.mockImplementation(async (item) => ({
            epgMode: 'portal',
            playback: {
                streamUrl: `https://example.com/${item.sourceType}.m3u8`,
                title: item.name,
                isLive: true,
            },
            epgItems: [buildCurrentEpgItem('Now')],
        }));
        recentData.recordLivePlayback.mockImplementation(async (item) => ({
            ...item,
            viewedAt: '2026-11-13T12:00:00.000Z',
        }));
        fixture.componentRef.setInput('items', [xtream, stalker]);
        fixture.componentRef.setInput('mode', 'recent');
        fixture.detectChanges();
        await fixture.whenStable();
        await component.onChannelSelected(component.channelsForList()[0]);
        fixture.detectChanges();
        await fixture.whenStable();
    }

    async function startSession(): Promise<void> {
        await activateXtream();
        TestBed.inject(MultiviewEntryService).add(OTHER);
        fixture.detectChanges();
    }

    it('renders the inline player as before while no session exists', async () => {
        await activateXtream();

        expect(inlinePlayer()).not.toBeNull();
        expect(placeholder()).toBeNull();
        expect(component.multiviewAnchor.host.source()).toMatchObject({
            playbackSessionKey: component.playbackSessionKey(),
            kind: 'live',
            playlistId: 'pl-2',
            contentId: xtream.uid,
        });
    });

    it('hands the playing row to tile 1 when a session starts here', async () => {
        await startSession();
        const store = TestBed.inject(MultiviewSessionStore);

        expect(store.anchorId()).toBe('unified-live');
        expect(store.tiles()[0].contentId).toBe(xtream.uid);
        expect(inlinePlayer()).toBeNull();
        expect(placeholder()).not.toBeNull();
    });

    it('selects a surviving row of the list when the session ends', async () => {
        await startSession();
        const store = TestBed.inject(MultiviewSessionStore);
        streamResolver.resolveLiveDetail.mockClear();

        store.setAudio(store.tiles()[1].id);
        store.exit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(streamResolver.resolveLiveDetail).toHaveBeenCalledWith(
            expect.objectContaining({ uid: stalker.uid }),
            expect.anything()
        );
        expect(inlinePlayer()).not.toBeNull();
    });

    it('ends the session when the tab is left', async () => {
        await startSession();

        fixture.destroy();

        expect(TestBed.inject(MultiviewSessionStore).exists()).toBe(false);
    });
});
