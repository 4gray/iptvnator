import { isImeComposing } from './keyboard';

const input = document.createElement('input');
const otherInput = document.createElement('input');

function keydown(init: KeyboardEventInit, target = input): KeyboardEvent {
    const event = new KeyboardEvent('keydown', init);
    target.dispatchEvent(event);
    return event;
}

const endComposition = () =>
    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
const releaseKey = () => document.dispatchEvent(new Event('keyup'));

describe('isImeComposing', () => {
    beforeAll(() => document.body.append(input, otherInput));
    afterAll(() => {
        input.remove();
        otherInput.remove();
    });
    afterEach(() => releaseKey());

    it.each([
        ['a composing Enter', { key: 'Enter', isComposing: true }, true],
        ['a plain Enter', { key: 'Enter', keyCode: 13 }, false],
        ['a plain letter', { key: 'a' }, false],
        // Android soft keyboards report 229 without any composition.
        [
            'an Android Enter (229, no composition)',
            { key: 'Enter', keyCode: 229 },
            false,
        ],
    ])('treats %s as composing: %s', (_label, init, expected) => {
        expect(isImeComposing(keydown(init))).toBe(expected);
    });

    it("treats Safari's commit key after compositionend as composing", () => {
        endComposition();

        expect(isImeComposing(keydown({ key: 'Enter', keyCode: 229 }))).toBe(
            true
        );
        // Released: the next Enter is the viewer's own.
        releaseKey();
        expect(isImeComposing(keydown({ key: 'Enter', keyCode: 229 }))).toBe(
            false
        );
    });

    it('does not carry a composition from one text field to another', () => {
        endComposition();

        expect(
            isImeComposing(keydown({ key: 'Enter', keyCode: 229 }, otherInput))
        ).toBe(false);
    });

    it('accepts a later 229 Enter when a composition ends without a keyup', () => {
        endComposition();
        const event = keydown({ key: 'Enter', keyCode: 229 });
        Object.defineProperty(event, 'timeStamp', {
            value: event.timeStamp + 1000,
        });

        expect(isImeComposing(event)).toBe(false);
    });

    it('does not hold back a plain Enter right after a composition', () => {
        endComposition();

        expect(isImeComposing(keydown({ key: 'Enter', keyCode: 13 }))).toBe(
            false
        );
    });
});
