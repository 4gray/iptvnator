import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { EmbeddedMpvOverlayVisibilityService } from './embedded-mpv-overlay-visibility.service';
import { EmbeddedMpvPlayerComponent } from './embedded-mpv-player.component';
import { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';
import { signal } from '@angular/core';

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
    readonly playback: ResolvedPortalPlayback = {
        streamUrl: 'https://example.test/series/1002.mp4',
        title: 'Episode 2',
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

        const playerDebugElement = fixture.debugElement.query(
            By.directive(EmbeddedMpvPlayerComponent)
        );
        player = playerDebugElement.componentInstance;
        controller = playerDebugElement.injector.get(
            EmbeddedMpvSessionController
        );
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
        });
        fixture.detectChanges();
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
});
