import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
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
import { Settings, VideoPlayer } from '@iptvnator/shared/interfaces';
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
 * What may NOT open the programme guide. The guide mounts in the page flow,
 * so a fullscreen element or a dialog paints over it while it still owns the
 * keyboard. Kept apart from `video-player.component.spec.ts`, which sits at
 * the spec line budget; the template is reduced to the panel's `ng-template`
 * so no child stubs are needed.
 */
describe('VideoPlayerComponent — guide gating', () => {
    let VideoPlayerComponent: typeof import('./video-player.component').VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponentInstance>;
    let component: VideoPlayerComponentInstance;

    function setFullscreenElement(element: Element | null): void {
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => element,
        });
    }

    /** A stand-in for the inline live player, inside the component's host. */
    function mountPlayerView(): HTMLElement {
        const playerView = document.createElement('app-web-player-view');
        fixture.nativeElement.appendChild(playerView);
        return playerView;
    }

    function pressGuideKey(target: EventTarget = document): void {
        target.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'g', bubbles: true })
        );
    }

    beforeAll(async () => {
        ({ VideoPlayerComponent } = await import('./video-player.component'));
    });

    beforeEach(async () => {
        setFullscreenElement(null);
        syncStoreState(sampleChannel);
        playlistId.set('playlist-1');
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
                    imports: [],
                    template:
                        '<ng-template #fullscreenChannelPanel></ng-template>',
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture?.destroy();
        setFullscreenElement(null);
        document
            .querySelectorAll('.cdk-overlay-container, [role="dialog"]')
            .forEach((element) => element.remove());
    });

    it('leaves the guide closed while the live player owns fullscreen', () => {
        expect(component.canOpenGuide()).toBe(true);
        setFullscreenElement(mountPlayerView());

        pressGuideKey();

        // The fullscreen surface paints over the page: the guide would be
        // invisible there and still swallow the keys.
        expect(component.guideOpen()).toBe(false);
        component.openGuide();
        expect(component.guideOpen()).toBe(false);

        setFullscreenElement(null);
        pressGuideKey();
        expect(component.guideOpen()).toBe(true);
    });

    it('leaves the guide closed while any element is fullscreen', () => {
        const other = document.createElement('div');
        document.body.appendChild(other);
        setFullscreenElement(other);

        component.openGuide();

        expect(component.guideOpen()).toBe(false);
        other.remove();
    });

    it('leaves the guide closed while a dialog is open', () => {
        const overlayContainer = document.createElement('div');
        overlayContainer.className = 'cdk-overlay-container';
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        const dialogButton = document.createElement('button');
        dialog.appendChild(dialogButton);
        overlayContainer.appendChild(dialog);
        document.body.appendChild(overlayContainer);

        // The header action and the command palette go through `openGuide()`
        // without an event to inspect.
        component.openGuide();
        expect(component.guideOpen()).toBe(false);

        // A G from a focused control inside the dialog belongs to the dialog.
        pressGuideKey(dialogButton);
        expect(component.guideOpen()).toBe(false);

        overlayContainer.remove();
        pressGuideKey();
        expect(component.guideOpen()).toBe(true);
    });
});
