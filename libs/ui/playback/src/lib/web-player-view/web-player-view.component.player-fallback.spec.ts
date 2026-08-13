import { Component, input, output, signal } from '@angular/core';
import {
    ComponentFixture,
    DeferBlockBehavior,
    TestBed,
} from '@angular/core/testing';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { EMPTY } from 'rxjs';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';

jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({
    selector: 'app-vjs-player',
    template: '<div data-test-id="stub-vjs"></div>',
})
class StubVjsPlayerComponent {
    readonly options = input.required<unknown>();
    readonly volume = input(1);
    readonly timeUpdate = output<unknown>();
}

@Component({
    selector: 'app-html-video-player',
    template: '<div data-test-id="stub-html5"></div>',
})
class StubHtmlVideoPlayerComponent {
    readonly channel = input.required<unknown>();
    readonly volume = input(1);
    readonly timeUpdate = output<unknown>();
}

/**
 * The engine is part of the application token, so choosing the wrong one
 * before the settings arrive mounts a second application and swaps the player
 * under the user mid-playback. The persisted settings read is asynchronous;
 * `SettingsStore` holds the same value synchronously.
 */
describe('WebPlayerViewComponent player fallback', () => {
    let WebPlayerViewComponent: typeof WebPlayerViewComponentInstance;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    const storedPlayer = signal<VideoPlayer>(VideoPlayer.Html5Player);

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    const create = async (playerOverride: VideoPlayer | null = null) => {
        await TestBed.configureTestingModule({
            deferBlockBehavior: DeferBlockBehavior.Playthrough,
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                // Never emits: stands in for the IndexedDB read still pending.
                { provide: StorageMap, useValue: { get: () => EMPTY } },
                {
                    provide: SettingsStore,
                    useValue: {
                        player: storedPlayer,
                        showCaptions: signal(false),
                    },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsManagedExternalPlayers: false },
                },
            ],
        })
            .overrideComponent(WebPlayerViewComponent, {
                set: {
                    imports: [
                        StubVjsPlayerComponent,
                        StubHtmlVideoPlayerComponent,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(WebPlayerViewComponent);
        fixture.componentRef.setInput('playbackSessionKey', 'live:p1:c1');
        fixture.componentRef.setInput('streamUrl', 'http://host/movie.mkv');
        if (playerOverride !== null) {
            fixture.componentRef.setInput('playerOverride', playerOverride);
        }
        fixture.detectChanges();
    };

    afterEach(() => {
        fixture?.destroy();
        TestBed.resetTestingModule();
    });

    it('uses the store while the persisted settings read is pending', async () => {
        storedPlayer.set(VideoPlayer.Html5Player);
        await create();

        expect(fixture.componentInstance.selectedPlayer()).toBe(
            VideoPlayer.Html5Player
        );
    });

    it('still lets a host override win', async () => {
        storedPlayer.set(VideoPlayer.Html5Player);
        await create(VideoPlayer.ArtPlayer);

        expect(fixture.componentInstance.selectedPlayer()).toBe(
            VideoPlayer.ArtPlayer
        );
    });

    it('falls back to Video.js when the store has no player either', async () => {
        storedPlayer.set(undefined as unknown as VideoPlayer);
        await create();

        expect(fixture.componentInstance.selectedPlayer()).toBe(
            VideoPlayer.VideoJs
        );
    });
});
