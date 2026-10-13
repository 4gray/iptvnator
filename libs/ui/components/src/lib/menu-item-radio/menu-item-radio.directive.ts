import { Directive, inject, input } from '@angular/core';
import { MatMenuItem } from '@angular/material/menu';

/**
 * One choice of a single-choice `mat-menu` group, such as a sort order or a
 * rating threshold: a `menuitemradio` whose `aria-checked` follows the bound
 * state.
 *
 * Every row also renders `<mat-icon appMenuItemRadioCheck>check</mat-icon>`
 * as its first icon. Material projects all of a row's icons ahead of its
 * label, so a check rendered only on the chosen row pushed that row's label
 * to the right; a check slot on every row, hidden while unchecked, keeps
 * all labels on one left edge.
 *
 * ```html
 * <button mat-menu-item [appMenuItemRadio]="mode() === 'name-asc'">
 *     <mat-icon appMenuItemRadioCheck>check</mat-icon>
 *     <span>{{ 'WORKSPACE.SORT_NAME_ASC' | translate }}</span>
 * </button>
 * ```
 */
@Directive({
    // Injecting MatMenuItem restricts it to `mat-menu-item` hosts.
    selector: '[appMenuItemRadio]',
    host: {
        '[attr.aria-checked]': 'checked()',
    },
})
export class MenuItemRadioDirective {
    readonly checked = input.required<boolean>({ alias: 'appMenuItemRadio' });

    constructor() {
        // The menu item owns the `role` host binding; set its input rather
        // than binding the attribute a second time.
        inject(MatMenuItem).role = 'menuitemradio';
    }
}

/**
 * The leading check slot of a {@link MenuItemRadioDirective} row. It keeps
 * its width on every row and is visible only on the checked one.
 */
@Directive({
    selector: 'mat-icon[appMenuItemRadioCheck]',
    host: {
        class: 'app-menu-item-radio-check',
        '[style.visibility]': 'radio.checked() ? null : "hidden"',
    },
})
export class MenuItemRadioCheckDirective {
    protected readonly radio = inject(MenuItemRadioDirective);
}
