import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { EmbeddedMpvOverlayVisibilityService } from '../../../../libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-overlay-visibility.service';
import { EmbeddedMpvPlayerComponent } from '../../../../libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-player.component';
import { EmbeddedMpvSessionController } from '../../../../libs/ui/playback/src/lib/embedded-mpv-player/embedded-mpv-session-controller';

@Component({
    imports: [EmbeddedMpvPlayerComponent],
    template: `<app-embedded-mpv-player [playback]="playback" />`,
})
class EmbeddedMpvPlayerHostComponent {
    readonly playback: ResolvedPortalPlayback = {
        streamUrl: 'https://example.test/live.m3u8',
        title: 'Live News',
        isLive: true,
    };
}

describe('EmbeddedMpvPlayerComponent recording status message', () => {
    let fixture: ComponentFixture<EmbeddedMpvPlayerHostComponent>;
    let component: EmbeddedMpvPlayerComponent;
    let controller: EmbeddedMpvSessionController;

    beforeEach(async () => {
        window.electron = {
            onEmbeddedMpvSessionUpdate: jest.fn(() => undefined),
        } as unknown as typeof window.electron;

        await TestBed.configureTestingModule({
            imports: [EmbeddedMpvPlayerHostComponent],
            providers: [
                {
                    provide: EmbeddedMpvOverlayVisibilityService,
                    useValue: { overlayActive: signal(false) },
                },
            ],
        })
            .overrideComponent(EmbeddedMpvPlayerComponent, {
                set: { template: '' },
            })
            .compileComponents();

        fixture = TestBed.createComponent(EmbeddedMpvPlayerHostComponent);
        fixture.detectChanges();

        const playerDebugElement = fixture.debugElement.query(
            By.directive(EmbeddedMpvPlayerComponent)
        );
        component = playerDebugElement.componentInstance;
        controller = playerDebugElement.injector.get(
            EmbeddedMpvSessionController
        );
        controller.support.set({
            supported: true,
            platform: 'darwin',
            capabilities: {
                subtitles: true,
                playbackSpeed: true,
                aspectOverride: true,
                screenshot: false,
                recording: true,
            },
        });
        controller.session.set({
            id: 'session-1',
            title: 'Live News',
            streamUrl: 'https://example.test/live.m3u8',
            status: 'playing',
            positionSeconds: 0,
            durationSeconds: null,
            volume: 1,
            audioTracks: [],
            selectedAudioTrackId: null,
            subtitleTracks: [],
            selectedSubtitleTrackId: null,
            playbackSpeed: 1,
            aspectOverride: 'no',
            recording: {
                active: true,
                targetPath: '/tmp/live-news.ts',
                startedAt: '2026-05-09T18:00:00Z',
            },
            startedAt: '2026-05-09T18:00:00Z',
            updatedAt: '2026-05-09T18:00:00Z',
        });
        jest.spyOn(controller, 'stopRecording').mockImplementation(async () => {
            controller.session.update((session) =>
                session
                    ? {
                          ...session,
                          recording: {
                              active: false,
                              targetPath: '/tmp/live-news.ts',
                          },
                      }
                    : session
            );
            return {
                active: false,
                targetPath: '/tmp/live-news.ts',
            };
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        fixture.destroy();
        delete window.electron;
    });

    it('clears the saved recording path after a short delay', async () => {
        jest.useFakeTimers();

        await component.toggleRecording();

        expect(component.recordingStatusText()).toBe(
            'Saved to /tmp/live-news.ts'
        );

        jest.advanceTimersByTime(5000);
        fixture.detectChanges();

        expect(component.recordingStatusText()).toBeNull();
    });
});
