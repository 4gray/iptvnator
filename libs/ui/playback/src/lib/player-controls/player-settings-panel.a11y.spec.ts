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
        audioTracks: true,
        subtitles: true,
        externalSubtitles: true,
        subtitleDelay: true,
        subtitleStyle: true,
        qualityLevels: true,
        playbackSpeed: true,
        aspectRatio: true,
    });
    const state: WritableSignal<PlayerControlsState> = signal({
        ...createEmptyControlsState(),
        audioTracks: [
            { id: 1, label: 'English', selected: true },
            { id: 2, label: 'German', selected: false },
        ],
        subtitleTracks: [{ id: 5, label: 'Russian', selected: false }],
        qualityLevels: [
            { id: 0, label: '720p', selected: false },
            { id: 1, label: '1080p', selected: false },
        ],
    });
    const commands = {
        setAudioTrack: jest.fn(),
        setSubtitleTrack: jest.fn(),
        setPlaybackSpeed: jest.fn(),
        setAspectRatio: jest.fn(),
    } as unknown as jest.Mocked<PlayerControlsCommands>;
    const controller: PlayerController = { capabilities, state, commands };
    return { controller, capabilities, state, commands };
}

const KEY_CODES: Record<string, number> = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Home: 36,
    End: 35,
};

/** A real key press carries its legacy `keyCode`, which CDK key managers read. */
function press(target: HTMLElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });
    Object.defineProperty(event, 'keyCode', { value: KEY_CODES[key] });
    target.dispatchEvent(event);
    return event;
}

/**
 * The settings panel as assistive technology and the keyboard meet it: a
 * dialog named by its heading, radio groups named by theirs with one Tab
 * stop each, arrow keys that move focus without applying, and dock chips
 * whose names carry their values.
 */
