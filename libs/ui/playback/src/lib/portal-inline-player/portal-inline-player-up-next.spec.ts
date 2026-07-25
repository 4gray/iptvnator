import { Component, input, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
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
    readonly mediaTitle = input<unknown>(null);
    readonly playback = input<unknown>(null);
    readonly startTime = input(0);
    readonly seriesNavigation = input<unknown>(null);
    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly externalFallbackRequested = output<unknown>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();
}

describe('PortalInlinePlayerComponent up next rail', () => {
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

    afterEach(() => {
        fixture?.destroy();
    });

    async function setup(railEnabled: boolean, player = 'videojs') {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [PortalInlinePlayerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: {
                        player: signal(player),
                        playerAmbientMode: signal(false),
                        playerUpNextRail: signal(railEnabled),
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
    }

    const railEl = () => fixture.nativeElement.querySelector('app-up-next-rail');

    const seriesPlayback = {
        streamUrl: 'https://example.com/episode.mp4',
        title: 'Some Show',
        contentInfo: {
            playlistId: 'playlist-1',
            contentXtreamId: 12,
            contentType: 'episode',
        },
    };

    const upNextItems = [
        {
            id: 12,
            label: 'S01E02',
            title: 'Episode 2',
            thumbnailUrl: null,
            progressPercent: 40,
            isPlaying: true,
            episode: { id: '12' },
        },
        {
            id: 13,
            label: 'S01E03',
            title: 'Episode 3',
            thumbnailUrl: null,
            progressPercent: null,
            isPlaying: false,
            episode: { id: '13' },
        },
    ];

    /** Renders, then feeds a stage size as the ResizeObserver would. */
    function renderWithStage(width: number, height: number): void {
        fixture.detectChanges();
        component.stageSize.set({ width, height });
        fixture.detectChanges();
    }

    it('docks the rail for series playback on a wide stage', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        // 1600 - 500 * 16/9 = ~711px leftover — plenty for the rail.
        renderWithStage(1600, 500);

        expect(component.upNextRailVisible()).toBe(true);
        expect(railEl()).toBeTruthy();
        expect(
            fixture.nativeElement.querySelectorAll(
                '[data-testid="up-next-episode"]'
            ).length
        ).toBe(2);
    });

    it('gates on the width the rail actually gets, after padding and gap', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        // At 500px tall the docked layout spends 24px padding + 18px gap, so
        // the rail clears 320px only above a ~1208px stage.
        renderWithStage(1180, 500);
        expect(component.upNextRailVisible()).toBe(false);
        expect(railEl()).toBeNull();

        renderWithStage(1230, 500);
        expect(component.upNextRailVisible()).toBe(true);
        expect(railEl()).toBeTruthy();
    });

    it('stays docked once shown — the modifier padding cannot flip the gate', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        renderWithStage(1600, 500);
        expect(component.upNextRailVisible()).toBe(true);

        // Border-box measurement: the observer reports the same size after
        // the rail modifier adds its padding, so visibility does not oscillate.
        component.stageSize.set({ width: 1600, height: 500 });
        fixture.detectChanges();

        expect(component.upNextRailVisible()).toBe(true);
    });

    it('keeps the centered theater layout when the stage is near 16:9', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        renderWithStage(1280, 720);

        expect(component.upNextRailVisible()).toBe(false);
        expect(railEl()).toBeNull();
    });

    it('never shows the rail for movies (no episode content info)', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/movie.mp4',
            title: 'Some Movie',
            contentInfo: {
                playlistId: 'playlist-1',
                contentXtreamId: 7,
                contentType: 'movie',
            },
        });
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        renderWithStage(1600, 500);

        expect(component.upNextRailVisible()).toBe(false);
        expect(railEl()).toBeNull();
    });

    it('stays hidden when the setting is toggled off', async () => {
        await setup(false);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        renderWithStage(1600, 500);

        expect(component.upNextRailVisible()).toBe(false);
        expect(railEl()).toBeNull();
    });

    it('stays hidden for non-web engines like embedded MPV', async () => {
        await setup(true, 'embedded-mpv');
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        renderWithStage(1600, 500);

        expect(component.upNextRailVisible()).toBe(false);
        expect(railEl()).toBeNull();
    });

    it('emits the selected episode but ignores clicks on the playing one', async () => {
        await setup(true);
        const selected: unknown[] = [];
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        (
            component as unknown as {
                upNextEpisodeSelected: {
                    subscribe: (fn: (item: unknown) => void) => void;
                };
            }
        ).upNextEpisodeSelected.subscribe((item) => selected.push(item));
        renderWithStage(1600, 500);

        const buttons = fixture.nativeElement.querySelectorAll(
            '[data-testid="up-next-episode"]'
        ) as NodeListOf<HTMLButtonElement>;
        buttons[0].click();
        expect(selected).toEqual([]);
        buttons[1].click();
        expect(selected).toEqual([upNextItems[1]]);
    });
});
