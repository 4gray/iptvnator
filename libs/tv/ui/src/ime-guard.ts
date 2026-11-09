/**
 * Text-like controls whose focus must not summon the TV keyboard while the
 * user arrows through a form; editing starts only on explicit Enter or click.
 */
const editable =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="file"]):not([type="image"]):not([type="color"]),textarea';

function targetOf(event: Event) {
    const target = event.target as HTMLElement | null;
    return target?.matches?.(editable)
        ? (target as HTMLInputElement | HTMLTextAreaElement)
        : null;
}

export function installImeGuard() {
    let activating = false;
    const activate = (element: HTMLInputElement | HTMLTextAreaElement) => {
        activating = true;
        try {
            element.readOnly = false;
            // Refocus so firmwares that only summon the keyboard on a focus
            // transition fire for an already-focused field.
            if (document.activeElement === element) element.blur();
            element.focus();
            try {
                element.select();
            } catch {
                /* number/email fields do not support selection */
            }
        } finally {
            activating = false;
        }
    };
    const onFocus = (event: FocusEvent) => {
        const element = targetOf(event);
        if (element && !activating) element.readOnly = true;
    };
    // Read-only controls are barred from constraint validation: before a
    // form can submit, its required fields must be editable again so the
    // browser can still refuse empty values.
    const unlockForm = (element: HTMLElement | null) => {
        const form = element?.closest?.('form');
        for (const field of form?.querySelectorAll<
            HTMLInputElement | HTMLTextAreaElement
        >(editable) ?? [])
            field.readOnly = false;
    };
    const onClick = (event: MouseEvent) => {
        const element = targetOf(event);
        if (element?.readOnly) return activate(element);
        const target = event.target as HTMLElement | null;
        if (target?.matches?.('button')) unlockForm(target);
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.keyCode !== 13 && event.key !== 'Enter') return;
        const element = targetOf(event);
        if (element?.readOnly) {
            event.preventDefault();
            activate(element);
        } else if (element) {
            unlockForm(element);
        }
    };
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onFocus, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
        document.removeEventListener('focusin', onFocus, true);
        document.removeEventListener('focusout', onFocus, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
    };
}
