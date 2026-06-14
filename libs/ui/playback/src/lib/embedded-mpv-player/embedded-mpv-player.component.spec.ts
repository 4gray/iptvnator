import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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
            imports: [EmbeddedMpvPlayerHostComponent],
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
                By.css('button[aria-label="Back 10 seconds"]')
            ).nativeElement.disabled
        ).toBe(true);
        expect(
            fixture.debugElement.query(
                By.css('button[aria-label="Forward 10 seconds"]')
            ).nativeElement.disabled
        ).toBe(true);
        expect(
            fixture.debugElement.query(By.css('.embedded-mpv-player__slider'))
                .nativeElement.disabled
        ).toBe(true);
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
