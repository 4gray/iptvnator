import { isImeComposing } from './keyboard';

const keydown = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
const endComposition = () =>
    document.dispatchEvent(new Event('compositionend'));
const releaseKey = () => document.dispatchEvent(new Event('keyup'));

describe('isImeComposing', () => {
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

    it('does not hold back a plain Enter right after a composition', () => {
        endComposition();

        expect(isImeComposing(keydown({ key: 'Enter', keyCode: 13 }))).toBe(
            false
        );
    });
});
