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

export interface NotificationActionToastData {
    readonly message: string;
    readonly actionLabel: string;
    readonly closeLabel: string;
}

/**
 * A sticky notification with an action (an error's "Trust host") and a
 * Close button, so the user can dismiss it without taking the action.
 * Material's text snack-bar has room for one button only. Loaded on demand
 * by `NotificationService`: it imports Material's snack-bar and buttons.
 */
@Component({
    selector: 'lib-notification-action-toast',
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
                class="app-notification__action"
                (click)="ref.dismissWithAction()"
            >
                {{ data.actionLabel }}
            </button>
            <button
                mat-icon-button
                type="button"
                class="app-notification__close"
                (click)="ref.dismiss()"
                [attr.aria-label]="data.closeLabel"
            >
                <mat-icon>close</mat-icon>
            </button>
        </span>
    `,
    styles: `
        .app-notification__action {
            font-weight: 600;
        }

        .app-notification__close {
            color: var(--app-body-color);
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationActionToastComponent {
    readonly data = inject<NotificationActionToastData>(MAT_SNACK_BAR_DATA);
    readonly ref =
        inject<MatSnackBarRef<NotificationActionToastComponent>>(
            MatSnackBarRef
        );
}
