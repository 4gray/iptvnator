import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { ChannelActions } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import {
    DataService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { Channel, Settings, VideoPlayer } from '@iptvnator/shared/interfaces';
import type { VideoPlayerComponent as VideoPlayerComponentInstance } from './video-player.component';
import {
    activeChannel,
    activeChannel$,
    channels,
    channels$,
    channelsPlaylistId,
    dataServiceMock,
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

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

/**
 * Handing a row to the channel player through navigation state (global
 * search, a Movies card, a collection). Kept apart from
 * `video-player.component.spec.ts`, which sits at the spec line budget.
 */
describe('VideoPlayerComponent — channel handoff', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;

    beforeAll(async () => {
        ({ VideoPlayerComponent } = await import('./video-player.component'));
    });

    beforeEach(async () => {
        syncStoreState(null);
        playlistId.set('playlist-1');
        player.set(VideoPlayer.VideoJs);
        showCaptions.set(false);
        stripCountryPrefix.set(false);
        externalSession.set(null);
        storeMock.dispatch.mockClear();
        channelsPlaylistId.set('playlist-1');
        routerMock.currentNavigation.mockReturnValue(null);

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
                        supportsEpg: false,
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
                    imports: [],
                    template:
                        '<ng-template #fullscreenChannelPanel></ng-template>',
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(VideoPlayerComponent);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture?.destroy();
        routerMock.currentNavigation.mockReturnValue(null);
    });

    it('waits for the target playlist’s rows before consuming a handoff', () => {
        // The store still holds the previous playlist's rows, and one of
        // them shares the stream URL the handoff names.
        const handoff = {
            ...sampleChannel,
            id: 'previous-playlist-row',
            url: 'http://localhost/shared-live.m3u8',
        } as Channel;
        routerMock.currentNavigation.mockReturnValue({
            extras: {
                state: {
                    openM3uChannelUrl: handoff.url,
                    openM3uChannelId: 'target-row',
                },
            },
        });
        channelsPlaylistId.set('playlist-0');
        activeChannel.set(null);
        activeChannel$.next(null);
        channels.set([handoff]);
        channels$.next([handoff]);

        fixture.detectChanges();

        expect(storeMock.dispatch).not.toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({ channel: handoff })
        );

        // The target's rows arrive: the handoff opens its own row.
        const target = { ...handoff, id: 'target-row' } as Channel;
        channelsPlaylistId.set('playlist-1');
        channels.set([target]);
        channels$.next([target]);
        fixture.detectChanges();

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({ channel: target })
        );
    });

    const handOver = (rows: Channel[], target: Channel) => {
        routerMock.currentNavigation.mockReturnValue({
            extras: {
                state: {
                    openM3uChannelUrl: target.url,
                    openM3uChannelId: target.id,
                },
            },
        });
        activeChannel.set(null);
        activeChannel$.next(null);
        channels.set(rows);
        channels$.next(rows);
        fixture.detectChanges();
    };

    const film = {
        ...sampleChannel,
        id: 'film-1',
        name: 'Sandline (2019)',
        url: 'http://localhost/movie/u/p/1.mkv',
    } as Channel;

    it('requests playback for a handed-over film that has no row in the live list', () => {
        // MPV/VLC with "open stream on double click" launch only on a
        // playback request, and the split list has no film row to click.
        player.set(VideoPlayer.MPV);

        handOver([sampleChannel, film], film);

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({
                channel: film,
                startPlayback: true,
            })
        );
    });

    it('keeps a handed-over live channel a plain selection', () => {
        player.set(VideoPlayer.MPV);

        handOver([sampleChannel, film], sampleChannel);

        expect(storeMock.dispatch).toHaveBeenCalledWith(
            ChannelActions.setActiveChannel({ channel: sampleChannel })
        );
    });

    it('drops a handoff that names the row already playing', () => {
        // Reload or back/forward: the handoff survives in the history
        // entry while the row it names is already active. It is consumed
        // without a second selection, and the entry keeps its other state.
        const previousState = window.history.state;
        window.history.replaceState(
            {
                openM3uChannelUrl: film.url,
                openM3uChannelId: film.id,
                navigationId: 7,
            },
            ''
        );
        try {
            activeChannel.set(film);
            activeChannel$.next(film);
            channels.set([sampleChannel, film]);
            channels$.next([sampleChannel, film]);
            fixture.detectChanges();

            expect(storeMock.dispatch).not.toHaveBeenCalledWith(
                expect.objectContaining({
                    type: ChannelActions.setActiveChannel.type,
                })
            );
            expect(window.history.state).toEqual({ navigationId: 7 });
        } finally {
            window.history.replaceState(previousState, '');
        }
    });
});
