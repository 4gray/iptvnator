import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DEFAULT_PLAYER_CAPABILITIES } from './player-controls-defaults';
import { createEmptyControlsState } from './player-controls-defaults';
import { PlayerControlsComponent } from './player-controls.component';
import type {
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerController,
} from './player-controls.model';

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

describe('PlayerControlsComponent', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let fake: ReturnType<typeof createFakeController>;

    const setCapabilities = (
        overrides: Partial<PlayerControlsCapabilities>
    ) => {
        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            ...overrides,
        });
    };

    const setState = (overrides: Partial<PlayerControlsState>) => {
        fake.state.set({ ...createEmptyControlsState(), ...overrides });
    };

    const query = (selector: string) =>
        fixture.nativeElement.querySelector(selector) as HTMLElement | null;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        // Load the real English values so aria-labels resolve to the same text
        // the capability/command specs assert against.
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
                    LIVE_STREAM: 'Live stream',
                    PLAYBACK_POSITION: 'Playback position',
                    MUTE: 'Mute',
                    UNMUTE: 'Unmute',
                    VOLUME: 'Volume',
                    VOLUME_LABEL: 'Volume {{percent}}%',
                    MUTED: 'Muted',
                    AUDIO_TRACKS: 'Audio tracks',
                    SUBTITLES: 'Subtitles',
                    SUBTITLES_OFF: 'Off',
                    PLAYBACK_SPEED: 'Playback speed',
                    SPEED_TOOLTIP: 'Speed: {{speed}}',
                    ASPECT_RATIO: 'Aspect ratio',
                    ASPECT_DEFAULT: 'Default',
                    START_RECORDING: 'Start recording',
                    STOP_RECORDING: 'Stop recording',
                    ENTER_FULLSCREEN: 'Enter fullscreen',
                    EXIT_FULLSCREEN: 'Exit fullscreen',
                },
            },
        });
        translate.use('en');

        fake = createFakeController();
        fixture = TestBed.createComponent(PlayerControlsComponent);
        fixture.componentRef.setInput('controller', fake.controller);
        fixture.detectChanges();
    });

    describe('capability gating', () => {
        it('hides every optional control when no capability is enabled', () => {
            expect(query('[aria-label="Back 10 seconds"]')).toBeNull();
            expect(query('[aria-label="Audio tracks"]')).toBeNull();
            expect(query('[aria-label="Subtitles"]')).toBeNull();
            expect(query('[aria-label="Playback speed"]')).toBeNull();
            expect(query('[aria-label="Aspect ratio"]')).toBeNull();
            expect(query('.player-controls__record-button')).toBeNull();
            expect(query('[aria-label="Enter fullscreen"]')).toBeNull();
            expect(query('[aria-label="Mute"]')).toBeNull();
            expect(
                query('[data-test-id="player-controls-previous-episode"]')
            ).toBeNull();
        });

        it('shows seek controls only when the seek capability is on', () => {
            setCapabilities({ seek: true });
            fixture.detectChanges();
            expect(query('[aria-label="Back 10 seconds"]')).not.toBeNull();
            expect(query('[aria-label="Forward 10 seconds"]')).not.toBeNull();
        });

        it('shows the recording button only when recording is enabled and live', () => {
            setCapabilities({ recording: true });
            setState({ isLive: true });
            fixture.detectChanges();
            expect(query('.player-controls__record-button')).not.toBeNull();

            setState({ isLive: false });
            fixture.detectChanges();
            expect(query('.player-controls__record-button')).toBeNull();
        });

        it('shows the audio menu only with the capability and more than one track', () => {
            setCapabilities({ audioTracks: true });
            setState({
                audioTracks: [
                    { id: 1, label: 'English', selected: true },
                    { id: 2, label: 'German', selected: false },
                ],
            });
            fixture.detectChanges();
            expect(query('[aria-label="Audio tracks"]')).not.toBeNull();
        });

        it('shows speed and aspect controls per their capabilities', () => {
            setCapabilities({ playbackSpeed: true, aspectRatio: true });
            fixture.detectChanges();
            expect(query('[aria-label="Playback speed"]')).not.toBeNull();
            expect(query('[aria-label="Aspect ratio"]')).not.toBeNull();
        });

        it('shows the fullscreen button when supported', () => {
            setCapabilities({ fullscreen: true });
            fixture.detectChanges();
            expect(query('[aria-label="Enter fullscreen"]')).not.toBeNull();
        });
    });

    describe('command wiring', () => {
        it('toggles play/pause', () => {
            query('[aria-label="Play"]')?.click();
            expect(fake.commands.togglePlay).toHaveBeenCalledTimes(1);
        });

        it('presents errors as non-playing and disables playback toggles', () => {
            setState({ status: 'error' });
            fixture.detectChanges();

            const play = query('[aria-label="Play"]') as HTMLButtonElement;
            expect(play.disabled).toBe(true);

            fixture.componentInstance.togglePlay();
            expect(fake.commands.togglePlay).not.toHaveBeenCalled();
        });

        it('seeks via the ±10s buttons when seeking is possible', () => {
            setCapabilities({ seek: true });
            setState({ canSeek: true, durationSeconds: 600 });
            fixture.detectChanges();

            query('[aria-label="Forward 10 seconds"]')?.click();
            query('[aria-label="Back 10 seconds"]')?.click();
            expect(fake.commands.seekBy).toHaveBeenCalledWith(10);
            expect(fake.commands.seekBy).toHaveBeenCalledWith(-10);
        });

        it('selects an audio track', () => {
            setCapabilities({ audioTracks: true });
            setState({
                audioTracks: [
                    { id: 1, label: 'English', selected: true },
                    { id: 2, label: 'German', selected: false },
                ],
            });
            fixture.detectChanges();

            query('[aria-label="Audio tracks"]')?.click();
            fixture.detectChanges();
            const items = fixture.nativeElement.querySelectorAll(
                '.player-controls__track'
            ) as NodeListOf<HTMLElement>;
            items[1].click();
            expect(fake.commands.setAudioTrack).toHaveBeenCalledWith(2);
        });

        it('disables the timeline when seeking is not possible', () => {
            setCapabilities({ seek: true });
            fixture.detectChanges();
            const slider = query(
                '.player-controls__slider'
            ) as HTMLInputElement | null;
            expect(slider?.disabled).toBe(true);

            setState({ canSeek: true, durationSeconds: 600 });
            fixture.detectChanges();
            const seekable = query(
                '.player-controls__slider'
            ) as HTMLInputElement | null;
            expect(seekable?.disabled).toBe(false);
        });

        it('gives the timeline slider an accessible name', () => {
            setCapabilities({ seek: true });
            fixture.detectChanges();
            expect(query('[aria-label="Playback position"]')).not.toBeNull();
        });

        it('localizes mute feedback through the active locale', () => {
            const translate = TestBed.inject(TranslateService);
            translate.setTranslation('de', {
                EMBEDDED_MPV: { PLAYER: { MUTED: 'Stumm' } },
            });
            translate.use('de');
            setCapabilities({ volume: true });
            fixture.detectChanges();

            fixture.componentInstance.volumeInteractions.toggleMute();

            expect(fixture.componentInstance.feedback.current()?.label).toBe(
                'Stumm'
            );
        });
    });

    describe('auto-hide', () => {
        const bar = () => query('.player-controls__bar') as HTMLElement | null;

        beforeEach(() => {
            jest.useFakeTimers();
            // Auto-hide only runs while playing.
            setState({ status: 'playing' });
            fixture.detectChanges();
        });

        afterEach(() => {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        });

        it('does NOT hide while the bar is hovered, then hides after leave', () => {
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);

            bar()?.dispatchEvent(new MouseEvent('pointerenter'));
            fixture.detectChanges();

            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            // Still visible: the pointer rests over the bar.
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);

            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            fixture.detectChanges();

            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            // Now it auto-hides.
            expect(fixture.componentInstance.controlsAreVisible()).toBe(false);
        });

        it('reveals on focus, stays visible within the bar, and hides after focus leaves', () => {
            setCapabilities({ seek: true });
            setState({
                status: 'playing',
                canSeek: true,
                durationSeconds: 600,
            });
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(fixture.componentInstance.controlsAreVisible()).toBe(false);

            const buttons = Array.from(
                bar()?.querySelectorAll('button') ?? []
            ) as HTMLButtonElement[];
            buttons[0].focus();
            fixture.detectChanges();
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);

            jest.advanceTimersByTime(10000);
            buttons[1].focus();
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);

            const outside = document.createElement('button');
            document.body.appendChild(outside);
            outside.focus();
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(fixture.componentInstance.controlsAreVisible()).toBe(false);
            outside.remove();
        });

        it('does not pin the bar on the focus a mouse click on a control produces', () => {
            setCapabilities({ fullscreen: true });
            setState({ status: 'playing' });
            const surface = document.createElement('div');
            document.body.appendChild(surface);
            (
                surface as unknown as { requestFullscreen: unknown }
            ).requestFullscreen = jest.fn(() => Promise.resolve());
            (
                document as unknown as { exitFullscreen: unknown }
            ).exitFullscreen = jest.fn(() => Promise.resolve());
            fixture.componentRef.setInput('playerSurface', surface);
            fixture.detectChanges();

            const button = query(
                '[aria-label="Enter fullscreen"]'
            ) as HTMLButtonElement;
            const icon = button.querySelector('mat-icon') as HTMLElement;
            // Chromium: pointerdown on the icon, focus moves to the button
            // (focusin on the bar), then click — all from one mouse press.
            bar()?.dispatchEvent(new MouseEvent('pointerenter'));
            icon.dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            button.focus();
            button.click();
            fixture.detectChanges();
            expect(document.activeElement).toBe(button);
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);

            // The pointer leaves the bar and moves over the video while the
            // button is still the active element.
            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            surface.dispatchEvent(new MouseEvent('pointermove'));
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(fixture.componentInstance.controlsAreVisible()).toBe(false);

            surface.remove();
            delete (document as unknown as { exitFullscreen?: unknown })
                .exitFullscreen;
        });

        it('still pins the bar for keyboard focus that follows a click on the video', () => {
            const surface = document.createElement('div');
            document.body.appendChild(surface);
            fixture.componentRef.setInput('playerSurface', surface);
            fixture.detectChanges();

            // A click on the viewport, then Tab into the bar within a second:
            // the press did not land on the focused control, so it is
            // keyboard navigation and keeps the controls visible.
            surface.dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            const buttons = Array.from(
                bar()?.querySelectorAll('button') ?? []
            ) as HTMLButtonElement[];
            buttons[0].focus();
            fixture.detectChanges();
            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);
            surface.remove();
        });

        it('releases a keyboard pin when the mouse clicks another bar control', () => {
            setCapabilities({ seek: true });
            setState({
                status: 'playing',
                canSeek: true,
                durationSeconds: 600,
            });
            fixture.detectChanges();
            const buttons = Array.from(
                bar()?.querySelectorAll('button') ?? []
            ) as HTMLButtonElement[];
            // Tab into the bar: pinned.
            buttons[0].focus();
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);

            // Mouse click on a different control. The focus transfer stays
            // inside the bar, which focusout ignores by design.
            bar()?.dispatchEvent(new MouseEvent('pointerenter'));
            buttons[1].dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            buttons[1].focus();
            buttons[1].click();
            fixture.detectChanges();
            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(fixture.componentInstance.controlsAreVisible()).toBe(false);
        });

        it('releases a keyboard pin when the mouse clicks the focused control itself', () => {
            const buttons = Array.from(
                bar()?.querySelectorAll('button') ?? []
            ) as HTMLButtonElement[];
            buttons[0].focus();
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);

            // Clicking the already focused button produces no focus event.
            bar()?.dispatchEvent(new MouseEvent('pointerenter'));
            buttons[0].dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            buttons[0].click();
            fixture.detectChanges();
            expect(document.activeElement).toBe(buttons[0]);
            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(fixture.componentInstance.controlsAreVisible()).toBe(false);
        });

        it('pins again when keyboard focus returns to the clicked control within the window', () => {
            setCapabilities({ seek: true });
            setState({
                status: 'playing',
                canSeek: true,
                durationSeconds: 600,
            });
            fixture.detectChanges();
            const buttons = Array.from(
                bar()?.querySelectorAll('button') ?? []
            ) as HTMLButtonElement[];

            // Mouse click on the second control...
            bar()?.dispatchEvent(new MouseEvent('pointerenter'));
            buttons[1].dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            buttons[1].focus();
            buttons[1].click();
            fixture.detectChanges();
            // ...then Shift+Tab away and Tab back before the press expires.
            buttons[0].focus();
            buttons[1].focus();
            fixture.detectChanges();

            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(document.activeElement).toBe(buttons[1]);
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);
        });

        it('pins again after a click on the focused control, Tab away and Shift+Tab back', () => {
            setCapabilities({ seek: true });
            setState({
                status: 'playing',
                canSeek: true,
                durationSeconds: 600,
            });
            fixture.detectChanges();
            const buttons = Array.from(
                bar()?.querySelectorAll('button') ?? []
            ) as HTMLButtonElement[];
            const tab = (shift: boolean) =>
                document.dispatchEvent(
                    new KeyboardEvent('keydown', {
                        key: 'Tab',
                        shiftKey: shift,
                        bubbles: true,
                    })
                );

            // Keyboard focus on the second control, then a mouse click on
            // it: no focus event, so the press record is not consumed.
            buttons[1].focus();
            fixture.detectChanges();
            bar()?.dispatchEvent(new MouseEvent('pointerenter'));
            buttons[1].dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            buttons[1].click();
            fixture.detectChanges();
            // Tab to the next control and Shift+Tab back within the window.
            tab(false);
            buttons[2].focus();
            tab(true);
            buttons[1].focus();
            fixture.detectChanges();

            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(document.activeElement).toBe(buttons[1]);
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);
        });

        it('pins the bar when the keyboard operates a mouse-focused control', () => {
            setCapabilities({ seek: true });
            setState({
                status: 'playing',
                canSeek: true,
                durationSeconds: 600,
            });
            fixture.detectChanges();
            const buttons = Array.from(
                bar()?.querySelectorAll('button') ?? []
            ) as HTMLButtonElement[];

            // Mouse click leaves the control focused but not pinned...
            bar()?.dispatchEvent(new MouseEvent('pointerenter'));
            buttons[1].dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            buttons[1].focus();
            buttons[1].click();
            fixture.detectChanges();
            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            fixture.detectChanges();

            // ...then Space on that control: no focus event, but keyboard use.
            buttons[1].dispatchEvent(
                new KeyboardEvent('keydown', { key: ' ', bubbles: true })
            );
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(document.activeElement).toBe(buttons[1]);
            expect(fixture.componentInstance.controlsAreVisible()).toBe(true);

            // Focus leaving the bar releases the pin again.
            const outside = document.createElement('button');
            document.body.appendChild(outside);
            outside.focus();
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(fixture.componentInstance.controlsAreVisible()).toBe(false);
            outside.remove();
        });
    });

    describe('bar-hover state', () => {
        const bar = () => query('.player-controls__bar') as HTMLElement | null;

        it('tracks barHovered on bar pointerenter / pointerleave', () => {
            expect(fixture.componentInstance.barHovered()).toBe(false);

            bar()?.dispatchEvent(new MouseEvent('pointerenter'));
            expect(fixture.componentInstance.barHovered()).toBe(true);

            bar()?.dispatchEvent(new MouseEvent('pointerleave'));
            expect(fixture.componentInstance.barHovered()).toBe(false);
        });
    });

    describe('keyboard shortcuts', () => {
        const dispatchSpace = () =>
            document.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: ' ',
                    bubbles: true,
                    cancelable: true,
                })
            );

        it('toggles play on Space when controls are visible', () => {
            dispatchSpace();
            expect(fake.commands.togglePlay).toHaveBeenCalledTimes(1);
        });

        it('does not toggle play on Space when controls are hidden', () => {
            fixture.componentRef.setInput('showControls', false);
            fixture.detectChanges();

            dispatchSpace();
            expect(fake.commands.togglePlay).not.toHaveBeenCalled();
        });
    });

    describe('episode navigation outputs', () => {
        it('emits previous/next episode requests when navigable', () => {
            const previous = jest.fn();
            const next = jest.fn();
            fixture.componentInstance.previousEpisodeRequested.subscribe(
                previous
            );
            fixture.componentInstance.nextEpisodeRequested.subscribe(next);

            setCapabilities({ seriesNavigation: true });
            setState({ canPreviousEpisode: true, canNextEpisode: true });
            fixture.detectChanges();

            query('[data-test-id="player-controls-previous-episode"]')?.click();
            query('[data-test-id="player-controls-next-episode"]')?.click();

            expect(previous).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledTimes(1);
        });
    });
});
