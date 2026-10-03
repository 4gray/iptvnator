import { computed, Directive, signal } from '@angular/core';

/**
 * Turns a `mat-icon-button` suffix into the show/hide control of a password
 * field. The field starts masked; the input binds `[type]="toggle.inputType()"`
 * and the icon renders `toggle.icon()`.
 *
 * It is a toggle button in the ARIA sense: the template gives it one constant
 * label ("Show password") and `aria-pressed` carries the state, so a screen
 * reader announces "Show password, toggle button, pressed" instead of a label
 * that flips under the user's focus.
 */
@Directive({
    selector: 'button[appPasswordVisibilityToggle]',
    exportAs: 'appPasswordVisibilityToggle',
    host: {
        type: 'button',
        '[attr.aria-pressed]': 'visible()',
        '(click)': 'toggle()',
    },
})
export class PasswordVisibilityToggleDirective {
    readonly visible = signal(false);
    readonly inputType = computed(() => (this.visible() ? 'text' : 'password'));
    readonly icon = computed(() =>
        this.visible() ? 'visibility_off' : 'visibility'
    );

    toggle(): void {
        this.visible.update((visible) => !visible);
    }

    /** Masks the field again, e.g. when its form is cleared for a new entry. */
    hide(): void {
        this.visible.set(false);
    }
}
