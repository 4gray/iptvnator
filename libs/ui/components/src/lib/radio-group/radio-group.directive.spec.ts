import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    RadioGroupDirective,
    RadioOptionDirective,
} from './radio-group.directive';

@Component({
    imports: [RadioGroupDirective, RadioOptionDirective],
    template: `
        <div appRadioGroup [style.direction]="direction()" aria-label="Choice">
            @for (option of options(); track option) {
                <button
                    type="button"
                    [appRadioOption]="selected() === option"
                    [disabled]="disabled().includes(option)"
                    (click)="selected.set(option)"
                >
                    <span>{{ option }}</span>
                </button>
            }
        </div>
    `,
})
class HostComponent {
    readonly options = signal(['one', 'two', 'three']);
    readonly selected = signal('two');
    readonly disabled = signal<string[]>([]);
    readonly direction = signal('ltr');
}

describe('RadioGroupDirective', () => {
    function render() {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        const buttons = () =>
            Array.from<HTMLButtonElement>(
                fixture.nativeElement.querySelectorAll('button')
            );
        const press = (index: number, key: string) => {
            const event = new KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true,
            });
            buttons()[index].querySelector('span')?.dispatchEvent(event);
            fixture.detectChanges();
            return event;
        };
        return { fixture, host: fixture.componentInstance, buttons, press };
    }

    it('keeps only the selected enabled choice in the tab order, following external changes', () => {
        const { fixture, host, buttons } = render();
        expect(buttons().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
        expect(buttons()[1].getAttribute('aria-checked')).toBe('true');
        host.selected.set('three');
        fixture.detectChanges();
        expect(buttons().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
        host.disabled.set(['three']);
        fixture.detectChanges();
        expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
        expect(buttons()[2].disabled).toBe(true);
    });

    it('wraps arrow selection, supports Home/End and skips disabled choices', () => {
        const { fixture, host, buttons, press } = render();
        host.disabled.set(['two']);
        fixture.detectChanges();
        expect(press(0, 'ArrowRight').defaultPrevented).toBe(true);
        expect(host.selected()).toBe('three');
        expect(press(2, 'ArrowDown').defaultPrevented).toBe(true);
        expect(host.selected()).toBe('one');
        press(0, 'End');
        expect(host.selected()).toBe('three');
        press(2, 'Home');
        expect(host.selected()).toBe('one');
        press(0, 'ArrowUp');
        expect(buttons().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
        expect(host.selected()).toBe('three');
    });

    it('follows horizontal RTL order without reversing Up/Down', () => {
        const { fixture, host, press } = render();
        host.direction.set('rtl');
        fixture.detectChanges();
        press(1, 'ArrowRight');
        expect(host.selected()).toBe('one');
        press(0, 'ArrowLeft');
        expect(host.selected()).toBe('two');
        press(1, 'ArrowDown');
        expect(host.selected()).toBe('three');
    });

    it('updates the roving stop when options are replaced and leaves unrelated keys alone', () => {
        const { fixture, host, buttons, press } = render();
        host.options.set(['four', 'five']);
        fixture.detectChanges();
        expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1]);
        expect(press(0, 'Tab').defaultPrevented).toBe(false);
        host.disabled.set(['four', 'five']);
        fixture.detectChanges();
        expect(buttons().map((b) => b.tabIndex)).toEqual([-1, -1]);
        expect(press(0, 'ArrowRight').defaultPrevented).toBe(false);
    });
});
