import { blurFocusedControl, clickPointerOrigin } from '../player-controls';

/**
 * Video.js focusables: control-bar `<button>`s, `ClickableComponent` divs
 * (`role="button"`, e.g. the poster) and sliders (`role="slider"`).
 */
const VJS_RELEASE_SELECTOR = 'button, [role="button"], [role="slider"]';

/**
 * Menu buttons keep their focus: `MenuButton.pressButton()` moves it onto
 * the first popup menu item, and `Menu.handleBlur` unpresses the button when
 * that focus leaves, so a release would close the menu the click just opened.
 */
const VJS_MENU_SELECTOR = '.vjs-menu-button, .vjs-menu';

/**
 * Vendor-chrome counterpart of the shared controls' pointer focus release
 * (`ControlsSurface.releasePointerFocus`), attached to the player shell of
 * the preference-off Video.js player. Chromium focuses a clicked control-bar
 * `<button>` or slider, and a focused Video.js component captures the
 * keyboard entirely: `Component.handleKeyDown` stops the propagation of
 * every key and `ClickableComponent` turns Space and Enter into a click, so
 * after a mouse click on the fullscreen button Space left fullscreen instead
 * of pausing and `LegacyPlayerShortcuts` on the document never saw a key.
 * Releasing the focus once a pointer click completes hands every key back to
 * playback. Keyboard activation (an empty click `pointerType`) keeps focus
 * where Tab put it, and a legacy MouseEvent click without a pointer type is
 * left alone rather than guessed. Returns the detach function.
 */
export function attachVjsPointerFocusRelease(root: HTMLElement): () => void {
    const onClick = (event: MouseEvent) => {
        if (clickPointerOrigin(event) !== true) {
            return;
        }
        blurFocusedControl(root, {
            selector: VJS_RELEASE_SELECTOR,
            exempt: VJS_MENU_SELECTOR,
        });
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
}
