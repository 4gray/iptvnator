import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    MultiviewEntryService,
    MultiviewSessionStore,
    type MultiviewTileSource,
} from '@iptvnator/playback/multiview/data-access';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { PortalInlinePlayerComponent as PortalInlinePlayerInstance } from './portal-inline-player.component';

jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({
    selector: 'app-web-player-view',
    template: '<div data-test-id="stub-web-player-view"></div>',
})
class StubWebPlayerViewComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly streamUrl = input.required<string>();
    readonly title = input('');
    readonly mediaTitle = input<unknown>(null);
    readonly upNext = input<unknown>(null);
    readonly playback = input<unknown>(null);
    readonly volume = input(1);
    readonly playerOverride = input<unknown>(null);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly alternativeSources = input<unknown[]>([]);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly externalFallbackRequested = output<unknown>();
    readonly alternativeSourceRequested = output<string>();
    readonly sourceCheckRequested = output<string>();
    readonly playbackFailed = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

const OTHER: MultiviewTileSource = {
    playback: {
        streamUrl: 'https://stream.example/live/sport.m3u8',
        title: 'Synthetic Sport',
        isLive: true,
    },
    playbackSessionKey: 'live|playlist-1|202',
    kind: 'live',
    playlistId: 'playlist-1',
    title: 'Synthetic Sport',
};

describe('PortalInlinePlayerComponent multiview anchor', () => {
    let PortalInlinePlayerComponent: typeof import('./portal-inline-player.component').PortalInlinePlayerComponent;
    let WebPlayerViewComponent: typeof import('../web-player-view/web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<PortalInlinePlayerInstance>;
    let component: PortalInlinePlayerInstance;

    beforeAll(async () => {
        ({ PortalInlinePlayerComponent } =
            await import('./portal-inline-player.component'));
        ({ WebPlayerViewComponent } =
            await import('../web-player-view/web-player-view.component'));
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PortalInlinePlayerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { player: signal(VideoPlayer.ArtPlayer) },
                },
            ],
        })
            .overrideComponent(PortalInlinePlayerComponent, {
                remove: { imports: [WebPlayerViewComponent] },
                add: { imports: [StubWebPlayerViewComponent] },
            })
            .compileComponents();

        fixture = TestBed.createComponent(PortalInlinePlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('playbackSessionKey', 'vod|playlist-1|7');
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://stream.example/movie/7.mp4',
            title: 'Synthetic Movie',
            startTime: 30,
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 7,
                contentType: 'vod',
            },
        });
        fixture.detectChanges();
    });

    afterEach(() => fixture?.destroy());

    const inlinePlayer = (): HTMLElement | null =>
        fixture.nativeElement.querySelector('app-web-player-view');
    const placeholder = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="multiview-anchor-placeholder"]'
        );

    function startSession(): void {
        TestBed.inject(MultiviewEntryService).add(OTHER);
        fixture.detectChanges();
    }

    it('describes the movie it plays and renders the player as before', () => {
        expect(inlinePlayer()).not.toBeNull();
        expect(placeholder()).toBeNull();
        expect(component.multiviewAnchor.host.source()).toMatchObject({
            playbackSessionKey: 'vod|playlist-1|7',
            kind: 'vod',
            playlistId: 'playlist-1',
            title: 'Synthetic Movie',
        });
        expect(component.multiviewAnchor.host.engine()).toBe(
            VideoPlayer.ArtPlayer
        );
    });

    it('describes an episode as an episode', () => {
        fixture.componentRef.setInput('episodeMetadata', {
            label: 'S01E02',
            title: 'Episode 2',
            seasonNumber: 1,
            episodeNumber: 2,
        });

        expect(component.multiviewAnchor.host.source()?.kind).toBe('episode');
    });

    it('hands the movie to tile 1 and shows the placeholder', () => {
        startSession();
        const store = TestBed.inject(MultiviewSessionStore);

        expect(store.anchorId()).toBe('portal-inline-player');
        expect(store.tiles()[0]).toMatchObject({
            playbackSessionKey: 'vod|playlist-1|7',
            engine: VideoPlayer.ArtPlayer,
        });
        expect(inlinePlayer()).toBeNull();
        expect(placeholder()).not.toBeNull();
    });

    it('keeps saving tile 1 progress through the page (R9)', () => {
        const progress: number[] = [];
        component.timeUpdate.subscribe((event) =>
            progress.push(event.currentTime)
        );
        startSession();

        TestBed.inject(MultiviewSessionStore)
            .tiles()[0]
            .persistPosition?.({ currentTime: 95, duration: 5400 });

        expect(progress).toEqual([95]);
    });

    it('ends the session when the player is closed', () => {
        startSession();

        fixture.destroy();

        expect(TestBed.inject(MultiviewSessionStore).exists()).toBe(false);
    });
});
