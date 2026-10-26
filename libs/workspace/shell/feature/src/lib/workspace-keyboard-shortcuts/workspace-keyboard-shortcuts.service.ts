import { DestroyRef, Injectable, inject } from '@angular/core';
import { dialogSize } from '@iptvnator/ui/components';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
    getKeyboardShortcutGroups,
    isKeyboardShortcutHelpTrigger,
    isTypingInInput,
    isWorkspaceBackShortcut,
    resolveZoomShortcutAction,
} from '@iptvnator/portal/shared/util';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    WorkspaceBackGestureResult,
    WorkspaceBackGesturesService,
} from '../workspace-back-gestures/workspace-back-gestures.service';
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
    private readonly contextDrawer = inject(
        WorkspaceShellContextDrawerService,
        {
            optional: true,
        }
    );
    private readonly backGestures = inject(WorkspaceBackGesturesService);
    private readonly onDocumentKeydown = (event: KeyboardEvent): void =>
        this.handleKeydown(event);
    private readonly onDocumentKeydownCapture = (event: KeyboardEvent): void =>
        this.handleBackShortcut(event);
    /** The first press of the held Back chord; its repeats follow it. */
    private heldBackChord: WorkspaceBackGestureResult | null = null;
    private readonly onDocumentKeyup = (): void => {
        this.heldBackChord = null;
    };

    private dialogRef: MatDialogRef<
        WorkspaceKeyboardShortcutsDialogComponent,
        unknown
    > | null = null;

    constructor() {
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', this.onDocumentKeydown);
            document.addEventListener(
                'keydown',
                this.onDocumentKeydownCapture,
                true
            );
            document.addEventListener('keyup', this.onDocumentKeyup, true);
            this.destroyRef.onDestroy(() => {
                document.removeEventListener('keydown', this.onDocumentKeydown);
                document.removeEventListener(
                    'keydown',
                    this.onDocumentKeydownCapture,
                    true
                );
                document.removeEventListener(
                    'keyup',
                    this.onDocumentKeyup,
                    true
                );
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
            ...dialogSize('lg'),
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
        if (
            this.handleWindowFullscreenToggle(event) ||
            this.handleZoomShortcut(event)
        ) {
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
     * Alt+← (Cmd+[ on macOS) runs the header's Back through
     * `WorkspaceBackGesturesService`. It listens in the capture phase and
     * stops a chord that runs Back there, so a focused carousel, tab list or
     * player cannot also read it as a plain arrow. While a dialog, menu, the
     * phone drawer or a fullscreen player is up the chord is swallowed but
     * still reaches them. Not while typing, where Alt/Option arrows move by
     * word. A held chord runs Back once: its repeats follow the first press
     * until a key is released, so after a press that ran Back they are
     * swallowed even when the page it reached has no Back left, and the
     * browser cannot step again. Without a Back the chord stays the
     * browser's.
     */
    private handleBackShortcut(event: KeyboardEvent): void {
        if (
            event.defaultPrevented ||
            isTypingInInput(event) ||
            !isWorkspaceBackShortcut(event, {
                isMac: this.getShortcutPlatform() === 'mac',
            })
        ) {
            return;
        }

        let result: WorkspaceBackGestureResult;
        if (event.repeat) {
            result = this.heldBackChord ?? 'none';
        } else {
            result = this.backGestures.goBack('keyboard');
            this.heldBackChord = result;
        }
        if (result === 'none') {
            return;
        }

        event.preventDefault();
        if (result === 'back') {
            event.stopPropagation();
        }
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

    /**
     * Cmd/Ctrl and +/−/0 zoom the app (issue #1109). Like F11 this is not
     * gated by `isTypingInInput`: browsers zoom from any focus, and the
     * combination is not one a text field consumes. The bridge steps the
     * frame-bound zoom level itself, so no native menu is needed — Windows
     * and Linux run without one. On macOS the renderer sees the key before
     * the application menu's `zoomIn`/`zoomOut`/`resetZoom` roles do, and
     * `preventDefault()` stops the role from stepping a second time, so one
     * press is one step on every platform. A key another handler already
     * consumed is left alone; without a bridge (PWA) the browser keeps its
     * own zoom.
     */
    private handleZoomShortcut(event: KeyboardEvent): boolean {
        if (event.defaultPrevented) {
            return false;
        }

        const bridge = window.electron;
        if (typeof bridge?.adjustZoomLevel !== 'function') {
            return false;
        }

        const action = resolveZoomShortcutAction(event, {
            isMac: bridge.platform === 'darwin',
        });
        if (!action) {
            return false;
        }

        event.preventDefault();
        try {
            bridge.adjustZoomLevel(action);
        } catch {
            // The frame refused the write; the level on screen is unchanged.
        }
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
