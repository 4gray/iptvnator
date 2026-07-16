import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
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

describe('PlayerControlsComponent surface, fullscreen and shortcuts', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let component: PlayerControlsComponent;
    let fake: ReturnType<typeof createFakeController>;
    let surface: HTMLElement;
    let fullscreenElement: Element | null;
    let requestFullscreen: jest.Mock;
    let exitFullscreen: jest.Mock;

    const setCapabilities = (overrides: Partial<PlayerControlsCapabilities>) =>
        fake.capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES, ...overrides });

    const setState = (overrides: Partial<PlayerControlsState>) =>
        fake.state.set({ ...createEmptyControlsState(), ...overrides });

    const pressKey = (key: string) =>
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key, cancelable: true })
        );

    beforeEach(async () => {
        localStorage.removeItem('volume');
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        surface = document.createElement('div');
        document.body.appendChild(surface);

        fullscreenElement = null;
        requestFullscreen = jest.fn(async () => {
            fullscreenElement = surface;
            document.dispatchEvent(new Event('fullscreenchange'));
        });
        exitFullscreen = jest.fn(async () => {
            fullscreenElement = null;
            document.dispatchEvent(new Event('fullscreenchange'));
        });
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });
        (surface as HTMLElement & { requestFullscreen: jest.Mock })[
            'requestFullscreen'
        ] = requestFullscreen;
        (document as Document & { exitFullscreen: jest.Mock })[
            'exitFullscreen'
        ] = exitFullscreen;

        fake = createFakeController();
        fixture = TestBed.createComponent(PlayerControlsComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('controller', fake.controller);
        fixture.componentRef.setInput('playerSurface', surface);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        surface.remove();
        jest.useRealTimers();
    });

    describe('surface interactions', () => {
        it('reveals hidden controls on pointer movement over the surface', () => {
            jest.useFakeTimers();
            setState({ status: 'playing' });
            fixture.detectChanges();
            jest.advanceTimersByTime(10000);
            expect(component.controlsAreVisible()).toBe(false);

            surface.dispatchEvent(new MouseEvent('pointermove'));
            expect(component.controlsAreVisible()).toBe(true);
        });

        it('toggles play after a short delay on a plain viewport click', () => {
            jest.useFakeTimers();
            surface.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(fake.commands.togglePlay).not.toHaveBeenCalled();

            jest.advanceTimersByTime(250);
            expect(fake.commands.togglePlay).toHaveBeenCalledTimes(1);
        });

        it('a double-click cancels the pending pause and toggles fullscreen', () => {
            jest.useFakeTimers();
            setCapabilities({ fullscreen: true });
            fixture.detectChanges();

            surface.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            surface.dispatchEvent(
                new MouseEvent('dblclick', { bubbles: true })
            );
            jest.advanceTimersByTime(1000);

            expect(fake.commands.togglePlay).not.toHaveBeenCalled();
            expect(requestFullscreen).toHaveBeenCalledTimes(1);
        });

        it('ignores clicks and double-clicks on interactive elements', () => {
            jest.useFakeTimers();
            setCapabilities({ fullscreen: true });
            fixture.detectChanges();
            const button = document.createElement('button');
            surface.appendChild(button);

            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            jest.advanceTimersByTime(1000);

            expect(fake.commands.togglePlay).not.toHaveBeenCalled();
            expect(requestFullscreen).not.toHaveBeenCalled();
        });

        it('a click while a menu is open dismisses it instead of pausing', () => {
            jest.useFakeTimers();
            component.toggleMenu('speed');
            expect(component.anyMenuOpen()).toBe(true);

            surface.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            jest.advanceTimersByTime(1000);

            expect(component.anyMenuOpen()).toBe(false);
            expect(fake.commands.togglePlay).not.toHaveBeenCalled();
        });

        it('an outside pointerdown closes open menus', () => {
            component.toggleMenu('audio');
            expect(component.anyMenuOpen()).toBe(true);

            document.body.dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            expect(component.anyMenuOpen()).toBe(false);
        });

        it('keeps menus open for pointerdown inside the sibling controls root', () => {
            const controlsRoot = fixture.nativeElement as HTMLElement;
            const popoverChild = document.createElement('button');
            controlsRoot.appendChild(popoverChild);
            document.body.appendChild(controlsRoot);
            component.toggleMenu('audio');

            popoverChild.dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            expect(component.anyMenuOpen()).toBe(true);

            document.body.dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            expect(component.anyMenuOpen()).toBe(false);
        });

        it('an outside pointerdown with no open menus is a no-op', () => {
            expect(component.anyMenuOpen()).toBe(false);
            document.body.dispatchEvent(
                new MouseEvent('pointerdown', { bubbles: true })
            );
            expect(component.anyMenuOpen()).toBe(false);
        });
    });

    describe('fullscreen', () => {
        beforeEach(() => {
            setCapabilities({ fullscreen: true });
            fixture.detectChanges();
        });

        it('enters fullscreen on the surface and tracks the change event', async () => {
            await component.toggleFullscreen();

            expect(requestFullscreen).toHaveBeenCalledTimes(1);
            expect(component.isFullscreen()).toBe(true);
        });

        it('exits fullscreen when the surface is already fullscreen', async () => {
            fullscreenElement = surface;

            await component.toggleFullscreen();

            expect(exitFullscreen).toHaveBeenCalledTimes(1);
            expect(requestFullscreen).not.toHaveBeenCalled();
            expect(component.isFullscreen()).toBe(false);
        });

        it('does nothing when the engine does not support fullscreen', async () => {
            setCapabilities({ fullscreen: false });
            fixture.detectChanges();

            await component.toggleFullscreen();
            expect(requestFullscreen).not.toHaveBeenCalled();
        });
    });

    describe('keyboard shortcuts', () => {
        it('Escape closes an open menu', () => {
            component.toggleMenu('subtitle');
            expect(component.anyMenuOpen()).toBe(true);

            pressKey('Escape');
            expect(component.anyMenuOpen()).toBe(false);
        });

        it('f toggles fullscreen', () => {
            setCapabilities({ fullscreen: true });
            fixture.detectChanges();

            pressKey('f');
            expect(requestFullscreen).toHaveBeenCalledTimes(1);
        });

        it('arrow left/right seek by ±5 seconds', () => {
            setState({ canSeek: true, durationSeconds: 600 });
            fixture.detectChanges();

            pressKey('ArrowRight');
            expect(fake.commands.seekBy).toHaveBeenCalledWith(5);

            pressKey('ArrowLeft');
            expect(fake.commands.seekBy).toHaveBeenCalledWith(-5);
        });

        it('arrow down lowers the volume and flashes feedback', () => {
            pressKey('ArrowDown');

            expect(fake.commands.setVolume).toHaveBeenCalledWith(0.95);
            expect(component.feedback.current()?.label).toBe('95%');
        });

        it('m mutes the player', () => {
            pressKey('m');
            expect(fake.commands.setVolume).toHaveBeenCalledWith(0);
            expect(component.displayVolume()).toBe(0);
        });

        it('ignores playback shortcuts while shortcuts are disabled', () => {
            fixture.componentRef.setInput('shortcutsEnabled', false);
            fixture.detectChanges();

            pressKey(' ');
            pressKey('m');
            expect(fake.commands.togglePlay).not.toHaveBeenCalled();
            expect(fake.commands.setVolume).not.toHaveBeenCalled();
        });
    });

    describe('episode navigation', () => {
        it('emits only when a previous/next episode exists', () => {
            const previous = jest.fn();
            const next = jest.fn();
            component.previousEpisodeRequested.subscribe(previous);
            component.nextEpisodeRequested.subscribe(next);

            component.requestPreviousEpisode();
            component.requestNextEpisode();
            expect(previous).not.toHaveBeenCalled();
            expect(next).not.toHaveBeenCalled();

            setState({ canPreviousEpisode: true, canNextEpisode: true });
            fixture.detectChanges();

            component.requestPreviousEpisode();
            component.requestNextEpisode();
            expect(previous).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledTimes(1);
        });
    });
});
