/** @jest-environment jsdom */
import { readFileSync } from 'fs';
import path from 'path';
import { runInNewContext } from 'vm';

describe('floating controls interaction origin', () => {
    function overlay() {
        const document =
            globalThis.document.implementation.createHTMLDocument();
        const ids = [
            'mute',
            'pause',
            'restore',
            'close',
            'minimize',
            'back',
            'forward',
            'volume',
            'timeline',
            'drag-handle',
        ];
        document.body.innerHTML = ids
            .map((id) => `<button id="${id}"></button>`)
            .join('');
        const api = {
            controlsFocus: jest.fn(),
            onState: jest.fn(),
            volume: jest.fn(),
            pause: jest.fn(),
            restore: jest.fn(),
            minimize: jest.fn(),
            seekBy: jest.fn(),
            seek: jest.fn(),
            drag: jest.fn(),
        };
        const script = readFileSync(
            path.join(__dirname, '../../assets/floating-player/overlay.js'),
            'utf8'
        );
        runInNewContext(script, { window: { floatingPlayer: api }, document });
        const control = document.getElementById('pause');
        if (!control) throw new Error('Missing overlay fixture control');
        return { document, api, control };
    }

    it('releases pointer-originated focus after a click so controls can hide', () => {
        const { document, api, control } = overlay();
        control.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(api.controlsFocus).toHaveBeenLastCalledWith(true);
        control.dispatchEvent(new Event('pointerup', { bubbles: true }));
        expect(api.controlsFocus).toHaveBeenLastCalledWith(false);
        // Retained DOM focus is not a reason to pin pointer-operated controls.
        control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(api.controlsFocus).toHaveBeenLastCalledWith(false);
    });

    it('retains keyboard focus until the focus leaves the controls', () => {
        const { document, api, control } = overlay();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
        control.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(api.controlsFocus).toHaveBeenLastCalledWith(true);
        control.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        expect(api.controlsFocus).toHaveBeenLastCalledWith(false);
    });

    it('keeps controls available during a pointer drag and releases cancelled interaction', () => {
        const { api, control } = overlay();
        control.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(api.controlsFocus).toHaveBeenLastCalledWith(true);
        control.dispatchEvent(new Event('pointercancel', { bubbles: true }));
        expect(api.controlsFocus).toHaveBeenLastCalledWith(false);
    });
});
