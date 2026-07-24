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
        togglePictureInPicture: jest.fn(),
    };
    const controller: PlayerController = { capabilities, state, commands };
    return { controller, capabilities, state, commands };
}

describe('PlayerControlsComponent fullscreen media title', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let component: PlayerControlsComponent;
    let fake: ReturnType<typeof createFakeController>;
    let surface: HTMLElement;
    let fullscreenElement: Element | null;

    const setState = (overrides: Partial<PlayerControlsState>) =>
        fake.state.set({ ...createEmptyControlsState(), ...overrides });

    const enterFullscreen = () => {
        fullscreenElement = surface;
        document.dispatchEvent(new Event('fullscreenchange'));
        fixture.detectChanges();
    };

    const queryTitle = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="player-controls-media-title"]'
        );

    beforeEach(async () => {
        localStorage.removeItem('volume');
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        surface = document.createElement('div');
        document.body.appendChild(surface);

        fullscreenElement = null;
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });

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

    it('stays hidden outside fullscreen even when a media title is set', () => {
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Some Movie',
            secondary: null,
        });
        fixture.detectChanges();

        expect(queryTitle()).toBeNull();
    });

    it('shows both title lines in fullscreen and hides them again on exit', () => {
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Breaking Code',
            secondary: 'S01E02',
        });
        fixture.detectChanges();
        enterFullscreen();

        const title = queryTitle();
        expect(title).not.toBeNull();
        expect(
            title?.querySelector('.player-controls__title-primary')?.textContent
        ).toContain('Breaking Code');
        expect(
            title?.querySelector('.player-controls__title-secondary')
                ?.textContent
        ).toContain('S01E02');

        fullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
        fixture.detectChanges();
        expect(queryTitle()).toBeNull();
    });

    it('renders a single line when no secondary text is provided', () => {
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Channel One',
            secondary: null,
        });
        fixture.detectChanges();
        enterFullscreen();

        const title = queryTitle();
        expect(title).not.toBeNull();
        expect(
            title?.querySelector('.player-controls__title-secondary')
        ).toBeNull();
    });

    it('stays hidden for a blank primary title and when controls are disabled', () => {
        fixture.componentRef.setInput('mediaTitle', {
            primary: '   ',
            secondary: 'S01E02',
        });
        fixture.detectChanges();
        enterFullscreen();
        expect(queryTitle()).toBeNull();

        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Breaking Code',
            secondary: null,
        });
        fixture.componentRef.setInput('showControls', false);
        fixture.detectChanges();
        expect(queryTitle()).toBeNull();
    });

    it('follows the auto-hide visibility of the controls bar', () => {
        jest.useFakeTimers();
        fixture.componentRef.setInput('mediaTitle', {
            primary: 'Breaking Code',
            secondary: 'S01E02',
        });
        fixture.detectChanges();
        enterFullscreen();

        expect(
            queryTitle()?.classList.contains(
                'player-controls__title--visible'
            )
        ).toBe(true);

        setState({ status: 'playing' });
        fixture.detectChanges();
        jest.advanceTimersByTime(10000);
        fixture.detectChanges();

        expect(component.controlsAreVisible()).toBe(false);
        expect(
            queryTitle()?.classList.contains(
                'player-controls__title--visible'
            )
        ).toBe(false);

        surface.dispatchEvent(new MouseEvent('pointermove'));
        fixture.detectChanges();
        expect(
            queryTitle()?.classList.contains(
                'player-controls__title--visible'
            )
        ).toBe(true);
    });
});
