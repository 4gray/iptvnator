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

// Safari can deliver the commit key after compositionend (WebKit #165004).
// Scope 229 to the same field and brief event window: Android also uses it
// for ordinary Enter presses, and a candidate click may never send keyup.
const IME_COMMIT_WINDOW_MS = 50;
let compositionEnd: Event | undefined;
let clearTimer: ReturnType<typeof setTimeout>;

function clearCompositionEnd(): void {
    compositionEnd = undefined;
    clearTimeout(clearTimer);
}

if (typeof document !== 'undefined') {
    document.addEventListener(
        'compositionend',
        (event) => {
            clearCompositionEnd();
            compositionEnd = event;
            clearTimer = setTimeout(clearCompositionEnd, IME_COMMIT_WINDOW_MS);
        },
        true
    );
    document.addEventListener('keyup', clearCompositionEnd, true);
    document.addEventListener('focusout', clearCompositionEnd, true);
}

/**
 * True while the key belongs to an input method (IME) composition: Enter
 * then commits the composed text, and arrows or Escape drive the candidate
 * list, so a text field must not treat the key as its own.
 */
export function isImeComposing(event: KeyboardEvent): boolean {
    return (
        event.isComposing ||
        (event.keyCode === 229 &&
            compositionEnd !== undefined &&
            compositionEnd.target === event.target &&
            Math.abs(event.timeStamp - compositionEnd.timeStamp) <=
                IME_COMMIT_WINDOW_MS)
    );
}
