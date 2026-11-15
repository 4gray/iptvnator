/**
 * Returns true when the keyboard event originated inside an editable text
 * field, so global shortcuts should not fire.
 */
export function isTypingInInput(event: Event): boolean {
    const target = event.target;
    if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
    ) {
        return true;
    }
    return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * Safari sends the key that commits a composition after `compositionend`,
 * with `isComposing` false and only `keyCode` 229. A 229 counts as that
 * commit only between `compositionend` and the next `keyup`: Android soft
 * keyboards report 229 for ordinary keys — Enter included — without any
 * composition, and those must keep working.
 */
let compositionJustEnded = false;
if (typeof document !== 'undefined') {
    document.addEventListener(
        'compositionend',
        () => (compositionJustEnded = true),
        true
    );
    document.addEventListener(
        'keyup',
        () => (compositionJustEnded = false),
        true
    );
}

/**
 * True while the key belongs to an input method (IME) composition: Enter
 * then commits the composed text, and arrows or Escape drive the candidate
 * list, so a text field must not treat the key as its own.
 */
export function isImeComposing(event: KeyboardEvent): boolean {
    return event.isComposing || (compositionJustEnded && event.keyCode === 229);
}
