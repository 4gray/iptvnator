import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
}

/**
 * "Removed …" with Undo, and a close button that commits the delete at
 * once instead of waiting out the toast.
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
                (click)="ref.dismiss()"
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
}
