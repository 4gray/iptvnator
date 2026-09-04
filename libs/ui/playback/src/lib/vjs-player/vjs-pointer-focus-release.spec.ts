import { attachVjsPointerFocusRelease } from './vjs-pointer-focus-release';

describe('attachVjsPointerFocusRelease', () => {
    let root: HTMLElement;
    let fullscreen: HTMLButtonElement;
    let seekBar: HTMLElement;
    let menuButton: HTMLButtonElement;
    let menuItem: HTMLElement;
    let modalResetButton: HTMLButtonElement;
    let detach: () => void;

    beforeEach(() => {
        root = document.createElement('div');
        root.className = 'vjs-player-shell';
        // The Video.js 8 layout that matters here: the control bar holds the
        // focusable chrome (buttons, sliders, a menu button whose popup items
        // are focused by `MenuButton.pressButton()`); the caption-settings
        // dialog is a modal *sibling* of the control bar, under `.video-js`.
        root.innerHTML = `
            <div class="video-js">
                <div class="vjs-control-bar">
                    <div class="vjs-progress-control vjs-control">
                        <div class="vjs-progress-holder vjs-slider" role="slider" tabindex="0"></div>
                    </div>
                    <div class="vjs-playback-rate vjs-menu-button-popup vjs-control">
                        <button class="vjs-playback-rate vjs-menu-button" type="button" aria-expanded="false"></button>
                        <div class="vjs-menu">
                            <ul class="vjs-menu-content" role="menu">
                                <li class="vjs-menu-item" role="menuitemradio" tabindex="-1"></li>
                            </ul>
                        </div>
                    </div>
                    <button class="vjs-fullscreen-control vjs-control vjs-button" type="button"></button>
                </div>
                <div class="vjs-text-track-settings vjs-modal-dialog" role="dialog">
                    <button class="vjs-default-button" type="button"></button>
                </div>
            </div>`;
        document.body.appendChild(root);
        fullscreen = root.querySelector(
            '.vjs-fullscreen-control'
        ) as HTMLButtonElement;
        seekBar = root.querySelector('.vjs-progress-holder') as HTMLElement;
        menuButton = root.querySelector(
            'button.vjs-menu-button'
        ) as HTMLButtonElement;
        menuItem = root.querySelector('.vjs-menu-item') as HTMLElement;
        modalResetButton = root.querySelector(
            '.vjs-text-track-settings .vjs-default-button'
        ) as HTMLButtonElement;
        detach = attachVjsPointerFocusRelease(root);
    });

    afterEach(() => {
        detach();
        root.remove();
        jest.useRealTimers();
    });

    /** A pointer press as the pane sees it (jsdom lacks PointerEvent). */
    const pointerDown = (target: EventTarget = root) => {
        target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    };

    const keyDown = (target: EventTarget = document.body) => {
        target.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
        );
    };

    const click = (target: EventTarget) => {
        target.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true })
        );
    };

    it('releases the focus that lands on a control-bar button after a pointer press', () => {
        pointerDown();
        fullscreen.focus();

        expect(document.activeElement).not.toBe(fullscreen);
    });

    it('releases a control-bar control clicked while it was already focused', () => {
        // Tab focuses it (kept — no pointer press yet), then a mouse click on
        // the same control moves no focus and fires no focusin, so the click
        // is the only signal.
        fullscreen.focus();
        expect(document.activeElement).toBe(fullscreen);

        pointerDown();
        click(fullscreen);

        expect(document.activeElement).not.toBe(fullscreen);
    });

    it('keeps an already-focused control the keyboard activates', () => {
        // Space/Enter on a focused button fires a click with no preceding
        // pointerdown, so the focus is kept.
        fullscreen.focus();

        click(fullscreen);

        expect(document.activeElement).toBe(fullscreen);
    });

    it('leaves a modal dialog button focused when it is clicked', () => {
        pointerDown(modalResetButton);
        modalResetButton.focus();
        // Even the click path is scoped to the control bar.
        click(modalResetButton);

        expect(document.activeElement).toBe(modalResetButton);
    });

    it('releases a control-bar slider', () => {
        pointerDown();
        seekBar.focus();

        expect(document.activeElement).not.toBe(seekBar);
    });

    it('leaves a modal dialog button focused so its focus trap survives', () => {
        // The caption-settings dialog keeps its own Escape/Tab handling; its
        // Reset button sits outside the control bar and must not be released.
        pointerDown(modalResetButton);
        modalResetButton.focus();

        expect(document.activeElement).toBe(modalResetButton);
    });

    it('keeps focus that no pointer press preceded (keyboard navigation)', () => {
        fullscreen.focus();

        expect(document.activeElement).toBe(fullscreen);
    });

    it('keeps focus once a key press has ended the pointer attribution', () => {
        // The key that follows a release is pressed while focus rests on
        // body, outside the shell, so the clear must not depend on the shell.
        pointerDown();
        keyDown(document);
        fullscreen.focus();

        expect(document.activeElement).toBe(fullscreen);
    });

    it('releases the menu button Video.js focuses after an item is chosen', () => {
        // Choosing an item: the press lands on the item, which is not
        // eligible, then Video.js moves focus to the now-collapsed button.
        pointerDown(menuItem);
        menuItem.focus();
        expect(document.activeElement).toBe(menuItem);

        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.focus();
        expect(document.activeElement).not.toBe(menuButton);
    });

    it('releases an expanded menu button so Space works after a click closes it', () => {
        // Toggling an open menu shut with a pointer moves focus item -> button
        // while the button is still expanded; the button then swallows keys
        // until released. It is not exempt: the popup is navigated through its
        // item, so dropping the button focus never disturbs an open menu.
        menuButton.setAttribute('aria-expanded', 'true');
        pointerDown();
        menuButton.focus();

        expect(document.activeElement).not.toBe(menuButton);
    });

    it('keeps a focused menu item so arrow navigation survives', () => {
        pointerDown();
        menuItem.focus();

        expect(document.activeElement).toBe(menuItem);
    });

    it('forgets a pointer press after the attribution window', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        pointerDown();
        jest.setSystemTime(new Date('2026-01-01T00:00:01.500Z'));
        fullscreen.focus();

        expect(document.activeElement).toBe(fullscreen);
    });

    it('stops releasing after detach', () => {
        detach();
        pointerDown();
        fullscreen.focus();

        expect(document.activeElement).toBe(fullscreen);
    });
});
