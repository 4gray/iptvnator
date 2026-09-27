import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Right-click accelerator of the parental lock: one positioned context menu
 * with a single "Lock … / Unlock …" item. Hosts (the portal category rail,
 * the M3U groups rail) call `open()` from a `contextmenu` event and persist
 * the emitted target state themselves — the menu knows nothing about
 * playlists or lock stores. Bulk actions and the full list stay in the
 * "Manage categories" dialog; this only shortens the single-category case.
 */
@Component({
    selector: 'app-category-lock-menu',
    imports: [MatIconModule, MatMenuModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div
            aria-hidden="true"
            class="category-lock-menu__anchor"
            [style.left]="position().x"
            [style.top]="position().y"
            [matMenuTriggerFor]="menu"
            #trigger="matMenuTrigger"
        ></div>
        <mat-menu #menu="matMenu">
            <button
                mat-menu-item
                type="button"
                data-test-id="category-lock-menu-toggle"
                (click)="toggleRequested.emit(!locked())"
            >
                <mat-icon>{{ locked() ? 'lock_open' : 'lock' }}</mat-icon>
                <span>{{
                    (locked() ? unlockLabelKey() : lockLabelKey()) | translate
                }}</span>
            </button>
        </mat-menu>
    `,
    styles: `
        :host {
            display: contents;
        }
        .category-lock-menu__anchor {
            position: fixed;
            width: 0;
            height: 0;
            pointer-events: none;
        }
    `,
})
export class CategoryLockMenuComponent {
    readonly lockLabelKey = input('PARENTAL_LOCK.LOCK_CATEGORY');
    readonly unlockLabelKey = input('PARENTAL_LOCK.UNLOCK_CATEGORY');
    /** The desired state: `true` = lock the row, `false` = unlock it. */
    readonly toggleRequested = output<boolean>();

    readonly locked = signal(false);
    readonly position = signal({ x: '0px', y: '0px' });
    private readonly trigger = viewChild.required<MatMenuTrigger>('trigger');

    /** Opens the menu at the pointer for a row whose lock state is `locked`. */
    open(event: MouseEvent, locked: boolean): void {
        event.preventDefault();
        event.stopPropagation();
        this.locked.set(locked);
        this.position.set({
            x: `${event.clientX}px`,
            y: `${event.clientY}px`,
        });
        const trigger = this.trigger();
        if (trigger.menuOpen) {
            trigger.closeMenu();
        }
        queueMicrotask(() => this.trigger().openMenu());
    }
}
