import { AsyncPipe } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { of } from 'rxjs';
import { By } from '@angular/platform-browser';
import { EpgService } from '@iptvnator/epg/data-access';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import {
    DataService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import {
    EpgProgram,
    PlaylistMeta,
    Settings,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { VideoPlayerComponent as VideoPlayerComponentInstance } from './video-player.component';
import {
    activePlaylistMeta,
    activeEpgProgram,
    activePlaybackUrl,
    dataServiceMock,
    epgPrograms$,
    epgServiceMock,
    epgUrlSetting,
    epgViewMode,
    externalSession,
    player,
    playlistId,
    playlistsServiceMock,
    routerMock,
    sampleChannel,
    showCaptions,
    storeMock,
    stripCountryPrefix,
    syncStoreState,
    translateServiceProvider,
} from './video-player.spec-harness';
import {
    StubAudioPlayerComponent,
    StubChannelListLoadingStateComponent,
    StubEpgGuideComponent,
    StubEpgGuideNowPlayingComponent,
    StubEpgTimelineComponent,
    StubPortalEmptyStateComponent,
    StubResizableDirective,
    StubSidebarComponent,
    StubWebPlayerViewComponent,
} from './video-player.spec-stubs';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

const HOUR = 3600;
const T0 = 1_775_386_800; // 2026-04-05T11:00:00Z

function programme(title: string, fromHour: number, toHour: number) {
    const start = T0 + fromHour * HOUR;
    const stop = T0 + toHour * HOUR;
    return {
        channel: 'sample-tvg-id',
        start: new Date(start * 1000).toISOString(),
        stop: new Date(stop * 1000).toISOString(),
        title,
        desc: null,
        category: null,
        startTimestamp: start,
        stopTimestamp: stop,
    } satisfies EpgProgram;
}

/**
 * Catch-up programmes on the seek bar, read from the `app-web-player-view`
 * the real template binds. Kept apart from `video-player.component.spec.ts`,
 * which sits at the spec line budget.
 */
describe('VideoPlayerComponent — catch-up timeline segments', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;

    beforeAll(async () => {
        ({ VideoPlayerComponent } = await import('./video-player.component'));
    });

    beforeEach(async () => {
        syncStoreState(sampleChannel);
        activePlaybackUrl.set(null);
        activeEpgProgram.set(null);
        epgPrograms$.next([]);
        playlistId.set('playlist-1');
        activePlaylistMeta.set(null);
        epgServiceMock.loadChannelProgramsForWindow.mockClear();
        epgServiceMock.getChannelProgramsForProviderWindow
            .mockReset()
            .mockResolvedValue([]);
        epgServiceMock.sourceRevision.set(0);
        player.set(VideoPlayer.VideoJs);
        showCaptions.set(false);
        stripCountryPrefix.set(false);
        externalSession.set(null);
        storeMock.dispatch.mockClear();

        await TestBed.configureTestingModule({
            imports: [VideoPlayerComponent],
            schemas: [NO_ERRORS_SCHEMA],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        params: of({ id: playlistId(), view: 'all' }),
                        queryParams: of({}),
                        snapshot: {
                            queryParams: {},
                        },
                    },
                },
                { provide: Router, useValue: routerMock },
                { provide: Store, useValue: storeMock },
                translateServiceProvider,
                { provide: DataService, useValue: dataServiceMock },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        supportsEpg: true,
                        isElectron: false,
                        supportsRemoteControl: false,
                    },
                },
                { provide: PlaylistsService, useValue: playlistsServiceMock },
                { provide: EpgService, useValue: epgServiceMock },
                {
                    provide: PlaylistContextFacade,
                    useValue: { resolvedPlaylistId: playlistId },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { isEnabled: () => false },
                },
                {
                    provide: SettingsStore,
                    useValue: {
                        player,
                        showCaptions,
                        stripCountryPrefix,
                        m3uVodDetails: signal(true),
                        resolvedEpgViewMode: epgViewMode,
                        resolvedEpgOffsetMinutes: signal(0),
                        epgUrl: epgUrlSetting,
                    },
                },
                {
                    provide: StorageMap,
                    useValue: {
                        get: jest.fn(() =>
                            of({ player: player() } as Partial<Settings>)
                        ),
                    },
                },
                {
                    provide: PORTAL_EXTERNAL_PLAYBACK,
                    useValue: { activeSession: externalSession },
                },
            ],
        })
            .overrideComponent(VideoPlayerComponent, {
                set: {
                    imports: [
                        AsyncPipe,
                        StubAudioPlayerComponent,
                        StubChannelListLoadingStateComponent,
                        StubEpgGuideComponent,
                        StubEpgGuideNowPlayingComponent,
                        StubEpgTimelineComponent,
                        StubPortalEmptyStateComponent,
                        StubResizableDirective,
                        StubSidebarComponent,
                        StubWebPlayerViewComponent,
                        MockPipe(
                            TranslatePipe,
                            (value: string | null | undefined) => value ?? ''
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(VideoPlayerComponent);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture?.destroy();
    });

    const forwarded = () => {
        fixture.detectChanges();
        return (
            fixture.debugElement.query(By.directive(StubWebPlayerViewComponent))
                .componentInstance as StubWebPlayerViewComponent
        ).timelineSegments();
    };

    it('requests the selected local day and refreshes when its effective sources change', () => {
        activePlaylistMeta.set({
            epgUrls: ['https://guide.example/a.xml'],
            disabledEpgUrls: ['https://guide.example/disabled.xml'],
        } as PlaylistMeta);
        fixture.componentInstance.onLiveEpgSelectedDateChange('2026-10-25');
        fixture.detectChanges();
        expect(
            epgServiceMock.loadChannelProgramsForWindow
        ).toHaveBeenLastCalledWith(
            'sample-tvg-id',
            new Date('2026-10-25T00:00:00').getTime(),
            new Date('2026-10-26T00:00:00').getTime(),
            ['https://guide.example/a.xml'],
            expect.anything()
        );

        activePlaylistMeta.set({
            epgUrls: ['https://guide.example/b.xml'],
        } as PlaylistMeta);
        fixture.detectChanges();
        expect(
            epgServiceMock.loadChannelProgramsForWindow
        ).toHaveBeenLastCalledWith(
            'sample-tvg-id',
            expect.any(Number),
            expect.any(Number),
            ['https://guide.example/b.xml'],
            expect.anything()
        );

        epgServiceMock.sourceRevision.set(1);
        fixture.detectChanges();
        expect(
            epgServiceMock.loadChannelProgramsForWindow
        ).toHaveBeenCalledTimes(4);

        syncStoreState({
            ...sampleChannel,
            tvg: { ...sampleChannel.tvg, id: 'another-channel' },
        });
        fixture.detectChanges();
        expect(
            epgServiceMock.loadChannelProgramsForWindow
        ).toHaveBeenLastCalledWith(
            'another-channel',
            expect.any(Number),
            expect.any(Number),
            ['https://guide.example/b.xml'],
            expect.anything()
        );
    });

    it('draws nothing during live playback', () => {
        epgPrograms$.next([programme('Picked', 0, 1)]);
        activeEpgProgram.set(programme('Picked', 0, 1));

        expect(forwarded()).toBeNull();
    });

    it('spans the programmes from utc up to the lutc of the archive URL', () => {
        epgPrograms$.next([
            programme('Before', -1, 0),
            programme('Picked', 0, 1),
            programme('Next', 1, 2),
            programme('Later', 2, 3),
        ]);
        activeEpgProgram.set(programme('Picked', 0, 1));
        activePlaybackUrl.set(
            `http://localhost/archive.m3u8?utc=${T0}&lutc=${T0 + 1.5 * HOUR}`
        );

        expect(forwarded()).toEqual([
            { startSeconds: 0, endSeconds: HOUR, title: 'Picked' },
            { startSeconds: HOUR, endSeconds: 1.5 * HOUR, title: 'Next' },
        ]);

        activePlaybackUrl.set(null);
        expect(forwarded()).toBeNull();
    });

    it('falls back to the programme when the URL carries no lutc', () => {
        epgPrograms$.next([programme('Picked', 0, 1), programme('Next', 1, 2)]);
        activeEpgProgram.set(programme('Picked', 0, 1));
        activePlaybackUrl.set('http://localhost/archive.m3u8');

        expect(forwarded()).toEqual([
            { startSeconds: 0, endSeconds: HOUR, title: 'Picked' },
        ]);
    });

    it('loads intervening archive programmes outside the selected mini-guide day', async () => {
        const picked = programme('Picked', 0, 1);
        const middle = programme('Middle day', 24, 25);
        epgPrograms$.next([picked]);
        epgServiceMock.getChannelProgramsForProviderWindow.mockResolvedValue([
            middle,
        ]);
        activeEpgProgram.set(picked);
        activePlaybackUrl.set(
            `http://localhost/archive.m3u8?utc=${T0}&lutc=${T0 + 26 * HOUR}`
        );
        fixture.detectChanges();
        await Promise.resolve();
        fixture.detectChanges();

        expect(
            epgServiceMock.getChannelProgramsForProviderWindow
        ).toHaveBeenCalledWith(
            'sample-tvg-id',
            T0 * 1000,
            (T0 + 26 * HOUR) * 1000,
            []
        );
        expect(forwarded()).toContainEqual({
            startSeconds: 24 * HOUR,
            endSeconds: 25 * HOUR,
            title: 'Middle day',
        });
    });
});
