/**
 * Text-like controls whose focus must not summon the TV keyboard while the
 * user arrows through a form. OK, a click, or a physical edit starts editing.
 */
const editable =
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]):not([type="file"]):not([type="image"]):not([type="color"]),textarea';

type TextField = HTMLInputElement | HTMLTextAreaElement;

function targetOf(event: Event) {
    const target = event.target as HTMLElement | null;
    return target?.matches?.(editable) ? (target as TextField) : null;
}

function isPhysicalEdit(event: KeyboardEvent) {
    const { key, altKey, ctrlKey, metaKey, shiftKey } = event;
    // Backspace still means Back until the field is editable.
    if (key === 'Delete' || (key === 'Insert' && shiftKey)) return true;
    const textKey = key.length === 1 || key === 'Dead';
    if (
        textKey &&
        ((!ctrlKey && !metaKey) || event.getModifierState('AltGraph'))
    )
        return true;
    return (ctrlKey || metaKey) && !altKey && /^[vxyz]$/i.test(key);
}

export function installImeGuard() {
    const guarded = new WeakSet<TextField>();
    const invalidFields = new Set<TextField>();
    let activating = false;
    const release = (element: TextField) => {
        if (guarded.delete(element)) element.readOnly = false;
    };
    const activate = (element: TextField, selectText: boolean) => {
        activating = true;
        try {
            release(element);
            // Refocus so firmwares that only summon the keyboard on a focus
            // transition fire for an already-focused field.
            if (document.activeElement === element) element.blur();
            element.focus();
            if (selectText) {
                try {
                    element.select();
                } catch {
                    /* number/email fields do not support selection */
                }
            }
        } finally {
            activating = false;
        }
    };
    const onFocus = (event: FocusEvent) => {
        const element = targetOf(event);
        if (!element || element.readOnly || activating) return;
        if (event.type === 'focusin' && invalidFields.has(element)) {
            invalidFields.clear();
            return;
        }
        guarded.add(element);
        element.readOnly = true;
    };
    const onInvalid = (event: Event) => {
        const element = targetOf(event);
        if (!element) return;
        // The browser focuses the first invalid field to show its message.
        if (!invalidFields.size) setTimeout(() => invalidFields.clear(), 0);
        invalidFields.add(element);
    };
    // Read-only controls are barred from constraint validation: before a
    // form can submit, its required fields must be editable again so the
    // browser can still refuse empty values.
    const unlockForm = (element: HTMLElement | null) => {
        const form = element?.closest?.('form');
        for (const field of form?.querySelectorAll<TextField>(editable) ?? [])
            release(field);
    };
    const onClick = (event: MouseEvent) => {
        const element = targetOf(event);
        if (element && guarded.has(element)) return activate(element, false);
        const target = event.target as HTMLElement | null;
        const button = target?.closest?.('button');
        if (button?.type === 'submit') unlockForm(button);
    };
    const onKeyDown = (event: KeyboardEvent) => {
        invalidFields.clear();
        const element = targetOf(event);
        if (!element || event.defaultPrevented) return;
        if (
            event.isComposing ||
            event.key === 'Process' ||
            event.keyCode === 229
        ) {
            release(element);
            return;
        }
        if (event.keyCode !== 13 && event.key !== 'Enter') {
            if (guarded.has(element) && isPhysicalEdit(event)) release(element);
            return;
        }
        if (guarded.has(element)) {
            event.preventDefault();
            activate(element, true);
        } else {
            unlockForm(element);
        }
    };
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onFocus, true);
    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
        document.removeEventListener('focusin', onFocus, true);
        document.removeEventListener('focusout', onFocus, true);
        document.removeEventListener('invalid', onInvalid, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        for (const field of document.querySelectorAll<TextField>(editable))
            release(field);
    };
}
