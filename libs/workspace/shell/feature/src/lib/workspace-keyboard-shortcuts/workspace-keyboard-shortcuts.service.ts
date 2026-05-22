import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
    getKeyboardShortcutGroups,
    isKeyboardShortcutHelpTrigger,
    isTypingInInput,
} from '@iptvnator/portal/shared/util';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    WorkspaceKeyboardShortcutsDialogComponent,
    WorkspaceKeyboardShortcutsDialogData,
} from './workspace-keyboard-shortcuts-dialog.component';

@Injectable()
export class WorkspaceKeyboardShortcutsService {
    private readonly dialog = inject(MatDialog);
    private readonly destroyRef = inject(DestroyRef);
    private readonly runtime = inject(RuntimeCapabilitiesService);
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
                document.removeEventListener('keydown', this.onDocumentKeydown);
            });
        }
    }

    openShortcutsDialog(): void {
        if (this.dialogRef) {
            return;
        }

        const platform = this.getShortcutPlatform();
        const dialogRef = this.dialog.open<
            WorkspaceKeyboardShortcutsDialogComponent,
            WorkspaceKeyboardShortcutsDialogData
        >(WorkspaceKeyboardShortcutsDialogComponent, {
            width: 'min(960px, 94vw)',
            maxWidth: '94vw',
            panelClass: 'workspace-shortcuts-overlay',
            autoFocus: false,
            data: {
                groups: getKeyboardShortcutGroups({
                    isMac: platform === 'mac',
                    isElectron: this.runtime.isElectron,
                }),
                platformIcon:
                    platform === 'mac' ? 'laptop_mac' : 'desktop_windows',
                platformLabelKey:
                    platform === 'mac'
                        ? 'WORKSPACE.SHORTCUTS.PLATFORM.MAC'
                        : 'WORKSPACE.SHORTCUTS.PLATFORM.OTHER',
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
        if (isTypingInInput(event) || !isKeyboardShortcutHelpTrigger(event)) {
            return;
        }

        event.preventDefault();
        this.openShortcutsDialog();
    }

    private getShortcutPlatform(): 'mac' | 'other' {
        if (typeof navigator === 'undefined') {
            return 'other';
        }

        const navigatorWithUserAgentData = navigator as Navigator & {
            userAgentData?: { platform?: string };
        };
        const platform =
            navigatorWithUserAgentData.userAgentData?.platform ||
            navigator.userAgent;

        return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'mac' : 'other';
    }

}
