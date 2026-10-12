import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PasswordVisibilityToggleDirective } from './password-visibility-toggle.directive';

@Component({
    imports: [PasswordVisibilityToggleDirective],
    template: `
        <input [type]="toggle.inputType()" />
        <button
            appPasswordVisibilityToggle
            #toggle="appPasswordVisibilityToggle"
            aria-label="Show password"
        >
            {{ toggle.icon() }}
        </button>
    `,
})
class HostComponent {}

describe('PasswordVisibilityToggleDirective', () => {
    function render() {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        return {
            fixture,
            input: root.querySelector('input') as HTMLInputElement,
            button: root.querySelector('button') as HTMLButtonElement,
        };
    }

    it('starts masked and is a non-submitting toggle button', () => {
        const { input, button } = render();

        expect(input.type).toBe('password');
        expect(button.type).toBe('button');
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(button.textContent?.trim()).toBe('visibility');
    });

    it('reveals and masks again on each click, keeping its label', () => {
        const { fixture, input, button } = render();

        button.click();
        fixture.detectChanges();

        expect(input.type).toBe('text');
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.textContent?.trim()).toBe('visibility_off');
        expect(button.getAttribute('aria-label')).toBe('Show password');

        button.click();
        fixture.detectChanges();

        expect(input.type).toBe('password');
        expect(button.getAttribute('aria-pressed')).toBe('false');
    });

    it('masks again on hide()', () => {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const button = root.querySelector('button') as HTMLButtonElement;
        button.click();
        fixture.detectChanges();

        fixture.debugElement
            .query((node) => node.name === 'button')
            .injector.get(PasswordVisibilityToggleDirective)
            .hide();
        fixture.detectChanges();

        expect(root.querySelector('input')?.type).toBe('password');
        expect(button.getAttribute('aria-pressed')).toBe('false');
    });

    it('does not submit the surrounding form', () => {
        const form = document.createElement('form');
        const submit = jest.fn((event: Event) => event.preventDefault());
        form.addEventListener('submit', submit);
        const { button } = render();
        form.appendChild(button);
        document.body.appendChild(form);

        button.click();

        expect(submit).not.toHaveBeenCalled();
        form.remove();
    });
});
