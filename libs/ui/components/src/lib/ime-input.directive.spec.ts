import { ImeInputDirective } from './ime-input.directive';

const enter = (init: KeyboardEventInit = {}) =>
    new KeyboardEvent('keydown', { key: 'Enter', ...init });

describe('ImeInputDirective', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('guards candidate keys during composition and lets F11 through', () => {
        const directive = new ImeInputDirective();

        expect(directive.isCompositionKey(enter({ isComposing: true }))).toBe(
            true
        );
        expect(
            directive.isCompositionKey(enter({ key: 'F11', isComposing: true }))
        ).toBe(false);
    });

    it("guards Safari's paired key through a delay in the same event loop turn", () => {
        const directive = new ImeInputDirective();
        const otherInput = new ImeInputDirective();
        const key = enter({ keyCode: 229 });
        Object.defineProperty(key, 'timeStamp', { value: 1 });

        directive.onCompositionEnd();
        jest.setSystemTime(Date.now() + 75);

        expect(directive.isCompositionKey(key)).toBe(true);
        expect(otherInput.isCompositionKey(key)).toBe(false);
        expect(directive.isCompositionKey(enter({ keyCode: 13 }))).toBe(false);

        directive.reset();
        expect(directive.isCompositionKey(key)).toBe(false);
    });

    it('accepts a later 229 Enter when composition ended without keyup', () => {
        const directive = new ImeInputDirective();

        directive.onCompositionEnd();
        jest.advanceTimersByTime(50);

        expect(directive.isCompositionKey(enter({ keyCode: 229 }))).toBe(false);
    });
});
