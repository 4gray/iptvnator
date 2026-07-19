import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { EmbeddedMpvOverlayVisibilityService } from './embedded-mpv-overlay-visibility.service';
import { EmbeddedMpvPlayerComponent } from './embedded-mpv-player.component';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

@Component({
    imports: [EmbeddedMpvPlayerComponent],
    template: `
        <app-embedded-mpv-player
            [playback]="playback"
            [seriesNavigation]="seriesNavigation"
            (playbackEnded)="endedCount = endedCount + 1"
            (previousEpisodeRequested)="previousCount = previousCount + 1"
            (nextEpisodeRequested)="nextCount = nextCount + 1"
        />
    `,
})
class EmbeddedMpvPlayerHostComponent {
    playback: ResolvedPortalPlayback = {
        streamUrl: 'https://example.test/series/1002.mp4',
        title: 'Episode 2',
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: 1002,
            contentType: 'episode',
        },
    };

    seriesNavigation = {
        canPrevious: true,
        canNext: false,
        autoplayEnabled: true,
    };

    endedCount = 0;
    previousCount = 0;
    nextCount = 0;
}

describe('EmbeddedMpvPlayerComponent series navigation', () => {
    let fixture: ComponentFixture<EmbeddedMpvPlayerHostComponent>;
    let player: EmbeddedMpvPlayerComponent;
    let controller: EmbeddedMpvSessionController;

    const configureReadyController = (
        sessionOverrides: Partial<EmbeddedMpvSession> = {}
    ) => {
        controller.support.set({
            supported: true,
            platform: 'darwin',
            engine: 'native',
            capabilities: {
                subtitles: false,
                playbackSpeed: false,
                aspectOverride: false,
                screenshot: false,
                recording: false,
            },
        });
        controller.session.set({
            id: 'session-1',
            title: 'Episode 2',
            streamUrl: 'https://example.test/series/1002.mp4',
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
            startedAt: '2026-06-06T12:00:00Z',
            updatedAt: '2026-06-06T12:00:00Z',
            ...sessionOverrides,
        });
        fixture.detectChanges();
    };

    const bindPlayer = () => {
        const playerDebugElement = fixture.debugElement.query(
            By.directive(EmbeddedMpvPlayerComponent)
        );
        player = playerDebugElement.componentInstance;
        controller = playerDebugElement.injector.get(
            EmbeddedMpvSessionController
        );
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                EmbeddedMpvPlayerHostComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: EmbeddedMpvOverlayVisibilityService,
                    useValue: { overlayActive: signal(false) },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(EmbeddedMpvPlayerHostComponent);
        fixture.detectChanges();
        bindPlayer();
        configureReadyController();
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('renders previous and next episode controls with season boundary disabled state', () => {
        const previousButton = fixture.debugElement.query(
            By.css('[data-test-id="embedded-mpv-previous-episode"]')
        );
        const nextButton = fixture.debugElement.query(
            By.css('[data-test-id="embedded-mpv-next-episode"]')
        );

        expect(previousButton).not.toBeNull();
        expect(previousButton.nativeElement.disabled).toBe(false);
        expect(nextButton).not.toBeNull();
        expect(nextButton.nativeElement.disabled).toBe(true);

        previousButton.nativeElement.click();
        nextButton.nativeElement.click();

        expect(fixture.componentInstance.previousCount).toBe(1);
        expect(fixture.componentInstance.nextCount).toBe(0);
    });

    it('emits playbackEnded exactly once for an ended session snapshot', () => {
        controller.session.update((session) =>
            session
                ? {
                      ...session,
                      status: 'ended',
                      positionSeconds: 120,
                      updatedAt: '2026-06-06T12:02:00Z',
                  }
                : session
        );
        fixture.detectChanges();
        controller.session.update((session) =>
            session
                ? {
                      ...session,
                      updatedAt: '2026-06-06T12:02:01Z',
                  }
                : session
        );
        fixture.detectChanges();

        expect(fixture.componentInstance.endedCount).toBe(1);
        expect(player.isPlaying()).toBe(false);
    });

    it('hides episode navigation for live playback', () => {
        fixture.destroy();
        fixture = TestBed.createComponent(EmbeddedMpvPlayerHostComponent);
        fixture.componentInstance.playback = {
            streamUrl: 'https://example.test/live/zdf-hd.ts',
            title: 'ZDF HD',
            isLive: true,
        };
        fixture.detectChanges();
        bindPlayer();
        configureReadyController({
            streamUrl: 'https://example.test/live/zdf-hd.ts',
            title: 'ZDF HD',
            durationSeconds: 120,
        });

        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="embedded-mpv-previous-episode"]')
            )
        ).toBeNull();
        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="embedded-mpv-next-episode"]')
            )
        ).toBeNull();
        expect(
            fixture.debugElement.query(
                By.css('.embedded-mpv-player__live-badge')
            )
        ).not.toBeNull();
        expect(
            fixture.debugElement.query(
                By.css(
                    'button[aria-label="EMBEDDED_MPV.PLAYER.BACK_10_SECONDS"]'
                )
            ).nativeElement.disabled
        ).toBe(true);
        expect(
            fixture.debugElement.query(
                By.css(
                    'button[aria-label="EMBEDDED_MPV.PLAYER.FORWARD_10_SECONDS"]'
                )
            ).nativeElement.disabled
        ).toBe(true);
        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__slider'))
                .nativeElement.disabled
        ).toBe(true);
    });

    it('re-evaluates instant()-based labels when the language changes', () => {
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            EMBEDDED_MPV: { PLAYER: { ENTER_FULLSCREEN: 'Enter fullscreen' } },
        });
        translate.use('en');
        expect(player.fullscreenLabel()).toBe('Enter fullscreen');

        translate.setTranslation('de', {
            EMBEDDED_MPV: { PLAYER: { ENTER_FULLSCREEN: 'Vollbild starten' } },
        });
        translate.use('de');

        // translate.instant() is invisible to the signal graph; the
        // translationsTick dependency must invalidate the computed.
        expect(player.fullscreenLabel()).toBe('Vollbild starten');
    });

    describe('timeline scrubbing', () => {
        const slider = () =>
            fixture.debugElement.query(By.css('.embedded-mpv-player__slider'))
                .nativeElement as HTMLInputElement;

        const dispatch = (type: string, value: string) => {
            slider().value = value;
            slider().dispatchEvent(new Event(type, { bubbles: true }));
            fixture.detectChanges();
        };

        it('previews the drag position locally without firing seeks', () => {
            const seekTo = jest
                .spyOn(controller, 'seekTo')
                .mockResolvedValue(undefined);

            dispatch('input', '55');
            dispatch('input', '60');

            expect(seekTo).not.toHaveBeenCalled();
            expect(player.timelineValue()).toBe(60);
            expect(fixture.nativeElement.textContent).toContain('01:00');
        });

        it('commits a single seek on release and returns to session position', () => {
            const seekTo = jest
                .spyOn(controller, 'seekTo')
                .mockResolvedValue(undefined);

            dispatch('input', '60');
            dispatch('change', '60');

            expect(seekTo).toHaveBeenCalledTimes(1);
            expect(seekTo).toHaveBeenCalledWith(60);
            expect(player.scrubPosition()).toBeNull();
            // Back to the session-reported position once the scrub ends.
            expect(player.timelineValue()).toBe(30);
        });
    });

    describe('viewport click-to-pause', () => {
        const clickViewport = () => {
            fixture.debugElement
                .query(By.css('.embedded-mpv-player__viewport'))
                .nativeElement.dispatchEvent(
                    new MouseEvent('click', { bubbles: true })
                );
        };

        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('toggles pause after the double-click grace period', () => {
            const togglePaused = jest
                .spyOn(controller, 'togglePaused')
                .mockResolvedValue(undefined);

            clickViewport();
            expect(togglePaused).not.toHaveBeenCalled();

            jest.advanceTimersByTime(300);
            expect(togglePaused).toHaveBeenCalledTimes(1);
        });

        it('does not pause when the click turns into a double-click (fullscreen)', () => {
            const togglePaused = jest
                .spyOn(controller, 'togglePaused')
                .mockResolvedValue(undefined);

            clickViewport();
            fixture.debugElement
                .query(By.css('.embedded-mpv-player__viewport'))
                .nativeElement.dispatchEvent(
                    new MouseEvent('dblclick', { bubbles: true })
                );

            jest.advanceTimersByTime(300);
            expect(togglePaused).not.toHaveBeenCalled();
        });

        it('closes an open popover instead of pausing', () => {
            const togglePaused = jest
                .spyOn(controller, 'togglePaused')
                .mockResolvedValue(undefined);
            player.menus.open('audio');

            clickViewport();
            jest.advanceTimersByTime(300);

            expect(player.menus.anyOpen()).toBe(false);
            expect(togglePaused).not.toHaveBeenCalled();
        });

        it('ignores clicks while the session is loading', () => {
            const togglePaused = jest
                .spyOn(controller, 'togglePaused')
                .mockResolvedValue(undefined);
            controller.session.update((session) =>
                session ? { ...session, status: 'loading' } : session
            );
            fixture.detectChanges();

            clickViewport();
            jest.advanceTimersByTime(300);

            expect(togglePaused).not.toHaveBeenCalled();
        });
    });

    it('does not label VOD or episode playback as live while duration is loading', () => {
        controller.session.update((session) =>
            session
                ? {
                      ...session,
                      durationSeconds: null,
                  }
                : session
        );
        fixture.detectChanges();

        expect(
            fixture.debugElement.query(
                By.css('.embedded-mpv-player__live-badge')
            )
        ).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('--:--');
    });
});
