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

interface FakeController {
    controller: PlayerController;
    capabilities: WritableSignal<PlayerControlsCapabilities>;
    state: WritableSignal<PlayerControlsState>;
    commands: jest.Mocked<PlayerControlsCommands>;
}

function createFakeController(): FakeController {
    const capabilities = signal({ ...DEFAULT_PLAYER_CAPABILITIES });
    const state = signal(createEmptyControlsState());
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
    return {
        controller: { capabilities, state, commands },
        capabilities,
        state,
        commands,
    };
}

describe('PlayerControlsComponent capability contract', () => {
    const fixtures: ComponentFixture<PlayerControlsComponent>[] = [];
    const surfaces: HTMLElement[] = [];

    beforeEach(async () => {
        localStorage.removeItem('volume');
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();
    });

    afterEach(() => {
        for (const fixture of fixtures.splice(0)) {
            fixture.destroy();
        }
        for (const surface of surfaces.splice(0)) {
            surface.remove();
        }
    });

    function createControls(
        fake: FakeController,
        surface: HTMLElement | null = null
    ): ComponentFixture<PlayerControlsComponent> {
        const fixture = TestBed.createComponent(PlayerControlsComponent);
        fixture.componentRef.setInput('controller', fake.controller);
        if (surface) {
            fixture.componentRef.setInput('playerSurface', surface);
        }
        fixture.detectChanges();
        fixtures.push(fixture);
        return fixture;
    }

    function createSurface(): HTMLElement {
        const surface = document.createElement('div');
        document.body.appendChild(surface);
        surfaces.push(surface);
        return surface;
    }

    function pressKey(key: string): boolean {
        const event = new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        document.dispatchEvent(event);
        return event.defaultPrevented;
    }

    it('routes shortcuts to the player the user interacted with most recently', () => {
        const first = createFakeController();
        const second = createFakeController();
        createControls(first, createSurface());
        const secondSurface = createSurface();
        const secondFixture = createControls(second, secondSurface);

        pressKey('k');
        expect(first.commands.togglePlay).toHaveBeenCalledTimes(1);
        expect(second.commands.togglePlay).not.toHaveBeenCalled();

        secondSurface.dispatchEvent(new MouseEvent('pointermove'));
        pressKey('k');
        expect(first.commands.togglePlay).toHaveBeenCalledTimes(1);
        expect(second.commands.togglePlay).toHaveBeenCalledTimes(1);

        secondFixture.destroy();
        fixtures.splice(fixtures.indexOf(secondFixture), 1);
        pressKey('k');
        expect(first.commands.togglePlay).toHaveBeenCalledTimes(2);
    });

    it('requires the volume capability for volume shortcuts', () => {
        const fake = createFakeController();
        const fixture = createControls(fake);

        expect(pressKey('ArrowDown')).toBe(false);
        expect(pressKey('m')).toBe(false);
        expect(fake.commands.setVolume).not.toHaveBeenCalled();

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            volume: true,
        });
        fixture.detectChanges();
        expect(pressKey('ArrowDown')).toBe(true);
        expect(fake.commands.setVolume).toHaveBeenCalledWith(0.95);
    });

    it('applies persisted volume before reconciling the first controller snapshot', () => {
        localStorage.setItem('volume', '0.3');
        const fake = createFakeController();
        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            volume: true,
        });
        fake.state.set({
            ...createEmptyControlsState(),
            volume: 1,
        });

        const fixture = createControls(fake);

        expect(fake.commands.setVolume).toHaveBeenCalledTimes(1);
        expect(fake.commands.setVolume).toHaveBeenCalledWith(0.3);
        expect(fixture.componentInstance.displayVolume()).toBe(0.3);
    });

    it('requires both seek capability and seekable state for seek shortcuts', () => {
        const fake = createFakeController();
        const fixture = createControls(fake);
        fake.state.set({
            ...createEmptyControlsState(),
            canSeek: true,
            durationSeconds: 600,
        });
        fixture.detectChanges();

        expect(pressKey('ArrowRight')).toBe(false);
        expect(fake.commands.seekBy).not.toHaveBeenCalled();

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: true,
        });
        fake.state.set({
            ...createEmptyControlsState(),
            canSeek: false,
            durationSeconds: 600,
        });
        fixture.detectChanges();
        expect(pressKey('ArrowRight')).toBe(false);
        expect(fake.commands.seekBy).not.toHaveBeenCalled();

        fake.state.set({
            ...createEmptyControlsState(),
            canSeek: true,
            durationSeconds: 600,
        });
        fixture.detectChanges();
        expect(pressKey('ArrowRight')).toBe(true);
        expect(fake.commands.seekBy).toHaveBeenCalledWith(5);
    });

    it('closes menus when their runtime availability disappears', () => {
        const fake = createFakeController();
        const fixture = createControls(fake);
        const component = fixture.componentInstance;

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            audioTracks: true,
        });
        fake.state.set({
            ...createEmptyControlsState(),
            audioTracks: [
                { id: 1, label: 'English', selected: true },
                { id: 2, label: 'German', selected: false },
            ],
        });
        fixture.detectChanges();
        component.toggleMenu('audio');
        expect(component.menus.audioOpen()).toBe(true);

        fake.state.set({
            ...createEmptyControlsState(),
            audioTracks: [{ id: 1, label: 'English', selected: true }],
        });
        fixture.detectChanges();
        expect(component.anyMenuOpen()).toBe(false);

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            playbackSpeed: true,
        });
        fixture.detectChanges();
        component.toggleMenu('speed');
        expect(component.menus.speedOpen()).toBe(true);

        fake.capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES });
        fixture.detectChanges();
        expect(component.anyMenuOpen()).toBe(false);

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            volume: true,
        });
        fixture.detectChanges();
        component.onVolumeHoverEnter();
        expect(component.menus.volumeOpen()).toBe(true);

        fixture.componentRef.setInput('showControls', false);
        fixture.detectChanges();
        expect(component.anyMenuOpen()).toBe(false);
    });

    it('hides the scrub slider without hiding live and recording status', () => {
        const fake = createFakeController();
        const fixture = createControls(fake);
        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            recording: true,
        });
        fake.state.set({
            ...createEmptyControlsState(),
            isLive: true,
            recording: {
                active: true,
                elapsedSeconds: 12,
                message: null,
            },
        });
        fixture.detectChanges();

        const root = fixture.nativeElement as HTMLElement;
        expect(
            root.querySelector('.player-controls__timeline > input')
        ).toBeNull();
        expect(
            root.querySelector('.player-controls__live-badge')
        ).not.toBeNull();
        expect(
            root.querySelector('.player-controls__recording-status')
                ?.textContent
        ).toContain('REC 0:12');
    });

    it('does not flash a saved recording across owner handoff', () => {
        const fake = createFakeController();
        const fixture = createControls(fake);
        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            recording: true,
        });
        fake.state.set({
            ...createEmptyControlsState(),
            recording: {
                active: false,
                elapsedSeconds: 0,
                message: null,
                transitionKey: 'session-1',
            },
        });
        fixture.detectChanges();
        fake.state.update((state) => ({
            ...state,
            recording: {
                ...state.recording,
                active: true,
                elapsedSeconds: 12,
            },
        }));
        fixture.detectChanges();
        expect(fixture.componentInstance.feedback.current()?.label).toBe(
            'EMBEDDED_MPV.PLAYER.RECORDING'
        );

        fake.state.set({
            ...createEmptyControlsState(),
            recording: {
                active: false,
                elapsedSeconds: 0,
                message: null,
                transitionKey: 'session-2',
            },
        });
        fixture.detectChanges();

        expect(fixture.componentInstance.feedback.current()).toBeNull();
    });
});
