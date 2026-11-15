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
