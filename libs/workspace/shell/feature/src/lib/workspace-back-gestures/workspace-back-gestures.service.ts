import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable } from '@angular/core';
import { WorkspaceBackNavigationService } from '@iptvnator/portal/shared/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import type { ElectronBridgeBackGestureSource } from '@iptvnator/shared/interfaces';
import { WorkspaceShellContextDrawerService } from '@iptvnator/workspace/shell/util';

/** What asked for Back, other than the mouse Back button. */
export type WorkspaceBackGestureSource =
    'keyboard' | ElectronBridgeBackGestureSource;

/**
 * What a gesture does now. `back`: the header's Back runs. `blocked`: a
 * dialog, menu, the phone drawer or a fullscreen player is up, so the
 * gesture is swallowed and nothing navigates. `none`: the header has no
 * Back, so the gesture stays the browser's.
 */
export type WorkspaceBackGestureResult = 'back' | 'blocked' | 'none';

/** `MouseEvent.button` of the mouse Back button. */
const MOUSE_BACK_BUTTON = 3;

/**
 * In Electron on Windows and Linux one mouse Back press also reaches the
 * window as `app-command`: on release on Windows, on press on Linux, and
 * either before or after the renderer sees the button. A command and a
 * press this close together are one press.
 */
export const BACK_PRESS_TWIN_MS = 500;

/** Popups that own input while they are open. */
const POPUP_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"]';

function isShown(element: HTMLElement): boolean {
    return (
        !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
        element.checkVisibility?.({ checkVisibilityCSS: true }) !== false
    );
}

function hasOpenPopup(doc: Document): boolean {
    return (
        doc.querySelector('.cdk-overlay-backdrop-showing') !== null ||
        Array.from(doc.querySelectorAll<HTMLElement>(POPUP_SELECTOR)).some(
            isShown
        )
    );
}

/**
 * Routes platform Back gestures to the header's Back
 * (`WorkspaceBackNavigationService.goBack()`): the mouse Back button here,
 * the Alt+← / Cmd+[ chord through `WorkspaceKeyboardShortcutsService`, and
 * in Electron the window's `app-command` and trackpad swipe, which the main
 * process forwards. A gesture runs Back, or is swallowed while something
 * sits above the page, and then keeps the browser from its own history
 * step; see {@link WorkspaceBackGestureResult}.
 */
@Injectable()
export class WorkspaceBackGesturesService {
    private readonly document = inject(DOCUMENT);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly backNavigation = inject(WorkspaceBackNavigationService);
    // Root-provided; optional keeps standalone unit tests light.
    private readonly contextDrawer = inject(
        WorkspaceShellContextDrawerService,
        { optional: true }
    );

    /** The mouse Back press in progress, from its mousedown to mouseup. */
    private press: { handled: boolean } | null = null;
    /** Whether the last mouse Back press was consumed; auxclick follows it. */
    private pressConsumed = false;
    /** The last press or command that ran Back alone, awaiting its twin. */
    private unpaired: { source: 'pointer' | 'window'; at: number } | null =
        null;

    private readonly onMouseDown = (event: MouseEvent): void => {
        if (event.button !== MOUSE_BACK_BUTTON) return;
        // A command that ran Back just before was this press (Linux).
        this.press = { handled: this.takeUnpaired('window') };
    };

    private readonly onMouseUp = (event: MouseEvent): void => {
        if (event.button !== MOUSE_BACK_BUTTON) return;
        const press = this.press ?? { handled: this.takeUnpaired('window') };
        this.press = null;
        let result: WorkspaceBackGestureResult = 'back';
        if (!press.handled) {
            result = this.runBack();
            if (result === 'back') {
                press.handled = true;
                this.unpaired = { source: 'pointer', at: Date.now() };
            }
        }
        // Electron's Chromium steps through history on an unprevented press
        // too, even back to entries from before a reload, which reloads the
        // app. Where the window forwards Back gestures, the workspace owns
        // the button outright.
        this.pressConsumed =
            result !== 'none' || this.runtime.supportsWindowBackGestures;
        if (this.pressConsumed) event.preventDefault();
    };

    private readonly onAuxClick = (event: MouseEvent): void => {
        if (event.button === MOUSE_BACK_BUTTON && this.pressConsumed) {
            event.preventDefault();
        }
    };

    constructor() {
        const doc = this.document;
        // Capture phase: the press belongs to the workspace, whatever
        // element is under the pointer.
        doc.addEventListener('mousedown', this.onMouseDown, true);
        doc.addEventListener('mouseup', this.onMouseUp, true);
        doc.addEventListener('auxclick', this.onAuxClick, true);

        // The capability, not a generic bridge check: an older preload has
        // no subscription to offer.
        const unsubscribe = this.runtime.supportsWindowBackGestures
            ? window.electron?.onWindowBackRequested((source) => {
                  this.goBack(source);
              })
            : undefined;

        inject(DestroyRef).onDestroy(() => {
            doc.removeEventListener('mousedown', this.onMouseDown, true);
            doc.removeEventListener('mouseup', this.onMouseUp, true);
            doc.removeEventListener('auxclick', this.onAuxClick, true);
            unsubscribe?.();
        });
    }

    /** What a gesture would do now, without running it. */
    peek(): WorkspaceBackGestureResult {
        if (this.isBlocked()) return 'blocked';
        return this.backNavigation.target() ? 'back' : 'none';
    }

    /**
     * Runs the header's Back for a gesture. `back` also covers the window's
     * half of a mouse press that ran Back through its other half. Unless the
     * result is `none`, the caller prevents the browser's default.
     */
    goBack(source: WorkspaceBackGestureSource): WorkspaceBackGestureResult {
        return source === 'app-command'
            ? this.onWindowCommand()
            : this.runBack();
    }

    private onWindowCommand(): WorkspaceBackGestureResult {
        const press = this.press;
        if (press && !press.handled) {
            // The command of the press in progress (Linux sends it on press,
            // Windows with the release): Back runs now, the mouseup is spent.
            const result = this.runBack();
            press.handled = result === 'back';
            return result;
        }
        if (this.takeUnpaired('pointer')) return 'back';
        const result = this.runBack();
        if (result === 'back') {
            this.unpaired = { source: 'window', at: Date.now() };
        }
        return result;
    }

    private runBack(): WorkspaceBackGestureResult {
        const result = this.peek();
        if (result === 'back') this.backNavigation.goBack();
        return result;
    }

    private isBlocked(): boolean {
        const doc = this.document;
        return (
            // Undefined where the Fullscreen API is missing (iPhone Safari).
            doc.fullscreenElement != null ||
            this.contextDrawer?.isOpen() === true ||
            hasOpenPopup(doc)
        );
    }

    private takeUnpaired(source: 'pointer' | 'window'): boolean {
        const unpaired = this.unpaired;
        if (unpaired?.source !== source) return false;
        this.unpaired = null;
        return Date.now() - unpaired.at <= BACK_PRESS_TWIN_MS;
    }
}
