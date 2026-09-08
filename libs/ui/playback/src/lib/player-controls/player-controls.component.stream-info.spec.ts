import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { STREAM_STATS_SAMPLE_INTERVAL_MS } from './controls-stream-stats';
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
import { type PlayerStreamStats } from './player-stream-stats.model';
import { emptyStreamStats } from './stream-stats.spec-helpers';

function createFakeController(sample: jest.Mock) {
    const capabilities: WritableSignal<PlayerControlsCapabilities> = signal({
        ...DEFAULT_PLAYER_CAPABILITIES,
        streamStats: true,
    });
    const state: WritableSignal<PlayerControlsState> = signal(
        createEmptyControlsState()
    );
    const commands = {
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
    } as jest.Mocked<PlayerControlsCommands>;
    const controller: PlayerController = {
        capabilities,
        state,
        commands,
        streamStats: { sample: sample as () => PlayerStreamStats | null },
    };
    return { controller, capabilities, state };
}

describe('PlayerControlsComponent stream info', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;
    let fake: ReturnType<typeof createFakeController>;
    let sample: jest.Mock;
    let surface: HTMLElement;

    const queryButton = (): HTMLButtonElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="player-controls-stream-info-button"]'
        );

    const queryPanel = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="player-controls-stream-info-panel"]'
        );

    const queryScrim = (): HTMLElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="player-controls-top-scrim"]'
        );

    const openPanel = () => {
        queryButton()?.click();
        fixture.detectChanges();
    };

    beforeEach(async () => {
        jest.useFakeTimers();
        localStorage.removeItem('volume');
        await TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
        }).compileComponents();

        surface = document.createElement('div');
        document.body.appendChild(surface);

        sample = jest.fn((): PlayerStreamStats =>
            emptyStreamStats({ width: 1920, height: 1080, fps: 50 })
        );
        fake = createFakeController(sample);
        fixture = TestBed.createComponent(PlayerControlsComponent);
        fixture.componentRef.setInput('controller', fake.controller);
        fixture.componentRef.setInput('playerSurface', surface);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
        surface.remove();
        jest.useRealTimers();
    });

    it('renders the corner button only when the engine reports stats', () => {
        expect(queryButton()).not.toBeNull();

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            streamStats: false,
        });
        fixture.detectChanges();

        expect(queryButton()).toBeNull();
    });

    it('backs the corner button with a scrim, in windowed playback too', () => {
        // Without it a white icon is invisible over bright video, and the
        // media title's scrim only exists in fullscreen.
        expect(queryScrim()).not.toBeNull();

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            streamStats: false,
        });
        fixture.detectChanges();

        // No corner and no title left to back.
        expect(queryScrim()).toBeNull();
    });

    it('fades the scrim together with the controls', () => {
        fake.state.set({
            ...createEmptyControlsState(),
            status: 'playing',
        });
        fixture.detectChanges();
        const visibleClass = 'player-controls__top-scrim--visible';
        expect(queryScrim()?.classList).toContain(visibleClass);

        fixture.componentInstance.menus.closeAll();
        jest.advanceTimersByTime(10_000);
        fixture.detectChanges();

        expect(fixture.componentInstance.controlsAreVisible()).toBe(false);
        expect(queryScrim()?.classList).not.toContain(visibleClass);
    });

    it('opens the popover with a row per known value', () => {
        expect(queryPanel()).toBeNull();

        openPanel();

        const rows = fixture.nativeElement.querySelectorAll(
            '.player-controls__stats-row'
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('1920 × 1080 · 16:9');
        expect(rows[1].textContent).toContain('50 fps');
    });

    it('samples only while the popover is open', () => {
        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 2);
        expect(sample).not.toHaveBeenCalled();

        openPanel();
        expect(sample).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 2);
        expect(sample).toHaveBeenCalledTimes(3);

        openPanel();
        expect(queryPanel()).toBeNull();

        sample.mockClear();
        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 3);
        expect(sample).not.toHaveBeenCalled();
    });

    it('stops sampling when the engine loses the capability mid-playback', () => {
        openPanel();
        sample.mockClear();

        fake.capabilities.set({
            ...DEFAULT_PLAYER_CAPABILITIES,
            streamStats: false,
        });
        fake.state.set({ ...createEmptyControlsState() });
        fixture.detectChanges();

        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 2);
        expect(queryPanel()).toBeNull();
        expect(sample).not.toHaveBeenCalled();
    });

    it('shows a placeholder while the engine has no numbers yet', () => {
        sample.mockReturnValue(null);

        openPanel();

        expect(
            fixture.nativeElement.querySelector('.player-controls__stats-empty')
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelectorAll(
                '.player-controls__stats-row'
            )
        ).toHaveLength(0);
    });

    it('keeps the controls pinned open while the popover is up', () => {
        fake.state.set({
            ...createEmptyControlsState(),
            status: 'playing',
        });
        fixture.detectChanges();

        openPanel();

        expect(fixture.componentInstance.menus.anyOpen()).toBe(true);
        expect(fixture.componentInstance.controlsAreVisible()).toBe(true);
    });
});
