import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import { EpgService } from '@iptvnator/epg/data-access';
import { selectActivePlaylist } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import {
    DataService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SettingsStore,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import {
    PlaylistMeta,
    Settings,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import type { VideoPlayerComponent as VideoPlayerComponentInstance } from './video-player.component';
import {
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
 * When a selected M3U channel becomes a recently viewed item (and with it
 * the dashboard hero). Kept apart from `video-player.component.spec.ts`,
 * which sits at the spec line budget; the template is reduced to nothing,
 * because the players themselves are stood in for by the history gate.
 */
describe('VideoPlayerComponent — recently viewed history', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;
    let component: VideoPlayerComponentInstance;
    let gate: PlaybackHistoryGate;
    const activePlaylist = signal<Partial<PlaylistMeta> | null>(null);
    const harnessSelectSignal = storeMock.selectSignal.getMockImplementation()!;

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
        activePlaylist.set({ _id: 'playlist-1', recentlyViewed: [] });
        // The harness has no playlist meta; the history write updates it.
        storeMock.selectSignal.mockImplementation(((selector: unknown) =>
            selector === selectActivePlaylist
                ? activePlaylist
                : harnessSelectSignal(selector)) as typeof harnessSelectSignal);
        playlistsServiceMock.addM3uRecentlyViewed.mockClear();

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
                            data: { layout: 'workspace' },
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

        gate = TestBed.inject(PlaybackHistoryGate);
        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture?.destroy();
        storeMock.selectSignal.mockImplementation(harnessSelectSignal);
    });

    function select(channel = sampleChannel): void {
        syncStoreState(channel);
        fixture.detectChanges();
    }

    it('records an inline channel only once the player confirms it plays', () => {
        select();

        // Selected, but the stream has not played yet (or failed at once).
        expect(
            playlistsServiceMock.addM3uRecentlyViewed
        ).not.toHaveBeenCalled();

        gate.confirm({ sessionKey: component.playbackSessionKey() });

        expect(playlistsServiceMock.addM3uRecentlyViewed).toHaveBeenCalledWith(
            'playlist-1',
            expect.objectContaining({
                source: 'm3u',
                url: sampleChannel.url,
                title: 'Sample TV',
            })
        );
    });

    it('keeps the playing source when recording updates the playlist', () => {
        select();
        const playback = component.embeddedPlayback();
        expect(playback).not.toBeNull();

        // What the confirmed write dispatches back into the store.
        activePlaylist.set({
            _id: 'playlist-1',
            recentlyViewed: [{ source: 'm3u', id: sampleChannel.url } as never],
        });
        fixture.detectChanges();

        // A new source object would remount the engine and restart the
        // stream right after its first two seconds.
        expect(component.embeddedPlayback()).toBe(playback);
    });

    it('never records a channel whose stream did not play', () => {
        select();
        select({
            ...sampleChannel,
            id: 'channel-2',
            url: 'http://localhost/second.m3u8',
            name: 'Second TV',
        });

        gate.confirm({
            sessionKey: component.playbackSessionKey(),
            streamUrls: ['http://localhost/second.m3u8'],
        });

        expect(playlistsServiceMock.addM3uRecentlyViewed).toHaveBeenCalledTimes(
            1
        );
        expect(playlistsServiceMock.addM3uRecentlyViewed).toHaveBeenCalledWith(
            'playlist-1',
            expect.objectContaining({ title: 'Second TV' })
        );
    });

    it('records a second row of the same URL that plays after the first failed', () => {
        // One stream listed twice in a playlist, under two channel ids.
        select();
        select({
            ...sampleChannel,
            id: 'channel-1-copy',
            name: 'Sample TV HD',
        });

        gate.confirm({
            sessionKey: component.playbackSessionKey(),
            streamUrls: [sampleChannel.url],
        });

        expect(playlistsServiceMock.addM3uRecentlyViewed).toHaveBeenCalledWith(
            'playlist-1',
            expect.objectContaining({ title: 'Sample TV HD' })
        );
    });

    it('records a radio station once the audio player confirms it', () => {
        const radio = { ...sampleChannel, radio: 'true' };
        select(radio);

        expect(
            playlistsServiceMock.addM3uRecentlyViewed
        ).not.toHaveBeenCalled();

        // The same URL opened elsewhere (MPV/VLC, another playlist) does not.
        gate.confirm({ streamUrls: [radio.url] });
        expect(
            playlistsServiceMock.addM3uRecentlyViewed
        ).not.toHaveBeenCalled();

        gate.confirm({
            sessionKey: component.playbackSessionKey(),
            streamUrls: [radio.url],
        });

        expect(playlistsServiceMock.addM3uRecentlyViewed).toHaveBeenCalledTimes(
            1
        );
    });

    it('records on selection with an external player, which cannot confirm', () => {
        player.set(VideoPlayer.MPV);
        fixture.detectChanges();

        select();

        expect(playlistsServiceMock.addM3uRecentlyViewed).toHaveBeenCalledTimes(
            1
        );
    });
});
