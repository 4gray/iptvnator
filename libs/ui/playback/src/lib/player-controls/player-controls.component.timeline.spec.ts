import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import { PlayerControlsComponent } from './player-controls.component';
import type {
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerController,
} from './player-controls.model';

function createFakeController() {
    const capabilities = signal({ ...DEFAULT_PLAYER_CAPABILITIES });
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
        togglePictureInPicture: jest.fn(),
    };
    const controller: PlayerController = {
        capabilities,
        state,
        commands,
    };
    return { controller, capabilities, state, commands };
}

describe('PlayerControlsComponent timeline scrubbing', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let fake: ReturnType<typeof createFakeController>;

    const setState = (overrides: Partial<PlayerControlsState>) =>
        fake.state.set({ ...createEmptyControlsState(), ...overrides });

    const slider = () =>
        fixture.nativeElement.querySelector(
            '.player-controls__slider'
        ) as HTMLInputElement;

    const currentTimeText = () =>
        (
            fixture.nativeElement.querySelector(
                '.player-controls__time > span:first-child'
            ) as HTMLElement
        ).textContent;

    const dispatch = (
        type: 'input' | 'change',
        value: string,
        rawValue = false
    ) => {
        const element = slider();
        if (rawValue) {
            Object.defineProperty(element, 'value', {
                configurable: true,
                value,
                writable: true,
            });
        } else {
            element.value = value;
        }
        element.dispatchEvent(new Event(type, { bubbles: true }));
        fixture.detectChanges();
        return element;
    };

    beforeEach(async () => {
        localStorage.removeItem('volume');
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        fake = createFakeController();
        fixture = TestBed.createComponent(PlayerControlsComponent);
        fixture.componentRef.setInput('controller', fake.controller);
        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: true,
        });
        setState({
            canSeek: true,
            durationSeconds: 600,
            positionSeconds: 30,
        });
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('previews timeline input locally without seeking', () => {
        const element = dispatch('input', '120');

        expect(fake.commands.seekTo).not.toHaveBeenCalled();
        expect(element.value).toBe('120');
        expect(element.style.getPropertyValue('--slider-progress')).toBe('20%');
        expect(element.getAttribute('aria-valuetext')).toBe('2:00');
        expect(currentTimeText()).toBe('2:00');
    });

    it('keeps the local preview while controller position updates', () => {
        dispatch('input', '60');

        setState({
            canSeek: true,
            durationSeconds: 600,
            positionSeconds: 45,
        });
        fixture.detectChanges();

        expect(fake.commands.seekTo).not.toHaveBeenCalled();
        expect(slider().value).toBe('60');
        expect(slider().getAttribute('aria-valuetext')).toBe('1:00');
        expect(currentTimeText()).toBe('1:00');
    });

    it('clears the local preview when controller state becomes non-seekable', () => {
        dispatch('input', '120');

        setState({
            canSeek: false,
            isLive: true,
            positionSeconds: 5,
        });
        fixture.detectChanges();

        expect(fixture.componentInstance.scrubPosition()).toBeNull();
        expect(currentTimeText()).toBe('0:05');
    });

    it('does not resurrect a preview after seek capability is restored', () => {
        dispatch('input', '120');

        fake.capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES });
        fixture.detectChanges();
        expect(fixture.componentInstance.scrubPosition()).toBeNull();
        expect(slider()).toBeNull();

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: true,
        });
        setState({
            canSeek: true,
            durationSeconds: 300,
            positionSeconds: 15,
        });
        fixture.detectChanges();

        expect(slider().value).toBe('15');
        expect(currentTimeText()).toBe('0:15');
    });

    it('commits exactly one seek on change and clears the preview', () => {
        dispatch('input', '55');
        dispatch('input', '60');

        expect(fake.commands.seekTo).not.toHaveBeenCalled();
        expect(currentTimeText()).toBe('1:00');

        const element = dispatch('change', '60');

        expect(fake.commands.seekTo).toHaveBeenCalledTimes(1);
        expect(fake.commands.seekTo).toHaveBeenCalledWith(60);
        expect(element.value).toBe('30');
        expect(element.style.getPropertyValue('--slider-progress')).toBe('5%');
        expect(element.getAttribute('aria-valuetext')).toBe('0:30');
        expect(currentTimeText()).toBe('0:30');
    });

    it.each([
        ['below', '-10', 0, '0:00'],
        ['above', '999', 600, '10:00'],
    ])(
        'clamps %s-range scrub values before commit',
        (_boundary, raw, expected, expectedTime) => {
            const element = dispatch('input', raw, true);

            expect(fake.commands.seekTo).not.toHaveBeenCalled();
            expect(element.getAttribute('aria-valuetext')).toBe(expectedTime);
            expect(currentTimeText()).toBe(expectedTime);

            dispatch('change', raw, true);
            expect(fake.commands.seekTo).toHaveBeenCalledTimes(1);
            expect(fake.commands.seekTo).toHaveBeenCalledWith(expected);
        }
    );

    it('ignores invalid scrub values without seeking', () => {
        dispatch('input', 'not-a-number', true);
        dispatch('change', 'not-a-number', true);

        expect(fake.commands.seekTo).not.toHaveBeenCalled();
        expect(currentTimeText()).toBe('0:30');
    });
});
