import {
    blurFocusedControl,
    clickPointerOrigin,
} from './pointer-focus-release';

/** A click as an engine dispatches it; `pointerType` only when given. */
function click(pointerType?: string): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true });
    if (pointerType !== undefined) {
        Object.defineProperty(event, 'pointerType', { value: pointerType });
    }
    return event;
}

describe('clickPointerOrigin', () => {
    it('reports a pointer for mouse, touch, and pen clicks', () => {
        expect(clickPointerOrigin(click('mouse'))).toBe(true);
        expect(clickPointerOrigin(click('touch'))).toBe(true);
        expect(clickPointerOrigin(click('pen'))).toBe(true);
    });

    it('reports keyboard or script activation for an empty pointer type', () => {
        expect(clickPointerOrigin(click(''))).toBe(false);
    });

    it('reports unknown for a legacy click without a pointer type', () => {
        expect(clickPointerOrigin(click())).toBeNull();
    });
});

describe('blurFocusedControl', () => {
    let root: HTMLElement;

    beforeEach(() => {
        root = document.createElement('div');
        document.body.appendChild(root);
    });

    afterEach(() => {
        root.remove();
    });

    it('blurs a focused button inside the root', () => {
        const button = document.createElement('button');
        root.appendChild(button);
        button.focus();

        expect(blurFocusedControl(root)).toBe(true);
        expect(document.activeElement).not.toBe(button);
    });

    it('blurs a focused range input and ARIA slider by default', () => {
        const range = document.createElement('input');
        range.type = 'range';
        const slider = document.createElement('div');
        slider.setAttribute('role', 'slider');
        slider.tabIndex = 0;
        root.append(range, slider);

        range.focus();
        expect(blurFocusedControl(root)).toBe(true);
        slider.focus();
        expect(blurFocusedControl(root)).toBe(true);
        expect(document.activeElement).toBe(document.body);
    });

    it('leaves focus outside the root alone', () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();

        expect(blurFocusedControl(root)).toBe(false);
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });

    it('does nothing when nothing is focused', () => {
        expect(blurFocusedControl(root)).toBe(false);
    });

    it('keeps focus in text entry', () => {
        const field = document.createElement('input');
        field.type = 'text';
        root.appendChild(field);
        field.focus();

        expect(blurFocusedControl(root)).toBe(false);
        expect(document.activeElement).toBe(field);
    });

    it('honors a custom selector', () => {
        const clickable = document.createElement('div');
        clickable.setAttribute('role', 'button');
        clickable.tabIndex = 0;
        root.appendChild(clickable);
        clickable.focus();

        expect(blurFocusedControl(root)).toBe(false);
        expect(document.activeElement).toBe(clickable);
        expect(blurFocusedControl(root, { selector: '[role="button"]' })).toBe(
            true
        );
        expect(document.activeElement).not.toBe(clickable);
    });

    it('keeps focus inside an exempt subtree', () => {
        const menu = document.createElement('div');
        menu.className = 'menu';
        const item = document.createElement('button');
        menu.appendChild(item);
        root.appendChild(menu);
        item.focus();

        expect(blurFocusedControl(root, { exempt: '.menu' })).toBe(false);
        expect(document.activeElement).toBe(item);
        expect(blurFocusedControl(root)).toBe(true);
    });
});
