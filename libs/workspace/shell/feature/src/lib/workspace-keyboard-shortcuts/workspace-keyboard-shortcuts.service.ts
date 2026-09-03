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
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';

@Injectable()
export class WorkspaceKeyboardShortcutsService {
    private readonly dialog = inject(MatDialog);
    private readonly destroyRef = inject(DestroyRef);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    // Root-provided; optional keeps standalone unit tests light. The help key must not open a dialog over the modal phone
    // context drawer.
    private readonly contextDrawer = inject(WorkspaceShellContextDrawerService, {
        optional: true,
    });
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
        if (this.handleWindowFullscreenToggle(event)) {
            return;
        }

        if (
            isTypingInInput(event) ||
            !isKeyboardShortcutHelpTrigger(event) ||
            this.contextDrawer?.isOpen()
        ) {
            return;
        }

        event.preventDefault();
        this.openShortcutsDialog();
    }

    /**
     * F11 toggles OS-level window fullscreen in the desktop app. It is the
     * way out of a fullscreen launch on Windows/Linux, where the title bar is
     * hidden and the window controls hide themselves while fullscreen, so it
     * is deliberately not gated by `isTypingInInput` — F11 is expected to
     * work from any focus. While the player owns HTML-element fullscreen
     * (`document.fullscreenElement`) its own F / Esc are in charge and F11
     * must not yank OS fullscreen out from under it. Without a bridge (PWA)
     * the browser keeps its own F11.
     */
    private handleWindowFullscreenToggle(event: KeyboardEvent): boolean {
        if (
            event.key !== 'F11' ||
            event.repeat ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
        ) {
            return false;
        }

        const bridge = window.electron;
        if (
            typeof bridge?.toggleFullScreenWindow !== 'function' ||
            document.fullscreenElement
        ) {
            return false;
        }

        event.preventDefault();
        void bridge.toggleFullScreenWindow().catch(() => undefined);
        return true;
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