describe('PlayerSettingsPanelComponent accessibility', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let component: PlayerControlsComponent;
    let fake: ReturnType<typeof createFakeController>;

    const query = (selector: string) =>
        fixture.nativeElement.querySelector(selector) as HTMLElement | null;
    const radios = (group: string) =>
        Array.from(
            fixture.nativeElement.querySelectorAll(
                `[data-test-id="player-settings-${group}"] [role="radio"]`
            ) as NodeListOf<HTMLButtonElement>
        );
    // List rows carry a check icon beside their label, segments are text
    // and colour swatches are named by `aria-label`.
    const label = (radio: Element) =>
        radio.getAttribute('aria-label') ??
        (radio.querySelector('span') ?? radio).textContent?.trim();
    const tabStops = (group: string) =>
        radios(group)
            .filter((radio) => radio.getAttribute('tabindex') === '0')
            .map(label);
    const openPanel = () => {
        component.settings.open();
        fixture.detectChanges();
    };

    beforeEach(async () => {
        globalThis.ResizeObserver = class {
            observe(): void {
                /* noop */
            }
            unobserve(): void {
                /* noop */
            }
            disconnect(): void {
                /* noop */
            }
        } as unknown as typeof ResizeObserver;
        localStorage.removeItem('volume');
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            EMBEDDED_MPV: {
                PLAYER: {
                    SETTINGS: 'Settings',
                    AUDIO_TRACKS: 'Audio tracks',
                    SUBTITLES: 'Subtitles',
                    SUBTITLES_OFF: 'Off',
                    SUBTITLES_ON: 'On',
                    SUBTITLES_TOOLTIP: 'Subtitles: {{subtitles}}',
                    SUBTITLE_DELAY: 'Subtitle delay',
                    SUBTITLE_SIZE: 'Subtitle size',
                    SUBTITLE_COLOR: 'Subtitle color',
                    SUBTITLE_COLOR_DEFAULT: 'Default',
                    QUALITY: 'Quality',
                    QUALITY_AUTO: 'Auto',
                    PLAYBACK_SPEED: 'Playback speed',
                    SPEED_TOOLTIP: 'Speed: {{speed}}',
                    ASPECT_RATIO: 'Aspect ratio',
                    ASPECT_DEFAULT: 'Default',
                },
            },
        });
        translate.use('en');

        fake = createFakeController();
        fixture = TestBed.createComponent(PlayerControlsComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('controller', fake.controller);
        fixture.detectChanges();
        document.body.appendChild(fixture.nativeElement);
    });

    afterEach(() => {
        fixture.nativeElement.remove();
        fixture.destroy();
        globalThis.ResizeObserver = originalResizeObserver;
    });

    it('names the dialog and every radio group by a real heading', () => {
        openPanel();
        const panel = query('[data-test-id="player-controls-settings-panel"]');
        const title = panel?.querySelector('h2');
        expect(panel?.getAttribute('aria-labelledby')).toBe(title?.id);
        expect(title?.textContent?.trim()).toBe('Settings');

        const groups = Array.from(
            panel?.querySelectorAll('[role="radiogroup"]') ?? []
        ).map((group) => {
            const heading = document.getElementById(
                group.getAttribute('aria-labelledby') ?? ''
            );
            return `${heading?.tagName} ${heading?.textContent?.trim()}`;
        });
        expect(groups).toEqual([
            'H3 Audio tracks',
            'H3 Subtitles',
            'H4 Subtitle size',
            'H4 Subtitle color',
            'H3 Quality',
            'H3 Playback speed',
            'H3 Aspect ratio',
        ]);
        expect(
            document.getElementById(
                query(
                    '[data-test-id="player-controls-subtitle-delay"] [role="group"]'
                )?.getAttribute('aria-labelledby') ?? ''
            )?.textContent
        ).toContain('Subtitle delay');
    });

    it('offers radios only, with the load-file action outside the group', () => {
        openPanel();
        const panel = query(
            '[data-test-id="player-controls-settings-panel"]'
        ) as HTMLElement;

        expect(panel.querySelectorAll('[role^="menuitem"]')).toHaveLength(0);
        const radioParents = Array.from(
            panel.querySelectorAll('[role="radio"]')
        ).map((radio) => radio.parentElement?.getAttribute('role'));
        expect(radioParents.length).toBeGreaterThan(0);
        expect(new Set(radioParents)).toEqual(new Set(['radiogroup']));

        const load = query('[data-test-id="player-controls-load-subtitle"]');
        expect(load?.hasAttribute('role')).toBe(false);
        expect(load?.closest('[role="radiogroup"]')).toBeNull();
    });

    it('gives each group one Tab stop on its checked option, else the first', () => {
        fake.state.update((state) => ({ ...state, playbackSpeed: 1.1 }));
        openPanel();

        expect(tabStops('audio')).toEqual(['English']);
        // Tracks, then the subtitle size and colour groups of the section.
        expect(tabStops('subtitles')).toEqual(['Off', '100%', 'Default']);
        expect(tabStops('quality')).toEqual(['Auto']);
        // No preset matches 1.1×: the first option keeps the group reachable.
        expect(tabStops('speed')).toEqual(['0.5×']);
        expect(tabStops('aspect')).toEqual(['Default']);
    });

    it('moves focus with the arrow keys, Home and End and checks the option reached', () => {
        openPanel();
        const checked = radios('speed').find(
            (radio) => radio.getAttribute('aria-checked') === 'true'
        ) as HTMLButtonElement;
        checked.focus();
        expect(checked.textContent?.trim()).toBe('1×');

        expect(press(checked, 'ArrowRight').defaultPrevented).toBe(true);
        fixture.detectChanges();
        expect(document.activeElement?.textContent?.trim()).toBe('1.25×');
        expect(tabStops('speed')).toEqual(['1.25×']);

        // The ends wrap, as in a native radio group.
        const reached = [
            'ArrowDown',
            'ArrowUp',
            'ArrowLeft',
            'End',
            'ArrowRight',
            'ArrowLeft',
            'Home',
        ].map((key) => {
            press(document.activeElement as HTMLElement, key);
            return document.activeElement?.textContent?.trim();
        });
        expect(reached).toEqual([
            '1.5×',
            '1.25×',
            '1×',
            '2×',
            '0.5×',
            '2×',
            '0.5×',
        ]);
        // Every move applies its option, 1× included: the (fake) engine
        // still reports 1× checked, but 1.25× is the pending request.
        expect(
            fake.commands.setPlaybackSpeed.mock.calls.map(([speed]) => speed)
        ).toEqual([1.25, 1.5, 1.25, 1, 2, 0.5, 2, 0.5]);
    });

    it('keeps arrow keys inside their own group', () => {
        openPanel();
        const [english, german] = radios('audio');
        english.focus();
        press(english, 'ArrowDown');
        expect(document.activeElement).toBe(german);
        press(german, 'ArrowDown');
        expect(document.activeElement).toBe(english);
        // Returning before the engine confirms the first switch applies
        // English again; otherwise the pending switch would win.
        expect(fake.commands.setAudioTrack.mock.calls).toEqual([[2], [1]]);
        expect(fake.commands.setPlaybackSpeed).not.toHaveBeenCalled();
    });

    it('hands the Tab stop back to the reported checked option when focus leaves', () => {
        // The fake engine never confirms the switch the arrow key requested,
        // so English stays the checked track.
        openPanel();
        const [english, german] = radios('audio');
        english.focus();
        press(english, 'ArrowDown');
        fixture.detectChanges();
        expect(tabStops('audio')).toEqual(['German']);
        expect(german.tabIndex).toBe(0);

        query('[data-test-id="player-settings-close"]')?.focus();
        fixture.detectChanges();
        expect(tabStops('audio')).toEqual(['English']);
    });

    it('reverses the horizontal arrows in a right-to-left layout', () => {
        openPanel();
        const speed = radios('speed');
        (speed[0].parentElement as HTMLElement).style.direction = 'rtl';
        speed[2].focus();

        press(speed[2], 'ArrowLeft');
        expect(document.activeElement).toBe(speed[3]);
        press(speed[3], 'ArrowRight');
        expect(document.activeElement).toBe(speed[2]);
    });

    it('names the chips with their current values', () => {
        const subtitleChip = () =>
            query('[data-test-id="player-controls-subtitle-chip"]');
        const speedChip = () =>
            query('[data-test-id="player-controls-speed-chip"]');
        expect(subtitleChip()?.getAttribute('aria-label')).toBe(
            'Subtitles: Off'
        );
        expect(speedChip()?.getAttribute('aria-label')).toBe('Speed: 1×');

        fake.state.update((state) => ({
            ...state,
            subtitleTracks: [{ id: 5, label: 'Russian', selected: true }],
            subtitlesEnabled: true,
            playbackSpeed: 1.25,
        }));
        fixture.detectChanges();

        expect(subtitleChip()?.getAttribute('aria-label')).toBe(
            'Subtitles: Russian'
        );
        expect(speedChip()?.getAttribute('aria-label')).toBe('Speed: 1.25×');
    });

    it('names the subtitle chip "On" while no enabled track is marked selected', () => {
        // The engine can report subtitles on before the track list marks the
        // selected track; the chip must not claim they are off.
        fake.state.update((state) => ({
            ...state,
            subtitleTracks: [{ id: 5, label: 'Russian', selected: false }],
            subtitlesEnabled: true,
        }));
        fixture.detectChanges();

        const chip = query('[data-test-id="player-controls-subtitle-chip"]');
        expect(chip?.getAttribute('aria-label')).toBe('Subtitles: On');
        expect(
            chip?.querySelector('.player-controls__chip-label')?.textContent
        ).toContain('On');
    });

    it('announces that the tune button opens a dialog', () => {
        const tune = query('[data-test-id="player-controls-settings-button"]');
        expect(tune?.getAttribute('aria-haspopup')).toBe('dialog');
        expect(tune?.getAttribute('aria-expanded')).toBe('false');
    });
});
