import { DOCUMENT } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    inject,
    viewChild,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
    MAT_SNACK_BAR_DATA,
    MatSnackBarAction,
    MatSnackBarActions,
    MatSnackBarLabel,
    MatSnackBarRef,
} from '@angular/material/snack-bar';

export interface SourceRemovalToastData {
    message: string;
    undoLabel: string;
    closeLabel: string;
    /** Undo takes the focus, which returns here when the toast closes. */
    returnFocusTo?: HTMLElement | null;
    /** The close button: commit the delete now rather than at the end. */
    commitNow?: () => void;
}

/**
 * "Removed …" with Undo, and a close button that commits the delete at
 * once instead of waiting out the toast. A delete from a row's menu takes
 * the row, and with it the focus, off the page: Undo then takes the focus,
 * so the keyboard can reach it. A caller that closes on delete (the
 * switcher) passes `returnFocusTo`: Undo takes the focus regardless, and
 * the focus goes back there when the toast closes.
 */
@Component({
    selector: 'app-source-removal-toast',
    imports: [
        MatButton,
        MatIcon,
        MatIconButton,
        MatSnackBarAction,
        MatSnackBarActions,
        MatSnackBarLabel,
    ],
    template: `
        <span matSnackBarLabel>{{ data.message }}</span>
        <span matSnackBarActions>
            <button
                #undo
                mat-button
                matSnackBarAction
                type="button"
                class="source-removal-toast__undo"
                (click)="ref.dismissWithAction()"
            >
                {{ data.undoLabel }}
            </button>
            <button
                mat-icon-button
                type="button"
                class="source-removal-toast__close"
                (click)="close()"
                [attr.aria-label]="data.closeLabel"
            >
                <mat-icon>close</mat-icon>
            </button>
        </span>
    `,
    styleUrl: './source-removal-toast.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceRemovalToastComponent {
    readonly data = inject<SourceRemovalToastData>(MAT_SNACK_BAR_DATA);
    readonly ref =
        inject<MatSnackBarRef<SourceRemovalToastComponent>>(MatSnackBarRef);
    private readonly undo = viewChild.required('undo', { read: ElementRef });

    constructor() {
        const document = inject(DOCUMENT);
        // After the opening animation: by then a closing menu has tried, and
        // failed, to give focus back to the removed row's ⋯ button.
        const returnFocusTo = this.data.returnFocusTo ?? null;
        this.ref.afterOpened().subscribe(() => {
            const active = document.activeElement;
            if (returnFocusTo || !active || active === document.body) {
                (this.undo().nativeElement as HTMLElement).focus();
            }
        });
        // The toast is gone by now; focus that left with it lands on body.
        this.ref.afterDismissed().subscribe(() => {
            const active = document.activeElement;
            if (
                returnFocusTo?.isConnected &&
                (!active || active === document.body)
            ) {
                returnFocusTo.focus();
            }
        });
    }

    /** Commits the delete at once; the toast closes with it. */
    close(): void {
        if (this.data.commitNow) {
            this.data.commitNow();
        } else {
            this.ref.dismiss();
        }
    }
}
