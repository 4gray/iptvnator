import { blurFocusedControl } from '../player-controls';

/**
 * How long after a pointer press a focus that lands on a control is still
 * attributed to that press. A menu selection moves focus to the menu button
 * a tick or two after the click, so the window covers that gap while a later
 * keydown ends it (Tab focus must not be attributed to a stale press).
 */
const POINTER_ATTRIBUTION_WINDOW_MS = 1000;

/**
 * Video.js focusables that capture the keyboard: control-bar `<button>`s
 * (including menu buttons), `ClickableComponent` divs (`role="button"`, e.g.
 * the poster) and sliders (`role="slider"`). Menu items are `role="menuitem*"`
 * and are deliberately absent — while a menu is open its item, not its button,
 * owns arrow-key navigation, so releasing the button never disturbs it.
 */
const VJS_RELEASE_SELECTOR = 'button, [role="button"], [role="slider"]';

/**
 * Vendor-chrome counterpart of the shared controls' pointer focus release
 * (`ControlsSurface.releasePointerFocus`), attached to the player shell of
 * the preference-off Video.js player. Chromium focuses a clicked control, and
 * a focused Video.js component captures the keyboard entirely:
 * `Component.handleKeyDown` stops the propagation of every key and
 * `ClickableComponent` turns Space and Enter into a click, so after a mouse
 * click on the fullscreen button Space left fullscreen instead of pausing and
 * `LegacyPlayerShortcuts` on the document never saw a key.
 *
 * The release is driven by the focus landing, not the click: choosing a menu
 * item moves focus to the menu button a tick after the click (Video.js
 * `MenuItem.handleTapClick`), and the selection click never bubbles to this
 * root, so a click handler would be both too early and unreached. Instead a
 * `focusin` on an eligible control is released when it is attributable to a
 * recent pointer press inside the shell — a `pointerdown` within the window,
 * not yet ended by a keydown anywhere — so keyboard `Tab` focus is preserved
 * (the keydown listener is on the document because the key that follows a
 * release is pressed while focus sits on `body`, outside the shell).
 *
 * Menu buttons are not exempt: a Video.js popup is navigated through its
 * focused item, not its button, so releasing the button never breaks it.
 * Opening a menu focuses the item (not eligible), and the button focus that
 * a pointer press moves through — the transient press on open, and the press
 * that toggles an open menu shut — is released, which is what lets Space work
 * again after a menu is dismissed by clicking its button a second time.
 * Returns the detach function.
 */
export function attachVjsPointerFocusRelease(root: HTMLElement): () => void {
    const doc = root.ownerDocument;
    let lastPointerDownAt: number | null = null;

    // Only presses inside the shell count: a click elsewhere on the page must
    // not attribute a later `Tab` into the controls.
    const onPointerDown = () => {
        lastPointerDownAt = Date.now();
    };
    // A key press ends pointer attribution: focus that moves after it was
    // moved by the keyboard, whatever the last press hit (mirrors
    // `ControlsSurface`). It is on the document because the key that follows
    // a release is pressed while focus rests on `body`, outside the shell.
    const onKeyDown = () => {
        lastPointerDownAt = null;
    };
    const onFocusIn = () => {
        if (
            lastPointerDownAt === null ||
            Date.now() - lastPointerDownAt > POINTER_ATTRIBUTION_WINDOW_MS
        ) {
            return;
        }
        blurFocusedControl(root, { selector: VJS_RELEASE_SELECTOR });
    };

    root.addEventListener('pointerdown', onPointerDown, { capture: true });
    doc.addEventListener('keydown', onKeyDown, { capture: true });
    root.addEventListener('focusin', onFocusIn);
    return () => {
        root.removeEventListener('pointerdown', onPointerDown, {
            capture: true,
        });
        doc.removeEventListener('keydown', onKeyDown, { capture: true });
        root.removeEventListener('focusin', onFocusIn);
    };
}
