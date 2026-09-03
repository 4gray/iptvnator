import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import type {
    EmbeddedMpvEngine,
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { PlayerControlsComponent } from '../player-controls/player-controls.component';
import { EmbeddedMpvOverlayVisibilityService } from './embedded-mpv-overlay-visibility.service';
import { EmbeddedMpvPlayerComponent } from './embedded-mpv-player.component';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

const PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.test/movie.mp4',
    title: 'Movie',
    contentInfo: {
        playlistId: 'playlist-1',
        contentXtreamId: 42,
        contentType: 'movie',
    },
};

const READY_SESSION: EmbeddedMpvSession = {
    id: 'session-1',
    title: 'Movie',
    streamUrl: PLAYBACK.streamUrl,
    status: 'playing',
    positionSeconds: 30,
    durationSeconds: 120,
    volume: 1,
    audioTracks: [],
    selectedAudioTrackId: null,
    subtitleTracks: [],
    selectedSubtitleTrackId: null,
    playbackSpeed: 1,
    aspectOverride: 'no',
    recording: { active: false },
    startedAt: '2026-07-16T10:00:00Z',
    updatedAt: '2026-07-16T10:00:00Z',
};

const overlayActive = signal(false);

describe('EmbeddedMpvPlayerComponent shared controls host', () => {
    const fixtures: ComponentFixture<EmbeddedMpvPlayerComponent>[] = [];
    let fullscreenElement: Element | null;
    let fullscreenElementDescriptor: PropertyDescriptor | undefined;

    beforeEach(async () => {
        localStorage.removeItem('volume');
        overlayActive.set(false);
        fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'fullscreenElement'
        );
        fullscreenElement = null;
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });

        await TestBed.configureTestingModule({
            imports: [EmbeddedMpvPlayerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: EmbeddedMpvOverlayVisibilityService,
                    useValue: { overlayActive },
                },
            ],
        }).compileComponents();
    });

    afterEach(() => {
        for (const fixture of fixtures.splice(0)) {
            fixture.destroy();
        }
        restoreProperty(
            document,
            'fullscreenElement',
            fullscreenElementDescriptor
        );
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    function restoreProperty(
        target: object,
        property: PropertyKey,
        descriptor: PropertyDescriptor | undefined
    ): void {
        if (descriptor) {
            Object.defineProperty(target, property, descriptor);
            return;
        }
        Reflect.deleteProperty(target, property);
    }

    function support(engine: EmbeddedMpvEngine) {
        return {
            supported: true,
            platform: 'darwin',
            engine,
            capabilities: {
                subtitles: true,
                playbackSpeed: true,
                aspectOverride: true,
                screenshot: true,
                recording: true,
            },
        } as const;
    }

    function render(
        engine: EmbeddedMpvEngine = 'frame-copy',
        showControls = true
    ) {
        const fixture = TestBed.createComponent(EmbeddedMpvPlayerComponent);
        fixtures.push(fixture);
        fixture.componentRef.setInput('playback', PLAYBACK);
        fixture.componentRef.setInput('showControls', showControls);
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        const component = fixture.componentInstance;
        const controller = fixture.debugElement.injector.get(
            EmbeddedMpvSessionController
        );
        controller.support.set(support(engine));
        controller.session.set({ ...READY_SESSION });
        fixture.detectChanges();
        fixture.detectChanges();
        return { fixture, component, controller };
    }

    function sharedControls(
        fixture: ComponentFixture<EmbeddedMpvPlayerComponent>
    ): PlayerControlsComponent | null {
        return (
            fixture.debugElement.query(By.directive(PlayerControlsComponent))
                ?.componentInstance ?? null
        );
    }

    function root(
        fixture: ComponentFixture<EmbeddedMpvPlayerComponent>
    ): HTMLElement {
        return fixture.debugElement.query(By.css('.embedded-mpv-player'))
            .nativeElement;
    }

    function canvas(
        fixture: ComponentFixture<EmbeddedMpvPlayerComponent>
    ): HTMLCanvasElement {
        return fixture.debugElement.query(By.css('[data-embedded-mpv-frame]'))
            .nativeElement;
    }

    it('renders the frame-copy canvas with shared controls and no legacy dock', () => {
        const { fixture } = render();
        const playerRoot = root(fixture);

        expect(canvas(fixture)).toBeTruthy();
        expect(sharedControls(fixture)).not.toBeNull();
        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__controls'))
        ).toBeNull();
        expect(
            playerRoot.classList.contains(
                'embedded-mpv-player--controls-enabled'
            )
        ).toBe(false);
        expect(
            playerRoot.classList.contains(
                'embedded-mpv-player--controls-visible'
            )
        ).toBe(false);
    });

    it('keeps native playback on the legacy dock without shared controls', () => {
        const { fixture } = render('native');

        expect(sharedControls(fixture)).toBeNull();
        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__controls'))
        ).not.toBeNull();
        expect(
            root(fixture).classList.contains(
                'embedded-mpv-player--controls-enabled'
            )
        ).toBe(true);
    });

    it('preserves the host previous and next episode guards', () => {
        const { fixture, component } = render();
        const controls = sharedControls(fixture);
        const previous = jest.fn();
        const next = jest.fn();
        component.previousEpisodeRequested.subscribe(previous);
        component.nextEpisodeRequested.subscribe(next);

        controls?.previousEpisodeRequested.emit();
        controls?.nextEpisodeRequested.emit();
        expect(previous).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();

        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: false,
            canNext: true,
            autoplayEnabled: true,
        });
        fixture.detectChanges();
        controls?.previousEpisodeRequested.emit();
        controls?.nextEpisodeRequested.emit();

        expect(previous).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('syncs bounds on fullscreen changes without revealing legacy state', () => {
        const { fixture, component, controller } = render();
        const triggerBoundsSync = jest.spyOn(controller, 'triggerBoundsSync');
        component.controlsVisible.set(false);
        fullscreenElement = root(fixture);

        document.dispatchEvent(new Event('fullscreenchange'));

        expect(component.isFullscreen()).toBe(true);
        expect(triggerBoundsSync).toHaveBeenCalledTimes(1);
        expect(component.controlsVisible()).toBe(false);
    });

    it('syncs fullscreen state when shared controls attach after entering fullscreen', () => {
        const { fixture, controller } = render('native');
        fullscreenElement = root(fixture);
        document.dispatchEvent(new Event('fullscreenchange'));

        controller.support.set(support('frame-copy'));
        fixture.detectChanges();

        expect(sharedControls(fixture)?.isFullscreen()).toBe(true);
    });

    it('owns fullscreen on the host-supplied target instead of its own root', async () => {
        const { fixture, component } = render();
        const target = document.createElement('div');
        const requestFullscreen = jest.fn(async () => {
            fullscreenElement = target;
            document.dispatchEvent(new Event('fullscreenchange'));
        });
        (target as HTMLElement & { requestFullscreen: jest.Mock })[
            'requestFullscreen'
        ] = requestFullscreen;
        const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'exitFullscreen'
        );
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: jest.fn(async () => {
                fullscreenElement = null;
                document.dispatchEvent(new Event('fullscreenchange'));
            }),
        });

        try {
            fixture.componentRef.setInput('fullscreenTarget', target);
            fixture.detectChanges();
            expect(sharedControls(fixture)?.fullscreenTarget()).toBe(target);
            expect(component.canFullscreen()).toBe(true);

            await component.toggleFullscreen();

            expect(requestFullscreen).toHaveBeenCalledTimes(1);
            expect(component.isFullscreen()).toBe(true);
            fixture.detectChanges();
            expect(
                root(fixture).classList.contains(
                    'embedded-mpv-player--fullscreen'
                )
            ).toBe(true);

            await component.toggleFullscreen();
            expect(component.isFullscreen()).toBe(false);
        } finally {
            restoreProperty(
                document,
                'exitFullscreen',
                exitFullscreenDescriptor
            );
        }
    });

    it('starts fullscreen when the resolved target is already fullscreen', () => {
        // A player remounted for the next episode mounts inside the host's
        // still-active fullscreen; no fullscreenchange fires for it.
        const target = document.createElement('div');
        fullscreenElement = target;
        const { fixture, component } = render();
        expect(component.isFullscreen()).toBe(false);

        fixture.componentRef.setInput('fullscreenTarget', target);
        fixture.detectChanges();

        expect(component.isFullscreen()).toBe(true);
        expect(sharedControls(fixture)?.isFullscreen()).toBe(true);
    });

    it('never renders both control systems across engine transitions', () => {
        const { fixture, controller } = render();
        jest.useFakeTimers();
        const togglePaused = jest
            .spyOn(controller, 'togglePaused')
            .mockResolvedValue(undefined);
        expect(sharedControls(fixture)).not.toBeNull();

        controller.support.set(support('native'));
        fixture.detectChanges();
        expect(sharedControls(fixture)).toBeNull();
        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__controls'))
        ).not.toBeNull();
        fixture.debugElement
            .query(By.css('.embedded-mpv-player__viewport'))
            .nativeElement.dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            );

        controller.support.set(support('frame-copy'));
        fixture.detectChanges();
        expect(sharedControls(fixture)).not.toBeNull();
        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__controls'))
        ).toBeNull();
        jest.advanceTimersByTime(1000);
        expect(togglePaused).not.toHaveBeenCalled();
    });

    it('clears a native volume-close timer during a frame-copy handoff', () => {
        jest.useFakeTimers();
        const { fixture, component, controller } = render('native');
        component.onVolumeHoverEnter();
        component.onVolumeHoverLeave();

        controller.support.set(support('frame-copy'));
        fixture.detectChanges();
        controller.support.set(support('native'));
        fixture.detectChanges();
        component.menus.open('volume');

        jest.advanceTimersByTime(220);

        expect(component.menus.volumeOpen()).toBe(true);
    });

    it('does not render or revive legacy feedback across a frame-copy handoff', () => {
        jest.useFakeTimers();
        const { fixture, component, controller } = render('native');
        component.feedback.flash('forward_10', '+10s', 5000);
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__feedback'))
        ).not.toBeNull();

        controller.support.set(support('frame-copy'));
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__feedback'))
        ).toBeNull();

        component.feedback.flash('error_outline', 'Late native failure', 5000);
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__feedback'))
        ).toBeNull();

        controller.support.set(support('native'));
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__feedback'))
        ).toBeNull();
    });

    it('leaves legacy pointer and popover state untouched on frame-copy', () => {
        const { fixture, component } = render();
        component.controlsVisible.set(false);
        component.menus.open('audio');

        root(fixture).dispatchEvent(new MouseEvent('pointermove'));
        root(fixture).dispatchEvent(
            new FocusEvent('focusin', { bubbles: true })
        );
        document.dispatchEvent(
            new MouseEvent('pointermove', { clientX: 0, clientY: 0 })
        );
        document.body.dispatchEvent(
            new MouseEvent('pointerdown', { bubbles: true })
        );

        expect(component.controlsVisible()).toBe(false);
        expect(component.menus.audioOpen()).toBe(true);
    });

    it.each(['frame-copy', 'native'] as const)(
        'uses exactly one recording interval for the %s engine',
        (engine) => {
            const { fixture, controller } = render(engine);
            const setInterval = jest.spyOn(window, 'setInterval');

            controller.session.update((session) =>
                session
                    ? {
                          ...session,
                          recording: {
                              active: true,
                              startedAt: new Date().toISOString(),
                          },
                      }
                    : session
            );
            fixture.detectChanges();

            expect(setInterval).toHaveBeenCalledTimes(1);
        }
    );

    it('keeps the component-scoped recording adapter inert for native', () => {
        const { fixture, component, controller } = render('native');
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.test/live.ts',
            title: 'Live news',
            isLive: true,
        });
        fixture.detectChanges();
        const startRecording = jest.spyOn(controller, 'startRecording');

        component.sharedControls.commands.toggleRecording();

        expect(startRecording).not.toHaveBeenCalled();
    });

    it('emits recordingStopped once when an active recording goes inactive', () => {
        const { fixture, component, controller } = render();
        const stopped: Array<{
            targetPath: string;
            startedAt: string | null;
        }> = [];
        component.recordingStopped.subscribe((event) =>
            stopped.push({
                targetPath: event.targetPath,
                startedAt: event.startedAt,
            })
        );

        controller.session.set({
            ...READY_SESSION,
            recording: {
                active: true,
                targetPath: '/rec/news.ts',
                startedAt: '2026-07-16T21:00:00Z',
            },
        });
        fixture.detectChanges();
        expect(stopped).toHaveLength(0);

        // Stopping from the download manager talks to the main process
        // directly, so the only signal this component sees is the snapshot
        // flipping inactive — it must still drive stop enrichment.
        controller.session.set({
            ...READY_SESSION,
            recording: { active: false, targetPath: '/rec/news.ts' },
        });
        fixture.detectChanges();

        expect(stopped).toEqual([
            { targetPath: '/rec/news.ts', startedAt: '2026-07-16T21:00:00Z' },
        ]);

        // Later inactive snapshots are not another stop.
        controller.session.set({
            ...READY_SESSION,
            positionSeconds: 44,
            recording: { active: false, targetPath: '/rec/news.ts' },
        });
        fixture.detectChanges();
        expect(stopped).toHaveLength(1);
    });

    it('carries the recorded channel identity through the stop event', () => {
        const { fixture, component, controller } = render();
        fixture.componentRef.setInput('recordingMetadata', {
            channelName: 'Channel One',
            epgChannelId: 'channel.one',
        });
        const stopped: Array<string | null | undefined> = [];
        component.recordingStopped.subscribe((event) =>
            stopped.push(event.epgChannelId)
        );

        controller.session.set({
            ...READY_SESSION,
            recording: { active: true, targetPath: '/rec/news.ts' },
        });
        fixture.detectChanges();

        // A channel switch auto-stops the recording and moves the host on;
        // the event must still name the channel that was recorded.
        fixture.componentRef.setInput('recordingMetadata', {
            channelName: 'Channel Two',
            epgChannelId: 'channel.two',
        });
        controller.session.set({
            ...READY_SESSION,
            recording: { active: false, targetPath: '/rec/news.ts' },
        });
        fixture.detectChanges();

        expect(stopped).toEqual(['channel.one']);
    });

    it('carries the recorded source-item key through the stop event', () => {
        // The EPG key is not unique for M3U items (shared tvgId or the
        // name fallback): two list entries can share it, so the exact
        // selection identity must survive the switch the same way.
        const { fixture, component, controller } = render();
        fixture.componentRef.setInput('recordingMetadata', {
            channelName: 'News HD',
            epgChannelId: 'news.hd',
            sourceItemKey: 'item-1',
        });
        const stopped: Array<string | null | undefined> = [];
        component.recordingStopped.subscribe((event) =>
            stopped.push(event.sourceItemKey)
        );

        controller.session.set({
            ...READY_SESSION,
            recording: { active: true, targetPath: '/rec/news.ts' },
        });
        fixture.detectChanges();

        // Same EPG key, different list item — the uid must not follow.
        fixture.componentRef.setInput('recordingMetadata', {
            channelName: 'News HD',
            epgChannelId: 'news.hd',
            sourceItemKey: 'item-2',
        });
        controller.session.set({
            ...READY_SESSION,
            recording: { active: false, targetPath: '/rec/news.ts' },
        });
        fixture.detectChanges();

        expect(stopped).toEqual(['item-1']);
    });

    it('does not emit recordingStopped without a preceding active recording', () => {
        const { fixture, component, controller } = render();
        const stopped: unknown[] = [];
        component.recordingStopped.subscribe((event) => stopped.push(event));

        controller.session.set({
            ...READY_SESSION,
            recording: { active: false, targetPath: '/rec/stale.ts' },
        });
        fixture.detectChanges();

        expect(stopped).toHaveLength(0);
    });
});
