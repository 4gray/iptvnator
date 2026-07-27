import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import type {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
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

describe('EmbeddedMpvPlayerComponent shared controls interactions', () => {
    const fixtures: ComponentFixture<EmbeddedMpvPlayerComponent>[] = [];
    let requestFullscreen: jest.Mock;
    let requestFullscreenDescriptor: PropertyDescriptor | undefined;
    let exitFullscreenDescriptor: PropertyDescriptor | undefined;

    beforeEach(async () => {
        localStorage.removeItem('volume');
        overlayActive.set(false);
        requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(
            HTMLElement.prototype,
            'requestFullscreen'
        );
        exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'exitFullscreen'
        );
        requestFullscreen = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
            configurable: true,
            writable: true,
            value: requestFullscreen,
        });
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            writable: true,
            value: jest.fn().mockResolvedValue(undefined),
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
            HTMLElement.prototype,
            'requestFullscreen',
            requestFullscreenDescriptor
        );
        restoreProperty(document, 'exitFullscreen', exitFullscreenDescriptor);
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

    function render(showControls = true) {
        const fixture = TestBed.createComponent(EmbeddedMpvPlayerComponent);
        fixtures.push(fixture);
        fixture.componentRef.setInput('playback', PLAYBACK);
        fixture.componentRef.setInput('showControls', showControls);
        const controller = fixture.debugElement.injector.get(
            EmbeddedMpvSessionController
        );
        controller.support.set({
            supported: true,
            platform: 'darwin',
            engine: 'frame-copy',
            capabilities: {
                subtitles: true,
                playbackSpeed: true,
                aspectOverride: true,
                screenshot: true,
                recording: true,
            },
        });
        controller.session.set({ ...READY_SESSION });
        fixture.detectChanges();
        fixture.detectChanges();
        return { fixture, controller };
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

    function pressKey(key: string): KeyboardEvent {
        const event = new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(event);
        return event;
    }

    it('toggles pause exactly once after the shared click grace period', () => {
        const { fixture, controller } = render();
        jest.useFakeTimers();
        const togglePaused = jest
            .spyOn(controller, 'togglePaused')
            .mockResolvedValue(undefined);

        canvas(fixture).dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        jest.advanceTimersByTime(249);
        expect(togglePaused).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);

        expect(togglePaused).toHaveBeenCalledTimes(1);
    });

    it('double-clicks fullscreen exactly once on the player root', () => {
        const { fixture, controller } = render();
        jest.useFakeTimers();
        const togglePaused = jest
            .spyOn(controller, 'togglePaused')
            .mockResolvedValue(undefined);

        canvas(fixture).dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        canvas(fixture).dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true })
        );
        jest.advanceTimersByTime(1000);

        expect(togglePaused).not.toHaveBeenCalled();
        expect(requestFullscreen).toHaveBeenCalledTimes(1);
        expect(requestFullscreen.mock.instances[0]).toBe(root(fixture));
    });

    it('routes a keyboard playback toggle through shared controls once', () => {
        const { controller } = render();
        const togglePaused = jest
            .spyOn(controller, 'togglePaused')
            .mockResolvedValue(undefined);

        const event = pressKey('k');

        expect(event.defaultPrevented).toBe(true);
        expect(togglePaused).toHaveBeenCalledTimes(1);
    });

    it('detaches shared surface and keyboard behavior when controls are hidden', () => {
        const { fixture, controller } = render(false);
        jest.useFakeTimers();
        const togglePaused = jest
            .spyOn(controller, 'togglePaused')
            .mockResolvedValue(undefined);

        canvas(fixture).dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        canvas(fixture).dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true })
        );
        pressKey('k');
        jest.advanceTimersByTime(1000);

        expect(togglePaused).not.toHaveBeenCalled();
        expect(requestFullscreen).not.toHaveBeenCalled();
    });

    it('disables shared keyboard shortcuts while an app overlay is active', () => {
        const { fixture, controller } = render();
        const togglePaused = jest
            .spyOn(controller, 'togglePaused')
            .mockResolvedValue(undefined);
        overlayActive.set(true);
        fixture.detectChanges();

        const event = pressKey('k');

        expect(event.defaultPrevented).toBe(false);
        expect(togglePaused).not.toHaveBeenCalled();
    });

    it('does not let the legacy Escape handler mutate frame-copy menus', () => {
        const { fixture } = render();
        const component = fixture.componentInstance;
        component.menus.open('audio');

        pressKey('Escape');

        expect(component.menus.audioOpen()).toBe(true);
    });
});
