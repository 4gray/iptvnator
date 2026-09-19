import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { By } from '@angular/platform-browser';
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
import { OpenInPlaylistChipComponent } from '../open-in-playlist-chip/open-in-playlist-chip.component';
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
import { UnifiedLiveTabComponent } from './unified-live-tab.component';

/**
 * "Open in playlist" for the live tab — kept separate from the main layout
 * spec, which sits at the max-lines test budget.
 */
describe('UnifiedLiveTabComponent open in playlist', () => {
    let fixture: ComponentFixture<UnifiedLiveTabComponent>;
    let component: UnifiedLiveTabComponent;
    let navigate: jest.SpyInstance;
    let streamResolver: {
        resolveLiveDetail: jest.Mock;
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
                    useValue: { supportsEpg: true },
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
                        isEmbeddedPlayer: jest.fn().mockReturnValue(false),
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

        navigate = jest
            .spyOn(TestBed.inject(Router), 'navigate')
            .mockResolvedValue(true);
        fixture = TestBed.createComponent(UnifiedLiveTabComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
        window.electron = originalElectron;
    });

    async function activate(sourceType: 'xtream' | 'stalker') {
        const item = buildLiveItem(sourceType);
        streamResolver.resolveLiveDetail.mockResolvedValue({
            epgMode: 'portal',
            playback: {
                streamUrl: `https://example.com/${sourceType}.m3u8`,
                title: item.name,
            },
            epgItems: [buildCurrentEpgItem('Now')],
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
        return item;
    }

    function chip() {
        return fixture.debugElement.query(
            By.css('.stub-epg-timeline app-open-in-playlist-chip')
        );
    }

    it('projects the playlist chip into the EPG panel for an Xtream channel and navigates on click', async () => {
        await activate('xtream');

        const projected = chip();
        expect(projected).not.toBeNull();
        expect(
            (
                projected.componentInstance as OpenInPlaylistChipComponent
            ).playlistName()
        ).toBe('Playlist Two');

        (
            projected.componentInstance as OpenInPlaylistChipComponent
        ).activated.emit();

        expect(navigate).toHaveBeenCalledWith(
            ['/workspace', 'xtreams', 'pl-2', 'live'],
            {
                state: {
                    openXtreamLiveItemId: 20,
                    openXtreamLivePlaylistId: 'pl-2',
                    openXtreamLiveTitle: 'Xtream Live',
                    openXtreamLivePoster: 'xtream.png',
                },
            }
        );
    });

    it('keeps the chip out of the panel for a Stalker channel', async () => {
        await activate('stalker');

        expect(component.openInPlaylistTarget()).toBeNull();
        expect(chip()).toBeNull();
    });

    it('navigates when a sidebar row asks to open in its playlist', async () => {
        const item = buildLiveItem('m3u');
        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        const list = fixture.debugElement.query(
            By.directive(StubGlobalFavoritesListComponent)
        ).componentInstance as StubGlobalFavoritesListComponent;
        list.openInPlaylistRequested.emit(list.channels()[0]);

        expect(navigate).toHaveBeenCalledWith(
            ['/workspace', 'playlists', 'pl-1', 'all'],
            { state: { openM3uChannelUrl: 'https://example.com/m3u.m3u8' } }
        );
    });

    it('ignores row requests whose target does not resolve', async () => {
        const item = buildLiveItem('stalker');
        fixture.componentRef.setInput('items', [item]);
        fixture.detectChanges();
        await fixture.whenStable();

        const list = fixture.debugElement.query(
            By.directive(StubGlobalFavoritesListComponent)
        ).componentInstance as StubGlobalFavoritesListComponent;
        list.openInPlaylistRequested.emit(list.channels()[0]);

        expect(navigate).not.toHaveBeenCalled();
    });
});
