import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
        setPlaybackSpeed: jest.fn(),
        setAspectRatio: jest.fn(),
        toggleRecording: jest.fn(),
    };
    const controller: PlayerController = { capabilities, state, commands };
    return { controller, capabilities, state, commands };
}

describe('PlayerControlsComponent interactions', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let component: PlayerControlsComponent;
    let fake: ReturnType<typeof createFakeController>;

    const setCapabilities = (overrides: Partial<PlayerControlsCapabilities>) =>
        fake.capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES, ...overrides });

    const setState = (overrides: Partial<PlayerControlsState>) =>
        fake.state.set({ ...createEmptyControlsState(), ...overrides });

    const query = (selector: string) =>
        fixture.nativeElement.querySelector(selector) as HTMLElement | null;

    const queryAll = (selector: string) =>
        Array.from(
            fixture.nativeElement.querySelectorAll(selector)
        ) as HTMLElement[];

    beforeEach(async () => {
        localStorage.removeItem('volume');
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fake = createFakeController();
        fixture = TestBed.createComponent(PlayerControlsComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('controller', fake.controller);
        fixture.detectChanges();
    });

    describe('timeline', () => {
        it('ignores seekBy while the stream cannot seek', () => {
            setState({ canSeek: false });
            fixture.detectChanges();

            component.seekBy(10);
            expect(fake.commands.seekBy).not.toHaveBeenCalled();
            expect(component.feedback.current()).toBeNull();
        });

        it('flashes seek feedback with a signed label', () => {
            jest.useFakeTimers();
            setCapabilities({ seek: true });
            setState({ canSeek: true, durationSeconds: 600 });
            fixture.detectChanges();

            component.seekBy(-10);
            fixture.detectChanges();

            expect(fake.commands.seekBy).toHaveBeenCalledWith(-10);
            const feedback = query('.player-controls__feedback');
            expect(feedback?.textContent).toContain('replay_10');
            expect(feedback?.textContent).toContain('-10s');

            jest.advanceTimersByTime(800);
            fixture.detectChanges();
            expect(query('.player-controls__feedback')).toBeNull();
            jest.useRealTimers();
        });
    });

    describe('volume', () => {
        beforeEach(() => {
            setCapabilities({ volume: true });
            fixture.detectChanges();
        });

        it('opens the popover on hover and applies slider input', () => {
            component.onVolumeHoverEnter();
            fixture.detectChanges();

            const slider = query(
                '.player-controls__slider--volume'
            ) as HTMLInputElement;
            expect(slider).not.toBeNull();

            slider.value = '0.3';
            slider.dispatchEvent(new Event('input'));
            expect(fake.commands.setVolume).toHaveBeenCalledWith(0.3);
            expect(component.displayVolume()).toBe(0.3);
        });

        it('closes the popover shortly after hover leave', () => {
            jest.useFakeTimers();
            component.onVolumeHoverEnter();
            fixture.detectChanges();
            expect(component.menus.volumeOpen()).toBe(true);

            component.onVolumeHoverLeave();
            jest.advanceTimersByTime(300);
            fixture.detectChanges();
            expect(component.menus.volumeOpen()).toBe(false);
            jest.useRealTimers();
        });

        it('adjusts volume via wheel and flashes feedback', () => {
            component.onVolumeWheel(
                new WheelEvent('wheel', { deltaY: 100, cancelable: true })
            );
            expect(fake.commands.setVolume).toHaveBeenCalledWith(0.95);
            expect(component.feedback.current()?.label).toBe('95%');

            component.onVolumeWheel(new WheelEvent('wheel', { deltaY: -100 }));
            expect(fake.commands.setVolume).toHaveBeenLastCalledWith(1);
        });

        it('mutes on click and restores the previous volume on unmute', () => {
            const muteButton = query('[aria-label="EMBEDDED_MPV.PLAYER.MUTE"]');
            muteButton?.click();
            fixture.detectChanges();

            expect(fake.commands.setVolume).toHaveBeenCalledWith(0);
            expect(component.displayVolume()).toBe(0);
            expect(component.volumeIcon()).toBe('volume_off');

            query('[aria-label="EMBEDDED_MPV.PLAYER.UNMUTE"]')?.click();
            expect(fake.commands.setVolume).toHaveBeenLastCalledWith(1);
            expect(component.displayVolume()).toBe(1);
        });

        it('reconciles the optimistic volume with controller state', () => {
            setState({ volume: 0.25 });
            fixture.detectChanges();
            expect(component.displayVolume()).toBe(0.25);
            expect(component.volumePercent()).toBe(25);
        });

        it('keeps optimistic volume across capability and visibility changes', () => {
            component.onVolumeWheel(new WheelEvent('wheel', { deltaY: 100 }));
            expect(component.displayVolume()).toBe(0.95);

            setState({ positionSeconds: 15, volume: 1 });
            fixture.detectChanges();
            expect(component.displayVolume()).toBe(0.95);

            setCapabilities({ volume: true, playbackSpeed: true });
            fixture.detectChanges();
            expect(component.displayVolume()).toBe(0.95);

            fixture.componentRef.setInput('showControls', false);
            fixture.detectChanges();
            expect(component.displayVolume()).toBe(0.95);
        });

        it('reapplies persisted volume when the capability returns', () => {
            component.onVolumeWheel(new WheelEvent('wheel', { deltaY: 100 }));
            fake.commands.setVolume.mockClear();

            setCapabilities({ volume: false });
            setState({ volume: 1 });
            fixture.detectChanges();
            setCapabilities({ volume: true });
            fixture.detectChanges();

            expect(fake.commands.setVolume).toHaveBeenCalledTimes(1);
            expect(fake.commands.setVolume).toHaveBeenCalledWith(0.95);
            expect(component.displayVolume()).toBe(0.95);
        });

        it('reconciles volume when the controller changes at the same value', () => {
            component.onVolumeWheel(new WheelEvent('wheel', { deltaY: 100 }));
            expect(component.displayVolume()).toBe(0.95);
            localStorage.removeItem('volume');

            const replacement = createFakeController();
            replacement.capabilities.set({
                ...DEFAULT_PLAYER_CAPABILITIES,
                volume: true,
            });
            fixture.componentRef.setInput('controller', replacement.controller);
            fixture.detectChanges();

            expect(component.displayVolume()).toBe(1);
        });
    });

    describe('menu selections', () => {
        it('applies a speed preset and closes the menu', () => {
            setCapabilities({ playbackSpeed: true });
            fixture.detectChanges();

            query('[aria-label="EMBEDDED_MPV.PLAYER.PLAYBACK_SPEED"]')?.click();
            fixture.detectChanges();
            expect(component.menus.speedOpen()).toBe(true);

            const preset = queryAll('.player-controls__track').find((item) =>
                item.textContent?.includes('1.5×')
            );
            preset?.click();
            fixture.detectChanges();

            expect(fake.commands.setPlaybackSpeed).toHaveBeenCalledWith(1.5);
            expect(component.menus.speedOpen()).toBe(false);
        });

        it('applies an aspect preset and closes the menu', () => {
            setCapabilities({ aspectRatio: true });
            fixture.detectChanges();

            query('[aria-label="EMBEDDED_MPV.PLAYER.ASPECT_RATIO"]')?.click();
            fixture.detectChanges();

            const preset = queryAll('.player-controls__track').find((item) =>
                item.textContent?.includes('16:9')
            );
            preset?.click();
            fixture.detectChanges();

            expect(fake.commands.setAspectRatio).toHaveBeenCalledWith('16:9');
            expect(component.menus.aspectOpen()).toBe(false);
        });

        it('disables subtitles via the Off entry', () => {
            setCapabilities({ subtitles: true });
            setState({
                subtitleTracks: [{ id: 1, label: 'English', selected: true }],
                subtitlesEnabled: true,
            });
            fixture.detectChanges();

            query('[aria-label="EMBEDDED_MPV.PLAYER.SUBTITLES"]')?.click();
            fixture.detectChanges();

            queryAll('.player-controls__track')[0]?.click();
            expect(fake.commands.setSubtitleTrack).toHaveBeenCalledWith(-1);
            expect(component.menus.subtitleOpen()).toBe(false);
        });

        it('opening one menu closes the others', () => {
            setCapabilities({ playbackSpeed: true, aspectRatio: true });
            fixture.detectChanges();

            component.toggleMenu('speed');
            component.toggleMenu('aspect');
            expect(component.menus.speedOpen()).toBe(false);
            expect(component.menus.aspectOpen()).toBe(true);
            expect(component.anyMenuOpen()).toBe(true);
        });
    });

    describe('recording', () => {
        it('does nothing when recording is not available', () => {
            component.toggleRecording();
            expect(fake.commands.toggleRecording).not.toHaveBeenCalled();
        });

        it('toggles recording when capable and live', () => {
            setCapabilities({ recording: true });
            setState({ isLive: true });
            fixture.detectChanges();

            query('.player-controls__record-button')?.click();
            expect(fake.commands.toggleRecording).toHaveBeenCalledTimes(1);
        });

        it('flashes feedback on recording start and stop transitions', () => {
            const translate = TestBed.inject(TranslateService);
            translate.setTranslation('de', {
                EMBEDDED_MPV: {
                    PLAYER: {
                        RECORDING: 'Aufnahme',
                        RECORDING_SAVED: 'Aufnahme gespeichert',
                    },
                },
            });
            translate.use('de');

            setState({
                isLive: true,
                recording: { active: true, elapsedSeconds: 0, message: null },
            });
            fixture.detectChanges();
            expect(component.feedback.current()?.label).toBe('Aufnahme');

            setState({ isLive: true });
            fixture.detectChanges();
            expect(component.feedback.current()?.label).toBe(
                'Aufnahme gespeichert'
            );
        });
    });

    describe('reveal/hide interplay', () => {
        beforeEach(() => {
            jest.useFakeTimers();
            setState({ status: 'playing' });
            fixture.detectChanges();
        });

        afterEach(() => {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        });

        it('keeps the controls visible while a menu is open, hides after close', () => {
            setCapabilities({ playbackSpeed: true });
            fixture.detectChanges();
            component.toggleMenu('speed');
            fixture.detectChanges();

            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(component.controlsAreVisible()).toBe(true);

            component.menuSelection.speed(1.25);
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(component.controlsAreVisible()).toBe(false);
        });

        it('stays visible while a status message is showing', () => {
            setState({ status: 'playing', statusMessage: 'Buffering…' });
            fixture.detectChanges();

            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(component.controlsAreVisible()).toBe(true);
        });

        it('re-reveals hidden controls on reveal()', () => {
            jest.advanceTimersByTime(10000);
            fixture.detectChanges();
            expect(component.controlsAreVisible()).toBe(false);

            component.reveal();
            fixture.detectChanges();
            expect(component.controlsAreVisible()).toBe(true);
        });
    });
});
