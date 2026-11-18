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
    readonly playbackSessionKey = input.required<string>();
    readonly streamUrl = input.required<string>();
    readonly title = input('');
    readonly mediaTitle = input<unknown>(null);
    readonly upNext = input<unknown>(null);
    readonly playback = input<unknown>(null);
    readonly volume = input(1);
    readonly playerOverride = input<unknown>(null);
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

describe('PortalInlinePlayerComponent up next rail', () => {
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

    async function setup(
        railEnabled: boolean,
        player = 'videojs',
        cardEnabled = true
    ) {
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
                        playerUpNextCard: signal(cardEnabled),
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
        fixture.componentRef.setInput('playbackSessionKey', 'up-next-key');
    }

    const railEl = () =>
        fixture.nativeElement.querySelector('app-up-next-rail');

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

    it('hands the episode after the playing one to the player as "up next"', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: true,
            autoplayEnabled: true,
        });
        fixture.detectChanges();

        expect(component.playerUpNext()).toEqual({
            label: 'S01E03',
            title: 'Episode 3',
            thumbnailUrl: null,
            progressPercent: null,
            showCountdown: true,
        });

        // The last episode of the list has nothing after it.
        fixture.componentRef.setInput('upNextEpisodes', [
            { ...upNextItems[1], isPlaying: true },
        ]);
        fixture.detectChanges();
        expect(component.playerUpNext()).toBeNull();

        // Only episodes get a card: a movie never has a "next".
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        fixture.componentRef.setInput('playback', {
            ...seriesPlayback,
            contentInfo: {
                ...seriesPlayback.contentInfo,
                contentType: 'movie',
            },
        });
        fixture.detectChanges();
        expect(component.playerUpNext()).toBeNull();
    });

    it('hands no "up next" card to the player when the setting is off', async () => {
        await setup(true, 'videojs', false);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        fixture.detectChanges();

        expect(component.playerUpNext()).toBeNull();
    });

    it('plays the next season through the rail path once the season is over', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        const selected = jest.fn();
        const next = jest.fn();
        component.upNextEpisodeSelected.subscribe(selected);
        component.nextEpisodeRequested.subscribe(next);

        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        fixture.detectChanges();
        expect(component.playerUpNext()?.showCountdown).toBe(true);
        component.onNextEpisodeRequested();
        expect(selected).toHaveBeenCalledWith(upNextItems[1]);
        expect(next).not.toHaveBeenCalled();

        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: true,
            autoplayEnabled: false,
        });
        fixture.detectChanges();
        component.onNextEpisodeRequested();
        expect(next).toHaveBeenCalledTimes(1);
        expect(selected).toHaveBeenCalledTimes(1);
    });

    it('autoplays into the next season when the season ends', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        const selected = jest.fn();
        const ended = jest.fn();
        component.upNextEpisodeSelected.subscribe(selected);
        component.playbackEnded.subscribe(ended);

        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        fixture.detectChanges();
        component.onPlaybackEnded();
        expect(selected).toHaveBeenCalledWith(
            expect.objectContaining(upNextItems[1])
        );
        expect(ended).not.toHaveBeenCalled();

        // Inside a season the host keeps its own autoplay path.
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: true,
            autoplayEnabled: true,
        });
        fixture.detectChanges();
        component.onPlaybackEnded();
        expect(ended).toHaveBeenCalledTimes(1);

        // Autoplay off: the episode just ends.
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: false,
        });
        fixture.detectChanges();
        component.onPlaybackEnded();
        expect(ended).toHaveBeenCalledTimes(2);
        expect(selected).toHaveBeenCalledTimes(1);
        expect(component.playerUpNext()?.showCountdown).toBe(false);
    });

    it.each(['seek', 'replay', 'committed'] as const)(
        'aborts an issued season autoplay on %s',
        async (action) => {
            await setup(true);
            fixture.componentRef.setInput('playback', seriesPlayback);
            fixture.componentRef.setInput('upNextEpisodes', upNextItems);
            fixture.componentRef.setInput('seriesNavigation', {
                canPrevious: true,
                canNext: false,
                autoplayEnabled: true,
            });
            fixture.detectChanges();
            let issued: AbortSignal | undefined;
            component.upNextEpisodeSelected.subscribe((item) => {
                issued = (
                    item as typeof item & { autoplaySignal?: AbortSignal }
                ).autoplaySignal;
            });
            component.onTimeUpdate({
                currentTime: 120,
                duration: 120,
                playing: false,
            });
            component.onPlaybackEnded();
            expect(issued).toBeDefined();
            if (action === 'committed')
                fixture.componentRef.setInput(
                    'playbackSessionKey',
                    'next-session'
                );
            component.onTimeUpdate({
                currentTime: action === 'seek' ? 10 : 120,
                duration: 120,
                playing: action === 'replay',
            });
            expect(issued?.aborted).toBe(action !== 'committed');
        }
    );

    it('preserves a pending episode choice when the current season ends', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        fixture.componentRef.setInput('playbackPending', true);
        const selected = jest.fn();
        component.upNextEpisodeSelected.subscribe(selected);
        fixture.detectChanges();
        component.onPlaybackEnded();
        expect(selected).not.toHaveBeenCalled();
    });

    it.each([
        'ended',
        'new session',
        'seek',
        'replay',
        'pending choice',
    ] as const)(
        'handles a late season only while playback remains ended (%s)',
        async (state) => {
            await setup(true);
            fixture.componentRef.setInput('playback', seriesPlayback);
            fixture.componentRef.setInput('upNextEpisodes', [upNextItems[0]]);
            fixture.componentRef.setInput('seasonLoadStates', {
                '2': 'loading',
            });
            fixture.componentRef.setInput('seriesNavigation', {
                canPrevious: true,
                canNext: false,
                autoplayEnabled: true,
            });
            const selected = jest.fn();
            component.upNextEpisodeSelected.subscribe(selected);
            fixture.detectChanges();
            component.onTimeUpdate({
                currentTime: 119,
                duration: 120,
                playing: false,
            });
            component.onPlaybackEnded();
            expect(selected).not.toHaveBeenCalled();

            if (state === 'pending choice')
                fixture.componentRef.setInput('playbackPending', true);
            if (state === 'new session')
                fixture.componentRef.setInput(
                    'playbackSessionKey',
                    'another-episode'
                );
            if (state === 'ended') {
                component.onTimeUpdate({
                    currentTime: 119,
                    duration: 120,
                    playing: false,
                });
                fixture.componentRef.setInput('seasonLoadStates', {
                    '3': 'unloaded',
                });
                fixture.detectChanges();
            }
            if (state === 'seek')
                component.onTimeUpdate({
                    currentTime: 10,
                    duration: 120,
                    playing: false,
                });
            if (state === 'replay')
                component.onTimeUpdate({
                    currentTime: 119,
                    duration: 120,
                    playing: true,
                });
            fixture.componentRef.setInput('upNextEpisodes', upNextItems);
            fixture.componentRef.setInput('seasonLoadStates', {});
            fixture.detectChanges();
            expect(selected).toHaveBeenCalledTimes(state === 'ended' ? 1 : 0);
            if (state === 'ended')
                expect(selected).toHaveBeenCalledWith(
                    expect.objectContaining(upNextItems[1])
                );
        }
    );

    it('stops season-crossing autoplay once the autoplay run is at its limit', async () => {
        await setup(true);
        fixture.componentRef.setInput('playback', seriesPlayback);
        fixture.componentRef.setInput('upNextEpisodes', upNextItems);
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        fixture.detectChanges();
        const { AutoplayStreakService } =
            await import('./autoplay-streak.service');
        const streak = TestBed.inject(AutoplayStreakService);
        jest.spyOn(streak, 'canContinue').mockReturnValue(false);
        const selected = jest.fn();
        const ended = jest.fn();
        component.upNextEpisodeSelected.subscribe(selected);
        component.playbackEnded.subscribe(ended);

        component.onPlaybackEnded();
        expect(selected).not.toHaveBeenCalled();
        expect(ended).toHaveBeenCalledTimes(1);
    });

    it('keeps the autoplay run across autoplayed episodes and resets it otherwise', async () => {
        await setup(true);
        fixture.detectChanges();
        const { AutoplayStreakService } =
            await import('./autoplay-streak.service');
        const streak = TestBed.inject(AutoplayStreakService);
        streak.reset();

        expect(streak.beginAutoplay()).toBe(true);
        fixture.componentRef.setInput('playbackSessionKey', 'episode-2');
        fixture.detectChanges();
        expect(streak.length).toBe(1);

        // Started by the viewer, not by autoplay.
        fixture.componentRef.setInput('playbackSessionKey', 'episode-7');
        fixture.detectChanges();
        expect(streak.length).toBe(0);
    });

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
