import { attachVjsPointerFocusRelease } from './vjs-pointer-focus-release';

describe('attachVjsPointerFocusRelease', () => {
    let root: HTMLElement;
    let fullscreen: HTMLButtonElement;
    let seekBar: HTMLElement;
    let poster: HTMLElement;
    let menuButton: HTMLButtonElement;
    let menuItem: HTMLElement;
    let detach: () => void;

    beforeEach(() => {
        root = document.createElement('div');
        root.className = 'vjs-player-shell';
        // The focusable subset of the Video.js 8 skin: buttons, the poster
        // (`ClickableComponent`, role=button), sliders, and a menu button
        // whose popup items are focused by `MenuButton.pressButton()`.
        root.innerHTML = `
            <div class="video-js">
                <div class="vjs-poster" role="button" tabindex="0"></div>
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
            </div>`;
        document.body.appendChild(root);
        fullscreen = root.querySelector(
            '.vjs-fullscreen-control'
        ) as HTMLButtonElement;
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

    it('releases the focus that lands on a control-bar button after a pointer press', () => {
        pointerDown();
        fullscreen.focus();

        expect(document.activeElement).not.toBe(fullscreen);
    });

    it('releases the poster and a slider', () => {
        pointerDown();
        poster.focus();
        expect(document.activeElement).not.toBe(poster);

        pointerDown();
        seekBar.focus();
        expect(document.activeElement).not.toBe(seekBar);
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

    it('keeps an expanded menu button focused so its open popup keeps working', () => {
        menuButton.setAttribute('aria-expanded', 'true');
        pointerDown();
        menuButton.focus();

        expect(document.activeElement).toBe(menuButton);
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
