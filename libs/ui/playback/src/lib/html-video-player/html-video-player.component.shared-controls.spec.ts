import { By } from '@angular/platform-browser';
import {
    PlayerControlsComponent,
    WebVideoControlsAdapter,
} from '../player-controls';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import type { HtmlVideoPlayerComponent as HtmlVideoPlayerComponentInstance } from './html-video-player.component';
import {
    cleanupSharedControlsTests,
    configureSharedControlsTests,
    renderSharedControls,
    renderSharedControlsDefaults,
    type SharedControlsFixture,
} from './html-video-player.component.shared-controls.spec-fixtures';

describe('HtmlVideoPlayerComponent shared controls host', () => {
    let HtmlVideoPlayerComponent: typeof import('./html-video-player.component').HtmlVideoPlayerComponent;
    const fixtures: SharedControlsFixture[] = [];

    beforeAll(async () => {
        ({ HtmlVideoPlayerComponent } =
            await import('./html-video-player.component'));
    });

    beforeEach(async () => {
        await configureSharedControlsTests(HtmlVideoPlayerComponent);
    });

    afterEach(() => {
        cleanupSharedControlsTests(fixtures);
    });

    it('uses declared shared-control defaults without input overrides', () => {
        const { component, controls } = renderSharedControlsDefaults(
            HtmlVideoPlayerComponent,
            fixtures
        );

        expect(component.isLive).toBe(true);
        expect(component.interactionEnabled).toBe(true);
        expect(component.showCaptions).toBe(false);
        expect(controls?.showControls()).toBe(true);
        expect(controls?.shortcutsEnabled()).toBe(true);
    });

    it('scopes one adapter and context initialization to each component', () => {
        const setContext = jest.spyOn(
            WebVideoControlsAdapter.prototype,
            'setContext'
        );
        const first = renderSharedControls(HtmlVideoPlayerComponent, fixtures);
        const second = renderSharedControls(HtmlVideoPlayerComponent, fixtures);

        expect(first.adapter).not.toBe(second.adapter);
        expect(setContext).toHaveBeenCalledTimes(2);

        first.fixture.detectChanges();
        second.fixture.detectChanges();
        expect(setContext).toHaveBeenCalledTimes(2);
    });

    it('uses one shared controls instance on the actual player shell', () => {
        const { fixture, controls } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures,
            {
                seriesNavigation: {
                    canPrevious: true,
                    canNext: true,
                    autoplayEnabled: true,
                },
            }
        );
        const shell = fixture.debugElement.query(
            By.css('.html-video-player-shell')
        ).nativeElement;
        const video = fixture.debugElement.query(By.css('video'))
            .nativeElement as HTMLVideoElement;

        expect(video.controls).toBe(false);
        expect(
            fixture.debugElement.queryAll(By.directive(PlayerControlsComponent))
        ).toHaveLength(1);
        expect(
            fixture.debugElement.query(
                By.directive(SeriesPlaybackNavigationControlsComponent)
            )
        ).toBeNull();
        expect(controls?.playerSurface()).toBe(shell);
    });

    it('gates the shared surface and shortcuts with interaction availability', () => {
        const { fixture, controls } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures,
            { interactionEnabled: false }
        );

        expect(controls?.showControls()).toBe(false);
        expect(controls?.shortcutsEnabled()).toBe(false);

        fixture.componentRef.setInput('interactionEnabled', true);
        fixture.detectChanges();

        expect(controls?.showControls()).toBe(true);
        expect(controls?.shortcutsEnabled()).toBe(true);
    });

    it('exits only its own fullscreen shell when interactions become unavailable', () => {
        const { fixture } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures
        );
        const shell = fixture.debugElement.query(
            By.css('.html-video-player-shell')
        ).nativeElement as HTMLElement;
        const unrelatedSurface = document.createElement('div');
        const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'fullscreenElement'
        );
        const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'exitFullscreen'
        );
        let fullscreenElement: Element | null = unrelatedSurface;
        const exitFullscreen = jest.fn().mockResolvedValue(undefined);

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exitFullscreen,
        });

        try {
            fixture.componentRef.setInput('interactionEnabled', false);
            fixture.detectChanges();
            expect(exitFullscreen).not.toHaveBeenCalled();

            fixture.componentRef.setInput('interactionEnabled', true);
            fixture.detectChanges();
            fullscreenElement = shell;
            fixture.componentRef.setInput('interactionEnabled', false);
            fixture.detectChanges();

            expect(exitFullscreen).toHaveBeenCalledTimes(1);
        } finally {
            restoreDocumentProperty(
                'fullscreenElement',
                fullscreenElementDescriptor
            );
            restoreDocumentProperty('exitFullscreen', exitFullscreenDescriptor);
        }
    });

    it('keeps series context reactive and forwards navigation outputs', () => {
        const setContext = jest.spyOn(
            WebVideoControlsAdapter.prototype,
            'setContext'
        );
        const { fixture, component, adapter, controls } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures,
            { isLive: false }
        );
        const previous = jest.fn();
        const next = jest.fn();
        component.previousEpisodeRequested.subscribe(previous);
        component.nextEpisodeRequested.subscribe(next);

        expect(adapter.capabilities().seriesNavigation).toBe(false);
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        fixture.detectChanges();

        expect(adapter.capabilities().seriesNavigation).toBe(true);
        expect(adapter.state().canPreviousEpisode).toBe(true);
        expect(adapter.state().canNextEpisode).toBe(false);
        controls?.previousEpisodeRequested.emit();
        controls?.nextEpisodeRequested.emit();
        expect(previous).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledTimes(1);
        expect(setContext).toHaveBeenCalledTimes(1);
    });

    it('does not run legacy post-play caption suppression', async () => {
        const { component } = renderSharedControls(
            HtmlVideoPlayerComponent,
            fixtures
        );
        const disableCaptions = jest.spyOn(
            component as HtmlVideoPlayerComponentInstance,
            'disableCaptions'
        );

        component.handlePlayOperation();
        await Promise.resolve();

        expect(disableCaptions).not.toHaveBeenCalled();
    });
});

function restoreDocumentProperty(
    property: 'exitFullscreen' | 'fullscreenElement',
    descriptor: PropertyDescriptor | undefined
): void {
    if (descriptor) {
        Object.defineProperty(document, property, descriptor);
        return;
    }

    delete (document as unknown as Record<string, unknown>)[property];
}
