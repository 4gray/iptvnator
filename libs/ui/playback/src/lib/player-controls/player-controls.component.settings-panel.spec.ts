import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    COMPACT_LAYOUT_MAX_WIDTH,
    ROOMY_LAYOUT_MIN_WIDTH,
} from './controls-layout';
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
 * The settings panel behind the `tune` button: chips on wide players, the
 * panel beside the video, the compact bottom sheet, and the dock changes
 * that come with each.
 */
describe('PlayerControlsComponent settings panel', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let resizeCallbacks: ResizeCallback[];
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let component: PlayerControlsComponent;
    let fake: ReturnType<typeof createFakeController>;

    const query = (selector: string) =>
        fixture.nativeElement.querySelector(selector) as HTMLElement | null;
    const queryAll = (selector: string) =>
        Array.from(
            fixture.nativeElement.querySelectorAll(
                selector
            ) as NodeListOf<HTMLElement>
        );

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

    const withEverything = () => {
        setCapabilities({
            volume: true,
            audioTracks: true,
            subtitles: true,
            externalSubtitles: true,
            playbackSpeed: true,
            aspectRatio: true,
            pictureInPicture: true,
            fullscreen: true,
        });
        setState({
            audioTracks: [
                { id: 1, label: 'English', selected: true },
                { id: 2, label: 'German', selected: false },
            ],
            subtitleTracks: [{ id: 5, label: 'Russian', selected: false }],
            canPictureInPicture: true,
        });
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
                    SETTINGS: 'Settings',
                    CLOSE_SETTINGS: 'Close settings',
                    SUBTITLES: 'Subtitles',
                    SUBTITLES_OFF: 'Off',
                    PLAYBACK_SPEED: 'Playback speed',
                    AUDIO_TRACKS: 'Audio tracks',
                    ASPECT_RATIO: 'Aspect ratio',
                    ASPECT_DEFAULT: 'Default',
                    ENTER_PICTURE_IN_PICTURE: 'Enter picture-in-picture',
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

    afterEach(() => {
        fixture.destroy();
        globalThis.ResizeObserver = originalResizeObserver;
    });

    describe('wide dock', () => {
        beforeEach(withEverything);

        it('shows subtitle and speed chips with their values and state colors', () => {
            const subtitles = query(
                '[data-test-id="player-controls-subtitle-chip"]'
            );
            const speed = query('[data-test-id="player-controls-speed-chip"]');
            expect(subtitles?.textContent).toContain('Off');
            expect(subtitles?.classList).not.toContain(
                'player-controls__chip--on'
            );
            expect(speed?.textContent).toContain('1×');
            expect(speed?.classList).not.toContain(
                'player-controls__chip--modified'
            );

            setState({
                audioTracks: fake.state().audioTracks,
                subtitleTracks: [{ id: 5, label: 'Russian', selected: true }],
                subtitlesEnabled: true,
                playbackSpeed: 1.25,
            });
            fixture.detectChanges();

            expect(
                query('[data-test-id="player-controls-subtitle-chip"]')
                    ?.textContent
            ).toContain('Russian');
            expect(
                query('[data-test-id="player-controls-subtitle-chip"]')
                    ?.classList
            ).toContain('player-controls__chip--on');
            expect(
                query('[data-test-id="player-controls-speed-chip"]')
                    ?.textContent
            ).toContain('1.25×');
            expect(
                query('[data-test-id="player-controls-speed-chip"]')?.classList
            ).toContain('player-controls__chip--modified');
        });

        it('opens the panel on the chip group, shifts the dock and folds the chips away', () => {
            expect(
                query('[data-test-id="player-controls-settings-panel"]')
            ).toBeNull();

            query('[data-test-id="player-controls-speed-chip"]')?.click();
            fixture.detectChanges();

            const panel = query(
                '[data-test-id="player-controls-settings-panel"]'
            );
            expect(panel).not.toBeNull();
            expect(panel?.classList).not.toContain(
                'player-controls__settings--sheet'
            );
            expect(panel?.getAttribute('role')).toBe('dialog');
            const title = panel?.querySelector('h2');
            expect(panel?.getAttribute('aria-labelledby')).toBe(title?.id);
            expect(title?.textContent?.trim()).toBe('Settings');
            expect(
                query('[data-test-id="player-settings-speed"]')?.classList
            ).toContain('player-settings__group--focused');
            expect(query('.player-controls__bar')?.classList).toContain(
                'player-controls__bar--panel-open'
            );
            expect(
                query('[data-test-id="player-controls-speed-chip"]')
            ).toBeNull();
            expect(
                query('[data-test-id="player-controls-subtitle-chip"]')
            ).toBeNull();
            expect(query('[aria-label="Enter picture-in-picture"]')).toBeNull();
            expect(query('[aria-label="Enter fullscreen"]')).not.toBeNull();
            expect(
                query('[data-test-id="player-controls-settings-button"]')
                    ?.classList
            ).toContain('player-controls__tune--active');
        });

        it('renders every available group in order and applies choices in place', () => {
            component.settings.open();
            fixture.detectChanges();

            expect(
                queryAll('.player-settings__group').map((group) =>
                    group.getAttribute('data-group')
                )
            ).toEqual(['audio', 'subtitles', 'speed', 'aspect']);

            queryAll(
                '[data-test-id="player-settings-audio"] .player-settings__option'
            )[1]?.click();
            expect(fake.commands.setAudioTrack).toHaveBeenCalledWith(2);

            const preset = queryAll(
                '[data-test-id="player-settings-aspect"] .player-settings__seg-item'
            ).find((item) => item.textContent?.includes('16:9'));
            preset?.click();
            expect(fake.commands.setAspectRatio).toHaveBeenCalledWith('16:9');
            expect(component.settings.isOpen()).toBe(true);
        });

        it('closes from the panel button and from the tune button', () => {
            component.settings.open();
            fixture.detectChanges();

            query('[data-test-id="player-settings-close"]')?.click();
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-settings-panel"]')
            ).toBeNull();
            expect(query('.player-controls__bar')?.classList).not.toContain(
                'player-controls__bar--panel-open'
            );

            query('[data-test-id="player-controls-settings-button"]')?.click();
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-settings-panel"]')
            ).not.toBeNull();
            query('[data-test-id="player-controls-settings-button"]')?.click();
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-settings-panel"]')
            ).toBeNull();
        });

        it('toggles subtitles from the chip context menu without opening the panel', () => {
            const chip = query(
                '[data-test-id="player-controls-subtitle-chip"]'
            ) as HTMLElement;
            const event = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
            });
            chip.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(true);
            expect(fake.commands.setSubtitleTrack).toHaveBeenCalledWith(5);
            expect(component.settings.isOpen()).toBe(false);
        });

        it('closes the panel once no group is left', () => {
            component.settings.open('audio');
            fixture.detectChanges();

            fake.capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES });
            fixture.detectChanges();

            expect(component.settings.isOpen()).toBe(false);
            expect(
                query('[data-test-id="player-controls-settings-panel"]')
            ).toBeNull();
        });
    });

    describe('wide dock without room for extras', () => {
        beforeEach(() => {
            withEverything();
            resizeTo(ROOMY_LAYOUT_MIN_WIDTH - 1);
        });

        it('stays wide but folds the chips into tune and opens a sheet', () => {
            expect(query('.player-controls__bar')?.classList).not.toContain(
                'player-controls__bar--compact'
            );
            expect(query('.player-controls__slider--inline')).not.toBeNull();
            expect(
                query('[data-test-id="player-controls-speed-chip"]')
            ).toBeNull();
            expect(
                query('[data-test-id="player-controls-subtitle-chip"]')
            ).toBeNull();

            setState({
                audioTracks: fake.state().audioTracks,
                subtitleTracks: [{ id: 5, label: 'Russian', selected: true }],
                subtitlesEnabled: true,
            });
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-settings-dots"]')
            ).not.toBeNull();

            query('[data-test-id="player-controls-settings-button"]')?.click();
            fixture.detectChanges();
            expect(
                query('[data-test-id="player-controls-settings-panel"]')
                    ?.classList
            ).toContain('player-controls__settings--sheet');
            expect(query('.player-controls__bar')?.classList).toContain(
                'player-controls__bar--sheet-open'
            );
            expect(query('.player-controls__bar')?.classList).not.toContain(
                'player-controls__bar--panel-open'
            );
        });
    });

    describe('compact dock', () => {
        beforeEach(() => {
            withEverything();
            resizeTo(COMPACT_LAYOUT_MAX_WIDTH);
        });

        it('folds the chips into the tune button with state dots', () => {
            expect(
                query('[data-test-id="player-controls-subtitle-chip"]')
            ).toBeNull();
            expect(
                query('[data-test-id="player-controls-speed-chip"]')
            ).toBeNull();
            expect(
                query('[data-test-id="player-controls-settings-dots"]')
            ).toBeNull();

            setState({
                audioTracks: fake.state().audioTracks,
                subtitleTracks: [{ id: 5, label: 'Russian', selected: true }],
                subtitlesEnabled: true,
                playbackSpeed: 2,
            });
            fixture.detectChanges();

            const dots = query(
                '[data-test-id="player-controls-settings-dots"]'
            );
            expect(
                dots?.querySelector('.player-controls__tune-dot--cyan')
            ).not.toBeNull();
            expect(
                dots?.querySelector('.player-controls__tune-dot--violet')
            ).not.toBeNull();
        });

        it('makes the hidden dock inert and moves keyboard focus into the sheet and back', async () => {
            const tune = query(
                '[data-test-id="player-controls-settings-button"]'
            ) as HTMLButtonElement;
            document.body.appendChild(fixture.nativeElement);
            tune.focus();
            // jsdom has no keyboard modality: report the focused tune button
            // as :focus-visible, as a keyboard focus would be.
            const matches = tune.matches.bind(tune);
            Object.defineProperty(tune, 'matches', {
                configurable: true,
                value: (selector: string) =>
                    selector === ':focus-visible' || matches(selector),
            });

            tune.click();
            fixture.detectChanges();
            await fixture.whenStable();

            const sheet = query(
                '[data-test-id="player-controls-settings-panel"]'
            ) as HTMLElement;
            expect(query('.player-controls__bar')?.hasAttribute('inert')).toBe(
                true
            );
            expect(document.activeElement).toBe(sheet);

            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
            );
            fixture.detectChanges();
            await fixture.whenStable();
            await Promise.resolve();

            expect(
                query('[data-test-id="player-controls-settings-panel"]')
            ).toBeNull();
            expect(query('.player-controls__bar')?.hasAttribute('inert')).toBe(
                false
            );
            expect(document.activeElement).toBe(
                query('[data-test-id="player-controls-settings-button"]')
            );
            fixture.nativeElement.remove();
        });

        it('leaves focus alone when a pointer opens the sheet', async () => {
            query('[data-test-id="player-controls-settings-button"]')?.click();
            fixture.detectChanges();
            await fixture.whenStable();

            expect(document.activeElement).not.toBe(
                query('[data-test-id="player-controls-settings-panel"]')
            );
        });

        it('opens a bottom sheet that replaces the dock and keeps PiP reachable after close', () => {
            query('[data-test-id="player-controls-settings-button"]')?.click();
            fixture.detectChanges();

            const sheet = query(
                '[data-test-id="player-controls-settings-panel"]'
            );
            expect(sheet?.classList).toContain(
                'player-controls__settings--sheet'
            );
            expect(
                sheet?.querySelector('.player-settings__grip')
            ).not.toBeNull();
            expect(query('.player-controls__bar')?.classList).toContain(
                'player-controls__bar--sheet-open'
            );
            expect(
                query('[data-test-id="player-controls-settings-dots"]')
            ).toBeNull();

            query('[data-test-id="player-settings-close"]')?.click();
            fixture.detectChanges();
            expect(query('.player-controls__bar')?.classList).not.toContain(
                'player-controls__bar--sheet-open'
            );
            expect(
                query('[aria-label="Enter picture-in-picture"]')
            ).not.toBeNull();
        });
    });
});
