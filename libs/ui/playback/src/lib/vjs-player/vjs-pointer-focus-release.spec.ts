import { attachVjsPointerFocusRelease } from './vjs-pointer-focus-release';

/** A click as Chromium dispatches it; `pointerType` only when given. */
function click(target: Element, pointerType?: string): void {
    const event = new MouseEvent('click', { bubbles: true });
    if (pointerType !== undefined) {
        Object.defineProperty(event, 'pointerType', { value: pointerType });
    }
    target.dispatchEvent(event);
}

describe('attachVjsPointerFocusRelease', () => {
    let root: HTMLElement;
    let fullscreen: HTMLButtonElement;
    let icon: HTMLElement;
    let seekBar: HTMLElement;
    let poster: HTMLElement;
    let menuButton: HTMLButtonElement;
    let menuItem: HTMLElement;
    let detach: () => void;

    beforeEach(() => {
        root = document.createElement('div');
        root.className = 'vjs-player-shell';
        // The subset of the Video.js 8 skin that takes focus: buttons, the
        // poster (`ClickableComponent`), sliders, and a menu button whose
        // popup items are focused by `MenuButton.pressButton()`.
        root.innerHTML = `
            <div class="video-js">
                <div class="vjs-poster" role="button" tabindex="0"></div>
                <div class="vjs-control-bar">
                    <div class="vjs-progress-control vjs-control">
                        <div class="vjs-progress-holder vjs-slider" role="slider" tabindex="0"></div>
                    </div>
                    <div class="vjs-playback-rate vjs-menu-button vjs-menu-button-popup vjs-control vjs-button">
                        <button class="vjs-playback-rate vjs-menu-button vjs-menu-button-popup vjs-button" type="button" aria-haspopup="true"></button>
                        <div class="vjs-menu">
                            <ul class="vjs-menu-content" role="menu">
                                <li class="vjs-menu-item" role="menuitemradio" tabindex="-1"></li>
                            </ul>
                        </div>
                    </div>
                    <button class="vjs-fullscreen-control vjs-control vjs-button" type="button">
                        <span class="vjs-icon-placeholder"></span>
                    </button>
                </div>
            </div>`;
        document.body.appendChild(root);
        fullscreen = root.querySelector(
            '.vjs-fullscreen-control'
        ) as HTMLButtonElement;
        icon = fullscreen.querySelector('.vjs-icon-placeholder') as HTMLElement;
        seekBar = root.querySelector('.vjs-progress-holder') as HTMLElement;
        poster = root.querySelector('.vjs-poster') as HTMLElement;
        menuButton = root.querySelector(
            'button.vjs-menu-button'
        ) as HTMLButtonElement;
        menuItem = root.querySelector('.vjs-menu-item') as HTMLElement;
        detach = attachVjsPointerFocusRelease(root);
    });

    afterEach(() => {
        detach();
        root.remove();
    });

    it('releases the focus a mouse click leaves on a control-bar button', () => {
        fullscreen.focus();
        expect(document.activeElement).toBe(fullscreen);

        click(icon, 'mouse');

        expect(document.activeElement).not.toBe(fullscreen);
    });

    it('releases a mouse-scrubbed slider and a clicked poster', () => {
        seekBar.focus();
        click(seekBar, 'mouse');
        expect(document.activeElement).not.toBe(seekBar);

        poster.focus();
        click(poster, 'touch');
        expect(document.activeElement).not.toBe(poster);
    });

    it('keeps focus on a button the keyboard activates', () => {
        fullscreen.focus();

        // Enter/Space: a synthetic click with an empty pointer type.
        click(fullscreen, '');

        expect(document.activeElement).toBe(fullscreen);
    });

    it('leaves a legacy click without a pointer type alone', () => {
        fullscreen.focus();

        click(fullscreen);

        expect(document.activeElement).toBe(fullscreen);
    });

    it('keeps the focus a pressed menu button moved into its menu', () => {
        // `MenuButton.pressButton()` focuses the first item; `Menu.handleBlur`
        // would close the menu if that focus were released.
        menuItem.focus();

        click(menuButton, 'mouse');

        expect(document.activeElement).toBe(menuItem);
    });

    it('keeps focus on the menu button itself', () => {
        menuButton.focus();

        click(menuButton, 'mouse');

        expect(document.activeElement).toBe(menuButton);
    });

    it('stops releasing after detach', () => {
        detach();
        fullscreen.focus();

        click(fullscreen, 'mouse');

        expect(document.activeElement).toBe(fullscreen);
    });
});
