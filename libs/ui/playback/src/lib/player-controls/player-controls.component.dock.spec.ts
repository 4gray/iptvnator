import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { COMPACT_LAYOUT_MAX_WIDTH } from './controls-layout';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import { PlayerControlsComponent } from './player-controls.component';
import type {
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerController,
} from './player-controls.model';

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;

function createFakeController() {
    const capabilities: WritableSignal<PlayerControlsCapabilities> = signal({
        ...DEFAULT_PLAYER_CAPABILITIES,
    });
    const state: WritableSignal<PlayerControlsState> = signal(
        createEmptyControlsState()
    );
    const commands: jest.Mocked<PlayerControlsCommands> = {
        togglePlay: jest.fn(),
        seekTo: jest.fn(),
        seekBy: jest.fn(),
        setVolume: jest.fn(),
        setAudioTrack: jest.fn(),
        setSubtitleTrack: jest.fn(),
        addExternalSubtitleFile: jest.fn(),
        setSubtitleDelay: jest.fn(),
        setSubtitleStyle: jest.fn(),
        setQualityLevel: jest.fn(),
        setPlaybackSpeed: jest.fn(),
        setAspectRatio: jest.fn(),
        toggleRecording: jest.fn(),
        togglePictureInPicture: jest.fn(),
    };
    const controller: PlayerController = { capabilities, state, commands };
    return { controller, capabilities, state, commands };
}

/**
 * The "Hybrid" dock: scrim backdrop, remaining time, timeline hover label,
 * the accent play button, and the compact/wide layout branches.
 */
