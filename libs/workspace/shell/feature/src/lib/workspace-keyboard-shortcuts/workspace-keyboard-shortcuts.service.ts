import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
    getKeyboardShortcutGroups,
    isKeyboardShortcutHelpTrigger,
    isTypingInInput,
} from '@iptvnator/portal/shared/util';
import {
    WorkspaceKeyboardShortcutsDialogComponent,
    WorkspaceKeyboardShortcutsDialogData,
} from './workspace-keyboard-shortcuts-dialog.component';

@Injectable()
export class WorkspaceKeyboardShortcutsService {
    private readonly dialog = inject(MatDialog);
    private readonly destroyRef = inject(DestroyRef);
    private readonly onDocumentKeydown = (event: KeyboardEvent): void =>
        this.handleKeydown(event);

    private dialogRef: MatDialogRef<
        WorkspaceKeyboardShortcutsDialogComponent,
        unknown
    > | null = null;

    constructor() {
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', this.onDocumentKeydown);
            this.destroyRef.onDestroy(() => {
                document.removeEventListener(
                    'keydown',
                    this.onDocumentKeydown
                );
            });
        }
    }

    openShortcutsDialog(): void {
        if (this.dialogRef) {
            return;
        }

        const dialogRef = this.dialog.open<
            WorkspaceKeyboardShortcutsDialogComponent,
            WorkspaceKeyboardShortcutsDialogData
        >(WorkspaceKeyboardShortcutsDialogComponent, {
            width: 'min(760px, 92vw)',
            maxWidth: '92vw',
            panelClass: 'workspace-shortcuts-overlay',
            autoFocus: false,
            data: {
                groups: getKeyboardShortcutGroups({
                    isMac: this.isMacPlatform(),
                    isElectron: this.isElectron(),
                }),
            },
        });

        this.dialogRef = dialogRef;
        dialogRef
            .afterClosed()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => {
                this.dialogRef = null;
            });
    }

    private handleKeydown(event: KeyboardEvent): void {
        if (
            isTypingInInput(event) ||
            !isKeyboardShortcutHelpTrigger(event)
        ) {
            return;
        }

        event.preventDefault();
        this.openShortcutsDialog();
    }

    private isMacPlatform(): boolean {
        return (
            typeof navigator !== 'undefined' &&
            /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
        );
    }

    private isElectron(): boolean {
        return typeof window !== 'undefined' && !!window.electron;
    }
}
