import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import { PlayerControlsComponent } from './player-controls.component';
import type { PlayerController } from './player-controls.model';
import {
    PLAYER_MULTIVIEW_ACTION,
    type PlayerMultiviewAction,
} from './player-multiview-action';

function controller(): PlayerController {
    return {
        capabilities: signal({
            ...DEFAULT_PLAYER_CAPABILITIES,
            volume: true,
            fullscreen: true,
        }),
        state: signal(createEmptyControlsState()),
        commands: {
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
        },
    };
}

describe('PlayerControlsComponent multiview action', () => {
    let fixture: ComponentFixture<PlayerControlsComponent>;

    function create(action: PlayerMultiviewAction | null): void {
        TestBed.configureTestingModule({
            imports: [PlayerControlsComponent, TranslateModule.forRoot()],
            providers: action
                ? [{ provide: PLAYER_MULTIVIEW_ACTION, useValue: action }]
                : [],
        });
        fixture = TestBed.createComponent(PlayerControlsComponent);
        fixture.componentRef.setInput('controller', controller());
        fixture.detectChanges();
    }

    afterEach(() => fixture.destroy());

    const button = (): HTMLButtonElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="player-controls-multiview"]'
        );

    const tooltip = (): string =>
        fixture.debugElement
            .query(By.css('[data-test-id="player-controls-multiview"]'))
            .injector.get(MatTooltip).message;

    it('renders no button when no host provides the action', () => {
        create(null);

        expect(button()).toBeNull();
    });

    describe('with an enabled action', () => {
        const run = jest.fn();

        beforeEach(() => {
            run.mockClear();
            create({ enabled: signal(true), run });
        });

        it('renders a named icon button with the shortcut in its tooltip', () => {
            const element = button();

            expect(element?.getAttribute('aria-label')).toBe(
                'PLAYER.MULTIVIEW.ACTION'
            );
            expect(element?.getAttribute('aria-disabled')).not.toBe('true');
            expect(element?.textContent).toContain('grid_view');
            expect(tooltip()).toBe('PLAYER.MULTIVIEW.ACTION_TOOLTIP');
        });

        it('runs the action on click', () => {
            button()?.click();

            expect(run).toHaveBeenCalledTimes(1);
        });

        it('sits in the right group before fullscreen', () => {
            const actions = Array.from(
                fixture.nativeElement.querySelectorAll(
                    '.player-controls__button'
                )
            ) as HTMLElement[];
            const multiview = actions.indexOf(button() as HTMLElement);
            const fullscreen = actions.findIndex(
                (element) =>
                    element.getAttribute('aria-label') ===
                    'EMBEDDED_MPV.PLAYER.ENTER_FULLSCREEN'
            );

            expect(multiview).toBeGreaterThan(-1);
            expect(multiview).toBeLessThan(fullscreen);
        });
    });

    describe('with a disabled action', () => {
        const run = jest.fn();
        const enabled = signal(false);

        beforeEach(() => {
            run.mockClear();
            enabled.set(false);
            create({
                enabled,
                run,
                disabledReasonKey: 'PLAYER.MULTIVIEW.UNAVAILABLE_PLAYER',
            });
        });

        it('stays visible and focusable, explains why, and does not run', () => {
            const element = button();

            expect(element).not.toBeNull();
            expect(element?.getAttribute('aria-disabled')).toBe('true');
            expect(element?.hasAttribute('disabled')).toBe(false);
            expect(tooltip()).toBe('PLAYER.MULTIVIEW.UNAVAILABLE_PLAYER');

            element?.click();
            expect(run).not.toHaveBeenCalled();
        });

        it('follows the action becoming available', () => {
            enabled.set(true);
            fixture.detectChanges();
            button()?.click();

            expect(button()?.getAttribute('aria-disabled')).not.toBe('true');
            expect(run).toHaveBeenCalledTimes(1);
        });
    });
});