describe('PlayerControlsComponent dock', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let resizeCallbacks: ResizeCallback[];
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let component: PlayerControlsComponent;
    let fake: ReturnType<typeof createFakeController>;

    const query = (selector: string) =>
        fixture.nativeElement.querySelector(selector) as HTMLElement | null;

    const setCapabilities = (overrides: Partial<PlayerControlsCapabilities>) =>
        fake.capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES, ...overrides });

    const setState = (overrides: Partial<PlayerControlsState>) =>
        fake.state.set({ ...createEmptyControlsState(), ...overrides });

    const resizeTo = (width: number) => {
        for (const callback of resizeCallbacks) {
            callback([
                {
                    borderBoxSize: [{ inlineSize: width, blockSize: 300 }],
                    contentRect: { width } as DOMRectReadOnly,
                } as unknown as ResizeObserverEntry,
            ]);
        }
        fixture.detectChanges();
    };

    beforeEach(async () => {
        resizeCallbacks = [];
        class FakeResizeObserver {
            constructor(callback: ResizeCallback) {
                resizeCallbacks.push(callback);
            }
            observe(): void {
                /* noop */
            }
            unobserve(): void {
                /* noop */
            }
            disconnect(): void {
                /* noop */
            }
        }
        globalThis.ResizeObserver =
            FakeResizeObserver as unknown as typeof ResizeObserver;
        localStorage.removeItem('volume');
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            EMBEDDED_MPV: {
                PLAYER: {
                    PLAY: 'Play',
                    PAUSE: 'Pause',
                    PREVIOUS_EPISODE: 'Previous episode',
                    NEXT_EPISODE: 'Next episode',
                    BACK_10_SECONDS: 'Back 10 seconds',
                    FORWARD_10_SECONDS: 'Forward 10 seconds',
                    MUTE: 'Mute',
                    UNMUTE: 'Unmute',
                },
            },
        });
        translate.use('en');

        fake = createFakeController();
        fixture = TestBed.createComponent(PlayerControlsComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('controller', fake.controller);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        globalThis.ResizeObserver = originalResizeObserver;
    });

    it('backs the dock with a bottom scrim that fades with the controls', () => {
        const scrim = query('[data-test-id="player-controls-bottom-scrim"]');
        expect(scrim).not.toBeNull();
        expect(scrim?.classList).toContain(
            'player-controls__bottom-scrim--visible'
        );
        expect(scrim?.getAttribute('aria-hidden')).toBe('true');

        fixture.componentRef.setInput('showControls', false);
        fixture.detectChanges();
        expect(
            query('[data-test-id="player-controls-bottom-scrim"]')
        ).toBeNull();
    });

    it('renders the accent play button with Play/Pause names', () => {
        const play = query('[data-test-id="player-controls-play"]');
        expect(play?.tagName).toBe('BUTTON');
        expect(play?.getAttribute('aria-label')).toBe('Play');
        expect(play?.querySelector('mat-icon')?.textContent).toBe('play_arrow');

        setState({ status: 'playing' });
        fixture.detectChanges();
        expect(play?.getAttribute('aria-label')).toBe('Pause');
        expect(play?.querySelector('mat-icon')?.textContent).toBe('pause');

        play?.click();
        expect(fake.commands.togglePlay).toHaveBeenCalledTimes(1);
    });

    it('orders the wide transport as previous, back, play, forward, next', () => {
        setCapabilities({ seek: true, seriesNavigation: true });
        setState({ canSeek: true, durationSeconds: 100 });
        fixture.detectChanges();

        const labels = Array.from(
            fixture.nativeElement.querySelectorAll(
                '.player-controls__transport button'
            ) as NodeListOf<HTMLElement>
        ).map((button) => button.getAttribute('aria-label'));
        expect(labels).toEqual([
            'Previous episode',
            'Back 10 seconds',
            'Play',
            'Forward 10 seconds',
            'Next episode',
        ]);
    });

    describe('timeline row', () => {
        it('shows the remaining time instead of the total duration', () => {
            setCapabilities({ seek: true });
            setState({
                canSeek: true,
                durationSeconds: 600,
                positionSeconds: 30,
            });
            fixture.detectChanges();

            expect(query('.player-controls__time--current')?.textContent).toBe(
                '0:30'
            );
            expect(
                query('[data-test-id="player-controls-remaining-time"]')
                    ?.textContent
            ).toBe('−9:30');
            expect(query('.player-controls__live-badge')).toBeNull();
        });

        it('follows the scrub preview in the remaining time', () => {
            setCapabilities({ seek: true });
            setState({
                canSeek: true,
                durationSeconds: 600,
                positionSeconds: 30,
            });
            fixture.detectChanges();

            const slider = query(
                '.player-controls__slider--timeline'
            ) as HTMLInputElement;
            slider.value = '540';
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            fixture.detectChanges();

            expect(
                query('[data-test-id="player-controls-remaining-time"]')
                    ?.textContent
            ).toBe('−1:00');
        });

        it('shows a placeholder for unknown durations and LIVE for live streams', () => {
            setState({ canSeek: false, isLive: false });
            fixture.detectChanges();
            expect(query('.player-controls__time--end')?.textContent).toBe(
                '--:--'
            );

            setState({ canSeek: false, isLive: true });
            fixture.detectChanges();
            expect(query('.player-controls__time--end')).toBeNull();
            expect(query('.player-controls__live-badge')).not.toBeNull();
        });

        it('draws the progress fill and knob from the timeline progress', () => {
            setCapabilities({ seek: true });
            setState({
                canSeek: true,
                durationSeconds: 200,
                positionSeconds: 50,
            });
            fixture.detectChanges();

            expect(query('.player-controls__timeline-fill')?.style.width).toBe(
                '25%'
            );
            expect(query('.player-controls__timeline-knob')?.style.left).toBe(
                '25%'
            );

            setState({
                canSeek: false,
                durationSeconds: 200,
                positionSeconds: 50,
            });
            fixture.detectChanges();
            expect(query('.player-controls__timeline-knob')).toBeNull();
            expect(
                query('.player-controls__timeline-bar')?.classList
            ).toContain('player-controls__timeline-bar--disabled');
        });

        it('shows the hovered time above the bar and clears it on leave', () => {
            setCapabilities({ seek: true });
            setState({
                canSeek: true,
                durationSeconds: 400,
                positionSeconds: 0,
            });
            fixture.detectChanges();

            const bar = query('.player-controls__timeline-bar') as HTMLElement;
            bar.getBoundingClientRect = () =>
                ({ left: 100, width: 200 }) as DOMRect;

            bar.dispatchEvent(
                new MouseEvent('pointermove', { clientX: 150, bubbles: true })
            );
            fixture.detectChanges();

            const label = query(
                '[data-test-id="player-controls-timeline-label"]'
            );
            expect(label?.textContent?.trim()).toBe('1:40');
            expect(label?.style.getPropertyValue('--hover-x')).toBe('25%');
            expect(query('.player-controls__timeline-marker')?.style.left).toBe(
                '25%'
            );
            expect(fake.commands.seekTo).not.toHaveBeenCalled();

            bar.dispatchEvent(
                new MouseEvent('pointerleave', { bubbles: true })
            );
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-timeline-label"]')
            ).toBeNull();
        });

        it('draws host segments proportionally with per-segment fills', () => {
            setCapabilities({ seek: true });
            setState({
                canSeek: true,
                durationSeconds: 400,
                positionSeconds: 150,
            });
            fixture.componentRef.setInput('timelineSegments', [
                { startSeconds: 100, endSeconds: 300, title: 'Chapter 2' },
                { startSeconds: 0, endSeconds: 100, title: 'Chapter 1' },
            ]);
            fixture.detectChanges();

            const segments = Array.from(
                fixture.nativeElement.querySelectorAll(
                    '.player-controls__timeline-segment'
                ) as NodeListOf<HTMLElement>
            );
            expect(
                segments.map((s) => s.dataset['segmentTitle'] ?? null)
            ).toEqual(['Chapter 1', 'Chapter 2', null]);
            // Positioned by time, so boundaries match the linear seek input.
            expect(segments.map((s) => s.style.left)).toEqual([
                '0%',
                '25%',
                '75%',
            ]);
            expect(segments.at(-1)?.style.width).toBe('25%');
            expect(
                segments.map(
                    (s) =>
                        (
                            s.querySelector(
                                '.player-controls__timeline-fill'
                            ) as HTMLElement
                        ).style.width
                )
            ).toEqual(['100%', '25%', '0%']);
            // The knob still reads the overall progress.
            expect(query('.player-controls__timeline-knob')?.style.left).toBe(
                '37.5%'
            );
        });

        it('names the hovered segment in the timeline label', () => {
            setCapabilities({ seek: true });
            setState({
                canSeek: true,
                durationSeconds: 400,
                positionSeconds: 0,
            });
            fixture.componentRef.setInput('timelineSegments', [
                { startSeconds: 0, endSeconds: 200, title: 'Intro' },
            ]);
            fixture.detectChanges();

            const bar = query('.player-controls__timeline-bar') as HTMLElement;
            bar.getBoundingClientRect = () =>
                ({ left: 0, width: 400 }) as DOMRect;
            bar.dispatchEvent(
                new MouseEvent('pointermove', { clientX: 100, bubbles: true })
            );
            fixture.detectChanges();
            expect(
                query(
                    '[data-test-id="player-controls-timeline-label"]'
                )?.textContent?.trim()
            ).toBe('Intro \u00b7 1:40');

            bar.dispatchEvent(
                new MouseEvent('pointermove', { clientX: 300, bubbles: true })
            );
            fixture.detectChanges();
            expect(
                query(
                    '[data-test-id="player-controls-timeline-label"]'
                )?.textContent?.trim()
            ).toBe('5:00');
        });

        it('does not hover-label a non-seekable timeline', () => {
            setCapabilities({ seek: true });
            setState({ canSeek: false, durationSeconds: 400 });
            fixture.detectChanges();

            const bar = query('.player-controls__timeline-bar') as HTMLElement;
            bar.getBoundingClientRect = () =>
                ({ left: 0, width: 200 }) as DOMRect;
            bar.dispatchEvent(
                new MouseEvent('pointermove', { clientX: 50, bubbles: true })
            );
            fixture.detectChanges();

            expect(
                query('[data-test-id="player-controls-timeline-label"]')
            ).toBeNull();
        });
    });

    describe('up next card', () => {
        const nearTheEnd = () =>
            setState({
                canSeek: true,
                canNextEpisode: true,
                durationSeconds: 1200,
                positionSeconds: 1200 - 30,
            });

        beforeEach(() => {
            setCapabilities({
                seek: true,
                seriesNavigation: true,
                playbackSpeed: true,
            });
            fixture.componentRef.setInput('upNext', {
                label: 'S01E03',
                title: 'The Third One',
                thumbnailUrl: null,
                progressPercent: null,
            });
            fixture.detectChanges();
        });

        it('appears within the last minutes and plays the next episode on click', () => {
            setState({
                canSeek: true,
                canNextEpisode: true,
                // Five minutes left of a 20-minute episode: still too early
                // for its 48 s adaptive lead.
                durationSeconds: 1200,
                positionSeconds: 1200 - 5 * 60,
            });
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-up-next"]')
            ).toBeNull();

            nearTheEnd();
            fixture.detectChanges();
            const card = query('[data-test-id="player-controls-up-next"]');
            expect(card).not.toBeNull();
            expect(card?.textContent).toContain('The Third One');

            const next = jest.fn();
            component.nextEpisodeRequested.subscribe(next);
            card?.click();
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('offers the next season across the season boundary', () => {
            setState({
                canSeek: true,
                canNextEpisode: false,
                durationSeconds: 1200,
                positionSeconds: 1200 - 30,
            });
            fixture.detectChanges();
            const card = query('[data-test-id="player-controls-up-next"]');
            expect(card).not.toBeNull();
            // The transport's next button is disabled, but the card still
            // hands the request to the host, which picks the next season.
            expect(
                (
                    query(
                        '[data-test-id="player-controls-next-episode"]'
                    ) as HTMLButtonElement
                ).disabled
            ).toBe(true);
            const next = jest.fn();
            component.nextEpisodeRequested.subscribe(next);
            card?.click();
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('yields to the settings panel and needs a next episode', () => {
            nearTheEnd();
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-up-next"]')
            ).not.toBeNull();

            component.settings.open('speed');
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-up-next"]')
            ).toBeNull();
            component.settings.close();
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-up-next"]')
            ).not.toBeNull();

            fixture.componentRef.setInput('upNext', null);
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-up-next"]')
            ).toBeNull();
        });

        it('stays closed for this episode once dismissed', () => {
            nearTheEnd();
            fixture.detectChanges();
            query('[data-test-id="player-controls-up-next-close"]')?.click();
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-up-next"]')
            ).toBeNull();

            setState({
                canSeek: true,
                canNextEpisode: true,
                durationSeconds: 1200,
                positionSeconds: 1200 - 10,
            });
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-up-next"]')
            ).toBeNull();
        });

        it('uses the compact card on a compact dock', () => {
            nearTheEnd();
            resizeTo(400);
            expect(
                query('[data-test-id="player-controls-up-next"]')?.closest(
                    '.player-controls__up-next--compact'
                )
            ).not.toBeNull();
        });
    });

    describe('layout modes', () => {
        beforeEach(() => {
            setCapabilities({ volume: true });
            fixture.detectChanges();
        });

        it('starts wide with the volume slider inline', () => {
            expect(component.isCompact()).toBe(false);
            expect(query('.player-controls__bar')?.classList).not.toContain(
                'player-controls__bar--compact'
            );
            expect(query('.player-controls__slider--inline')).not.toBeNull();
            expect(query('.player-controls__volume-popover')).toBeNull();
        });

        it('mutes on a wide volume button click without opening a popover', () => {
            component.volumeInteractions.hoverEnter();
            fixture.detectChanges();
            expect(query('.player-controls__volume-popover')).toBeNull();

            (query('[aria-label="Mute"]') as HTMLButtonElement).dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            );
            fixture.detectChanges();

            expect(fake.commands.setVolume).toHaveBeenCalledWith(0);
            expect(query('[aria-label="Unmute"]')).not.toBeNull();
        });

        it('moves the volume slider behind a popover once compact', () => {
            resizeTo(COMPACT_LAYOUT_MAX_WIDTH);

            expect(component.isCompact()).toBe(true);
            expect(query('.player-controls__bar')?.classList).toContain(
                'player-controls__bar--compact'
            );
            expect(query('.player-controls__slider--inline')).toBeNull();
            expect(query('.player-controls__volume-popover')).toBeNull();

            component.volumeInteractions.hoverEnter();
            fixture.detectChanges();
            expect(query('.player-controls__volume-popover')).not.toBeNull();

            resizeTo(COMPACT_LAYOUT_MAX_WIDTH + 200);
            expect(component.isCompact()).toBe(false);
            expect(query('.player-controls__slider--inline')).not.toBeNull();
        });

        it('keeps episode navigation reachable in the compact transport', () => {
            setCapabilities({ volume: true, seriesNavigation: true });
            resizeTo(400);

            expect(
                query('[data-test-id="player-controls-next-episode"]')
            ).not.toBeNull();
            expect(
                query('[data-test-id="player-controls-previous-episode"]')
            ).not.toBeNull();
        });
    });
});
