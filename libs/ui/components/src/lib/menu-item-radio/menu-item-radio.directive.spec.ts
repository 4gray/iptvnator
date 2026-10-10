import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    MenuItemRadioCheckDirective,
    MenuItemRadioDirective,
} from './menu-item-radio.directive';

type Mode = 'server' | 'name-asc' | 'name-desc';

@Component({
    imports: [
        MatIcon,
        MatMenuModule,
        MenuItemRadioCheckDirective,
        MenuItemRadioDirective,
    ],
    template: `
        <button type="button" [matMenuTriggerFor]="menu">Sort</button>
        <mat-menu #menu="matMenu">
            @for (option of modes; track option) {
                <button
                    mat-menu-item
                    [appMenuItemRadio]="mode() === option"
                    (click)="mode.set(option)"
                >
                    <mat-icon appMenuItemRadioCheck>check</mat-icon>
                    <mat-icon>sort_by_alpha</mat-icon>
                    <span>{{ option }}</span>
                </button>
            }
        </mat-menu>
    `,
})
class HostComponent {
    readonly trigger = viewChild.required(MatMenuTrigger);
    readonly modes: Mode[] = ['server', 'name-asc', 'name-desc'];
    readonly mode = signal<Mode>('name-asc');
}

describe('MenuItemRadioDirective', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HostComponent, NoopAnimationsModule],
        }).compileComponents();
    });

    afterEach(() => {
        document
            .querySelectorAll('.cdk-overlay-container')
            .forEach((container) => container.remove());
    });

    async function openMenu() {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        fixture.componentInstance.trigger().openMenu();
        await fixture.whenStable();
        fixture.detectChanges();
        const rows = () =>
            Array.from(
                document.querySelectorAll<HTMLButtonElement>(
                    '.cdk-overlay-container [mat-menu-item]'
                )
            );
        return { fixture, rows };
    }

    function checkOf(row: HTMLElement): HTMLElement {
        return row.querySelector('.app-menu-item-radio-check') as HTMLElement;
    }

    it('announces every row as a menuitemradio with its checked state', async () => {
        const { rows } = await openMenu();

        expect(rows().map((row) => row.getAttribute('role'))).toEqual([
            'menuitemradio',
            'menuitemradio',
            'menuitemradio',
        ]);
        expect(rows().map((row) => row.getAttribute('aria-checked'))).toEqual([
            'false',
            'true',
            'false',
        ]);
    });

    it('reserves the check slot on every row ahead of the other icons and shows it only on the checked one', async () => {
        const { rows } = await openMenu();

        for (const row of rows()) {
            // Material projects the icons ahead of the label; the check slot
            // leads, so every label starts after the same two icons.
            expect(row.firstElementChild).toBe(checkOf(row));
            expect(checkOf(row).getAttribute('aria-hidden')).toBe('true');
        }
        expect(rows().map((row) => checkOf(row).style.visibility)).toEqual([
            'hidden',
            '',
            'hidden',
        ]);
    });

    it('moves the check and aria-checked to the newly chosen row', async () => {
        const { fixture, rows } = await openMenu();

        fixture.componentInstance.mode.set('server');
        fixture.detectChanges();

        expect(rows().map((row) => row.getAttribute('aria-checked'))).toEqual([
            'true',
            'false',
            'false',
        ]);
        expect(rows().map((row) => checkOf(row).style.visibility)).toEqual([
            '',
            'hidden',
            'hidden',
        ]);
    });
});
