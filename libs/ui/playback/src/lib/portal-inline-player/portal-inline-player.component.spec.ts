import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { PortalInlinePlayerComponent as PortalInlinePlayerComponentInstance } from './portal-inline-player.component';

jest.unstable_mockModule('video.js', () => ({
    default: jest.fn(),
}));

jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

@Component({
    selector: 'app-web-player-view',
    standalone: true,
    template: '<div data-test-id="stub-web-player-view"></div>',
})
class StubWebPlayerViewComponent {
    readonly streamUrl = input.required<string>();
    readonly title = input('');
    readonly playback = input<unknown>(null);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly externalFallbackRequested = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

describe('PortalInlinePlayerComponent', () => {
    let PortalInlinePlayerComponent: typeof import('./portal-inline-player.component').PortalInlinePlayerComponent;
    let WebPlayerViewComponent: typeof import('../web-player-view/web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<PortalInlinePlayerComponentInstance>;
    let component: PortalInlinePlayerComponentInstance;

    beforeAll(async () => {
        ({ PortalInlinePlayerComponent } = await import(
            './portal-inline-player.component'
        ));
        ({ WebPlayerViewComponent } = await import(
            '../web-player-view/web-player-view.component'
        ));
    });

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PortalInlinePlayerComponent],
        })
            .overrideComponent(PortalInlinePlayerComponent, {
                remove: {
                    imports: [WebPlayerViewComponent],
                },
                add: {
                    imports: [StubWebPlayerViewComponent],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(PortalInlinePlayerComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('renders episode metadata below the title and forwards embedded MPV navigation events', () => {
        const events: string[] = [];
        const seriesNavigation = {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        };
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.test/series/1002.mp4',
            title: 'Episode 2',
            startTime: 12,
        });
        fixture.componentRef.setInput('episodeMetadata', {
            label: 'S01E02',
            title: 'Episode 2',
            seasonNumber: 1,
            episodeNumber: 2,
        });
        fixture.componentRef.setInput('seriesNavigation', seriesNavigation);
        (
            component as unknown as {
                playbackEnded: { subscribe: (fn: () => void) => void };
                previousEpisodeRequested: { subscribe: (fn: () => void) => void };
                nextEpisodeRequested: { subscribe: (fn: () => void) => void };
            }
        ).playbackEnded.subscribe(() => events.push('ended'));
        (
            component as unknown as {
                previousEpisodeRequested: { subscribe: (fn: () => void) => void };
            }
        ).previousEpisodeRequested.subscribe(() => events.push('previous'));
        (
            component as unknown as {
                nextEpisodeRequested: { subscribe: (fn: () => void) => void };
            }
        ).nextEpisodeRequested.subscribe(() => events.push('next'));

        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'S01E02 - Episode 2'
        );

        const webPlayer = fixture.debugElement.query(
            By.directive(StubWebPlayerViewComponent)
        ).componentInstance as StubWebPlayerViewComponent;
        expect(webPlayer.seriesNavigation()).toBe(seriesNavigation);

        webPlayer.playbackEnded.emit();
        webPlayer.previousEpisodeRequested.emit();
        webPlayer.nextEpisodeRequested.emit();

        expect(events).toEqual(['ended', 'previous', 'next']);
    });
});
