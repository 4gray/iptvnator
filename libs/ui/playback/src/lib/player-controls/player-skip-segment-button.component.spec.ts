import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import type {
    PlayerController,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerSkipSegment,
} from './player-controls.model';
import { PlayerSkipSegmentButtonComponent } from './player-skip-segment-button.component';

describe('PlayerSkipSegmentButtonComponent', () => {
    let fixture: ComponentFixture<PlayerSkipSegmentButtonComponent>;
    let state: WritableSignal<PlayerControlsState>;
    let seekTo: jest.Mock;

    const segments: PlayerSkipSegment[] = [
        { kind: 'recap', startSeconds: 0, endSeconds: 40 },
        { kind: 'intro', startSeconds: 60, endSeconds: 110 },
    ];
    const button = () =>
        fixture.nativeElement.querySelector(
            '[data-test-id="player-controls-skip-segment"]'
        ) as HTMLButtonElement | null;
    const at = (positionSeconds: number) => {
        state.set({
            ...createEmptyControlsState(),
            status: 'playing',
            canSeek: true,
            durationSeconds: 1500,
            positionSeconds,
        });
        fixture.detectChanges();
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                PlayerSkipSegmentButtonComponent,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            EMBEDDED_MPV: {
                PLAYER: { SKIP_INTRO: 'Skip intro', SKIP_RECAP: 'Skip recap' },
            },
        });
        translate.use('en');

        state = signal(createEmptyControlsState());
        seekTo = jest.fn();
        const controller: PlayerController = {
            capabilities: signal({
                ...DEFAULT_PLAYER_CAPABILITIES,
                seek: true,
            }),
            state,
            commands: { seekTo } as unknown as PlayerControlsCommands,
        };
        fixture = TestBed.createComponent(PlayerSkipSegmentButtonComponent);
        fixture.componentRef.setInput('controller', controller);
        fixture.componentRef.setInput('segments', segments);
        at(0);
    });

    afterEach(() => fixture.destroy());

    it('shows "Skip intro" during the intro and seeks to its end', () => {
        at(75);
        expect(button()?.textContent).toContain('Skip intro');

        button()?.click();

        expect(seekTo).toHaveBeenCalledWith(110);
    });

    it('names the recap and renders nothing between segments', () => {
        at(10);
        expect(button()?.textContent).toContain('Skip recap');

        at(50);
        expect(button()).toBeNull();
    });

    it('rises above the dock while the controls are shown', () => {
        const host = fixture.nativeElement as HTMLElement;
        expect(host.classList).not.toContain('player-skip--raised');

        fixture.componentRef.setInput('raised', true);
        fixture.detectChanges();

        expect(host.classList).toContain('player-skip--raised');
    });

    it('jumps past an auto-skip intro on its own, once, with no button', () => {
        fixture.componentRef.setInput(
            'segments',
            segments.map((segment) => ({ ...segment, autoSkip: true }))
        );
        at(62);

        expect(button()).toBeNull();
        expect(seekTo).toHaveBeenCalledTimes(1);
        expect(seekTo).toHaveBeenCalledWith(110);

        at(63);
        expect(seekTo).toHaveBeenCalledTimes(1);
    });

    it('yields to the settings panel', () => {
        at(75);
        fixture.componentRef.setInput('settingsOpen', true);
        fixture.detectChanges();

        expect(button()).toBeNull();
    });
});
