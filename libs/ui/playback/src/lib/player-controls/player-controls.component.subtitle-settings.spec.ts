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
        addExternalSubtitleFile: jest.fn(),
        setSubtitleDelay: jest.fn(),
        setSubtitleStyle: jest.fn(),
        setPlaybackSpeed: jest.fn(),
        setAspectRatio: jest.fn(),
        toggleRecording: jest.fn(),
        togglePictureInPicture: jest.fn(),
    };
    const controller: PlayerController = { capabilities, state, commands };
    return { controller, capabilities, state, commands };
}

describe('PlayerControlsComponent subtitle settings', () => {
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

    const openSubtitleMenu = () => {
        fixture.componentInstance.toggleMenu('subtitle');
        fixture.detectChanges();
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            EMBEDDED_MPV: {
                PLAYER: {
                    SUBTITLES: 'Subtitles',
                    SUBTITLES_OFF: 'Off',
                    LOAD_SUBTITLE_FILE: 'Load subtitle file…',
                    SUBTITLE_DELAY: 'Subtitle delay',
                    SUBTITLE_DELAY_DECREASE: 'Show subtitles earlier',
                    SUBTITLE_DELAY_INCREASE: 'Show subtitles later',
                    SUBTITLE_DELAY_RESET: 'Reset subtitle delay',
                    SUBTITLE_SIZE: 'Subtitle size',
                    SUBTITLE_COLOR: 'Subtitle color',
                    SUBTITLE_COLOR_DEFAULT: 'Default',
                    SUBTITLE_COLOR_WHITE: 'White',
                    SUBTITLE_COLOR_YELLOW: 'Yellow',
                    SUBTITLE_COLOR_CYAN: 'Cyan',
                },
            },
        });
        translate.use('en');

        fake = createFakeController();
        fixture = TestBed.createComponent(PlayerControlsComponent);
        fixture.componentRef.setInput('controller', fake.controller);
        fixture.detectChanges();
    });

    it('renders the subtitle button with zero tracks when external loading exists', () => {
        expect(query('[aria-label="Subtitles"]')).toBeNull();

        setCapabilities({ externalSubtitles: true });
        fixture.detectChanges();

        expect(query('[aria-label="Subtitles"]')).not.toBeNull();
        openSubtitleMenu();
        // No track list entries: no Off row without a selectable track…
        expect(query('.player-controls__track--selected')).toBeNull();
        // …but the load action is present.
        const load = query('[data-test-id="player-controls-load-subtitle"]');
        expect(load).not.toBeNull();
        load?.click();
        expect(fake.commands.addExternalSubtitleFile).toHaveBeenCalledTimes(1);
        fixture.detectChanges();
        // The pick closes the popover (a file dialog opens on top).
        expect(
            query('[data-test-id="player-controls-load-subtitle"]')
        ).toBeNull();
    });

    it('hides the load action, delay, and style sections without the capabilities', () => {
        setCapabilities({ subtitles: true });
        setState({
            subtitleTracks: [{ id: 0, label: 'English', selected: false }],
        });
        fixture.detectChanges();
        openSubtitleMenu();

        expect(
            query('[data-test-id="player-controls-load-subtitle"]')
        ).toBeNull();
        expect(
            query('[data-test-id="player-controls-subtitle-delay"]')
        ).toBeNull();
        expect(
            query('[data-test-id="player-controls-subtitle-style"]')
        ).toBeNull();
    });

    it('steps, displays, and resets the subtitle delay', () => {
        setCapabilities({ subtitles: true, subtitleDelay: true });
        setState({
            subtitleTracks: [{ id: 0, label: 'External', selected: true }],
            subtitlesEnabled: true,
            subtitleDelaySeconds: 0.5,
        });
        fixture.detectChanges();
        openSubtitleMenu();

        const section = query(
            '[data-test-id="player-controls-subtitle-delay"]'
        );
        expect(section).not.toBeNull();
        expect(
            section?.querySelector('.player-controls__subtitle-delay-value')
                ?.textContent
        ).toContain('+0.5 s');

        (
            section?.querySelector(
                '[aria-label="Show subtitles later"]'
            ) as HTMLButtonElement
        ).click();
        expect(fake.commands.setSubtitleDelay).toHaveBeenCalledWith(1);

        (
            section?.querySelector(
                '[aria-label="Show subtitles earlier"]'
            ) as HTMLButtonElement
        ).click();
        expect(fake.commands.setSubtitleDelay).toHaveBeenCalledWith(0);

        (
            section?.querySelector(
                '[aria-label="Reset subtitle delay"]'
            ) as HTMLButtonElement
        ).click();
        expect(fake.commands.setSubtitleDelay).toHaveBeenLastCalledWith(0);
        // The menu stays open for repeated adjustment.
        fixture.detectChanges();
        expect(
            query('[data-test-id="player-controls-subtitle-delay"]')
        ).not.toBeNull();
    });

    it('applies size and color presets through setSubtitleStyle', () => {
        setCapabilities({ subtitles: true, subtitleStyle: true });
        setState({
            subtitleTracks: [{ id: 0, label: 'English', selected: true }],
            subtitlesEnabled: true,
        });
        fixture.detectChanges();
        openSubtitleMenu();

        const style = query(
            '[data-test-id="player-controls-subtitle-style"]'
        ) as HTMLElement;
        const chips = Array.from(
            style.querySelectorAll<HTMLButtonElement>(
                '.player-controls__subtitle-chip'
            )
        );
        const largeChip = chips.find((chip) =>
            chip.textContent?.includes('150%')
        );
        largeChip?.click();
        expect(fake.commands.setSubtitleStyle).toHaveBeenCalledWith({
            sizePercent: 150,
            color: null,
        });

        (
            style.querySelector(
                '[aria-label="Yellow"]'
            ) as HTMLButtonElement
        ).click();
        expect(fake.commands.setSubtitleStyle).toHaveBeenLastCalledWith({
            sizePercent: 100,
            color: '#ffe94f',
        });
    });

    it('guards the new commands behind their capabilities', () => {
        const component = fixture.componentInstance;
        component.loadExternalSubtitle();
        component.subtitleSettings.adjustDelay(0.5);
        component.subtitleSettings.resetDelay();
        component.subtitleSettings.setSize(150);
        component.subtitleSettings.setColor('#ffffff');

        expect(fake.commands.addExternalSubtitleFile).not.toHaveBeenCalled();
        expect(fake.commands.setSubtitleDelay).not.toHaveBeenCalled();
        expect(fake.commands.setSubtitleStyle).not.toHaveBeenCalled();
    });

    it('clamps stepped delays to the supported window', () => {
        setCapabilities({ subtitles: true, subtitleDelay: true });
        setState({
            subtitleTracks: [{ id: 0, label: 'External', selected: true }],
            subtitleDelaySeconds: 60,
        });
        fixture.detectChanges();

        fixture.componentInstance.subtitleSettings.adjustDelay(0.5);
        expect(fake.commands.setSubtitleDelay).toHaveBeenCalledWith(60);
    });
});
