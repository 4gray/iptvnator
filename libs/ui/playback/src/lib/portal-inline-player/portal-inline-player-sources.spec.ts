import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import { VodSourcesChipComponent } from '@iptvnator/ui/components';
import type { VodSourceDescriptor } from '@iptvnator/shared/interfaces';
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
    readonly playbackSessionKey = input.required<string>();
    readonly streamUrl = input.required<string>();
    readonly title = input('');
    readonly mediaTitle = input<unknown>(null);
    readonly playback = input<unknown>(null);
    readonly volume = input(1);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly alternativeSources = input<unknown[]>([]);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly externalFallbackRequested = output<unknown>();
    readonly alternativeSourceRequested = output<string>();
    readonly playbackFailed = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

function descriptor(id: string, isActive: boolean): VodSourceDescriptor {
    return {
        id,
        playlistId: id,
        playlistName: `Portal ${id}`,
        portalType: 'xtream',
        contentId: 1,
        rawTitle: 'The Matrix',
        matchConfidence: 'exact',
        year: 1999,
        isActive,
        isPinned: false,
        isTried: isActive,
        probe: { status: 'idle' },
    };
}

/**
 * The picker inside the player is the SAME picker as the detail page's, so the
 * settings it shows and changes have to be the same ones.
 */
describe('PortalInlinePlayerComponent sources picker', () => {
    let PortalInlinePlayerComponent: typeof import('./portal-inline-player.component').PortalInlinePlayerComponent;
    let WebPlayerViewComponent: typeof import('../web-player-view/web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<PortalInlinePlayerComponentInstance>;
    let component: PortalInlinePlayerComponentInstance;

    beforeAll(async () => {
        ({ PortalInlinePlayerComponent } =
            await import('./portal-inline-player.component'));
        ({ WebPlayerViewComponent } =
            await import('../web-player-view/web-player-view.component'));
    });

    afterEach(() => {
        fixture?.destroy();
    });

    beforeEach(async () => {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [PortalInlinePlayerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: {
                        player: signal('html5'),
                        playerAmbientMode: signal(false),
                        playerUpNextRail: signal(false),
                        stripCountryPrefix: signal(false),
                    },
                },
            ],
        })
            .overrideComponent(PortalInlinePlayerComponent, {
                remove: { imports: [WebPlayerViewComponent] },
                add: { imports: [StubWebPlayerViewComponent] },
            })
            .compileComponents();

        fixture = TestBed.createComponent(PortalInlinePlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('playbackSessionKey', 'sources-key');

        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/movie.mkv',
            title: 'The Matrix',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 1,
                contentType: 'vod',
            },
        });
        fixture.componentRef.setInput('allSources', [
            descriptor('playlist-1', true),
            descriptor('playlist-2', false),
        ]);
        fixture.componentRef.setInput('alternativeSources', [
            descriptor('playlist-2', false),
        ]);
    });

    function chip(): VodSourcesChipComponent {
        return fixture.debugElement.query(By.directive(VodSourcesChipComponent))
            .componentInstance;
    }

    it('shows auto-failover as it actually is, not as off by default', () => {
        fixture.componentRef.setInput('sourcesAutoFailoverEnabled', true);
        fixture.detectChanges();

        expect(chip().autoFailoverEnabled()).toBe(true);
    });

    it('relays a toggle to the host that owns the setting', () => {
        const toggled = jest.fn();
        component.sourcesAutoFailoverToggled.subscribe(toggled);
        fixture.detectChanges();

        chip().autoFailoverToggled.emit(false);

        expect(toggled).toHaveBeenCalledWith(false);
    });

    it('states the match kind the host reports', () => {
        fixture.componentRef.setInput('sourcesMatchKind', 'title');
        fixture.detectChanges();

        // The picker prints this as a claim about how the sources were found,
        // so a default it was never told is a guess presented as a fact.
        expect(chip().matchKind()).toBe('title');
    });
});
