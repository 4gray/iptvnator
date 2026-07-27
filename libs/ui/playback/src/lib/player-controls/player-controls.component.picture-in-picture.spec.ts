import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import { PlayerControlsComponent } from './player-controls.component';
import type {
    PlayerController,
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
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

describe('PlayerControlsComponent picture-in-picture action', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let component: PlayerControlsComponent;
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

    const queryButton = (label: string) =>
        fixture.nativeElement.querySelector(
            `[aria-label="${label}"]`
        ) as HTMLButtonElement | null;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            EMBEDDED_MPV: {
                PLAYER: {
                    ENTER_PICTURE_IN_PICTURE: 'Enter picture-in-picture',
                    EXIT_PICTURE_IN_PICTURE: 'Exit picture-in-picture',
                    ENTER_FULLSCREEN: 'Enter fullscreen',
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

    it('omits the action when picture-in-picture is not supported', () => {
        expect(queryButton('Enter picture-in-picture')).toBeNull();
    });

    it('renders a disabled inactive action when picture-in-picture is unavailable', () => {
        setCapabilities({ pictureInPicture: true });
        fixture.detectChanges();

        const button = queryButton('Enter picture-in-picture');
        expect(button).not.toBeNull();
        expect(button?.disabled).toBe(true);
        expect(button?.getAttribute('aria-pressed')).toBe('false');
    });

    it('renders the active state with its exit label and alternate icon', () => {
        setCapabilities({ pictureInPicture: true });
        setState({
            canPictureInPicture: true,
            pictureInPictureActive: true,
        });
        fixture.detectChanges();

        const button = queryButton('Exit picture-in-picture');
        expect(button).not.toBeNull();
        expect(button?.disabled).toBe(false);
        expect(button?.getAttribute('aria-pressed')).toBe('true');
        expect(button?.querySelector('mat-icon')?.textContent?.trim()).toBe(
            'picture_in_picture_alt'
        );
        button?.click();
        expect(fake.commands.togglePictureInPicture).toHaveBeenCalledTimes(1);
    });

    it('dispatches one toggle command from an available inactive action', () => {
        setCapabilities({ pictureInPicture: true });
        setState({ canPictureInPicture: true });
        fixture.detectChanges();
        const reveal = jest.spyOn(component, 'reveal');

        queryButton('Enter picture-in-picture')?.click();

        expect(reveal).toHaveBeenCalledTimes(1);
        expect(fake.commands.togglePictureInPicture).toHaveBeenCalledTimes(1);
    });

    it('guards the component command when the capability is absent', () => {
        setState({ canPictureInPicture: true });
        const reveal = jest.spyOn(component, 'reveal');

        component.togglePictureInPicture();

        expect(reveal).toHaveBeenCalledTimes(1);
        expect(fake.commands.togglePictureInPicture).not.toHaveBeenCalled();
    });

    it('guards the component command when the action is unavailable', () => {
        setCapabilities({ pictureInPicture: true });
        const reveal = jest.spyOn(component, 'reveal');

        component.togglePictureInPicture();

        expect(reveal).toHaveBeenCalledTimes(1);
        expect(fake.commands.togglePictureInPicture).not.toHaveBeenCalled();
    });

    it('places picture-in-picture immediately before fullscreen', () => {
        setCapabilities({ pictureInPicture: true, fullscreen: true });
        setState({ canPictureInPicture: true });
        fixture.detectChanges();

        const pictureInPicture = queryButton('Enter picture-in-picture');
        const fullscreen = queryButton('Enter fullscreen');
        expect(pictureInPicture).not.toBeNull();
        expect(fullscreen).not.toBeNull();
        expect(pictureInPicture?.nextElementSibling).toBe(fullscreen);
    });
});
