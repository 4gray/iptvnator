import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { TranslateModule } from '@ngx-translate/core';
import { liveItem, movieItem } from './multiview-picker.fixtures';
import { toPickerRow } from './multiview-picker-row';
import {
    initialsOf,
    MultiviewPickerRowComponent,
    programProgress,
} from './multiview-picker-row.component';

const NOW = Date.parse('2026-11-13T20:40:00Z');
const program = {
    title: 'Synthetic Match',
    start: '2026-11-13T20:30:00Z',
    stop: '2026-11-13T22:30:00Z',
} as EpgProgram;

describe('picker row helpers', () => {
    it('makes initials from the first two words', () => {
        expect(initialsOf('sport arena hd')).toBe('SA');
        expect(initialsOf('  News ')).toBe('N');
    });

    it('measures a running programme', () => {
        expect(programProgress(program, NOW)).toEqual({
            percent: 8,
            minutes: 10,
        });
        expect(
            programProgress(program, Date.parse('2026-11-13T23:00:00Z'))
        ).toBeNull();
        expect(programProgress(null, NOW)).toBeNull();
    });

    it('measures in display time when the EPG is shifted', () => {
        // -60 min: the programme runs 19:30–21:30 on the viewer's clock.
        expect(programProgress(program, NOW, -60)).toEqual({
            percent: 58,
            minutes: 70,
        });
    });
});

describe('MultiviewPickerRowComponent', () => {
    const epgOffset = signal(0);
    afterEach(() => epgOffset.set(0));

    function render(
        row: ReturnType<typeof toPickerRow>,
        inputs: Record<string, unknown> = {}
    ): HTMLElement {
        TestBed.configureTestingModule({
            imports: [MultiviewPickerRowComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: epgOffset },
                },
            ],
        });
        const fixture = TestBed.createComponent(MultiviewPickerRowComponent);
        fixture.componentRef.setInput('row', row);
        for (const [key, value] of Object.entries(inputs)) {
            fixture.componentRef.setInput(key, value);
        }
        fixture.detectChanges();
        return fixture.nativeElement;
    }

    it('shows LIVE for a channel without a programme (D10)', () => {
        const host = render(toPickerRow(liveItem(1), []));

        expect(host.getAttribute('role')).toBe('option');
        expect(host.textContent).toContain('Synthetic Channel 1');
        expect(host.textContent).toContain('EMBEDDED_MPV.PLAYER.LIVE_BADGE');
        expect(host.querySelector('.mv-picker-row__progress')).toBeNull();
    });

    it('shows elapsed minutes and progress for a running programme (D10)', () => {
        jest.useFakeTimers({ now: NOW });
        try {
            const host = render(toPickerRow(liveItem(1), []), { program });

            expect(host.textContent).toContain('Synthetic Match');
            expect(host.textContent).toContain('10′');
            expect(
                (
                    host.querySelector(
                        '.mv-picker-row__progress span'
                    ) as HTMLElement
                ).style.width
            ).toBe('8%');
        } finally {
            jest.useRealTimers();
        }
    });

    it('applies the EPG offset setting to the progress', () => {
        jest.useFakeTimers({ now: NOW });
        try {
            epgOffset.set(-60);
            const host = render(toPickerRow(liveItem(1), []), { program });

            expect(host.textContent).toContain('70′');
            expect(
                (
                    host.querySelector(
                        '.mv-picker-row__progress span'
                    ) as HTMLElement
                ).style.width
            ).toBe('58%');
        } finally {
            jest.useRealTimers();
        }
    });

    it('marks a row already on screen and disabled', () => {
        const host = render(
            { ...toPickerRow(liveItem(1), []), inTile: 2 },
            { disabled: true }
        );

        expect(host.getAttribute('aria-disabled')).toBe('true');
        expect(host.textContent).toContain('PLAYER.MULTIVIEW.PICKER.IN_TILE');
    });

    it('offers the episodes of a series', () => {
        const host = render(
            toPickerRow(movieItem(3, { contentType: 'series' }), [])
        );

        expect(host.textContent).toContain('PLAYER.MULTIVIEW.PICKER.EPISODES');
    });

    it('shows the resume point of a film', () => {
        const host = render(
            toPickerRow(movieItem(4), [], {
                position: {
                    contentXtreamId: 4,
                    contentType: 'vod',
                    positionSeconds: 754,
                },
            })
        );

        expect(host.textContent).toContain(
            'PLAYER.MULTIVIEW.PICKER.CONTINUE_FROM'
        );
    });
});
