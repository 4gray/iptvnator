import type { ComponentChildren } from 'preact';

export function PhoneSetupPanel({
    compact,
    children,
}: {
    compact: boolean;
    children: ComponentChildren;
}) {
    return (
        <div
            class="phone-pairing"
            data-tv-modal={compact || undefined}
            role={compact ? 'dialog' : undefined}
            aria-modal={compact || undefined}
            aria-label={compact ? 'Set up from phone' : undefined}
            onKeyDown={(event) => {
                if (!compact) return;
                if (
                    event.keyCode === 461 ||
                    ['Escape', 'BrowserBack', 'Backspace'].includes(event.key)
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget
                        .querySelector<HTMLButtonElement>(
                            '[data-focus="phone-cancel"]'
                        )
                        ?.click();
                } else if (event.key === 'Tab') {
                    event.preventDefault();
                    event.stopPropagation();
                    const controls = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>(
                            'button:not(:disabled)'
                        )
                    );
                    const index = controls.indexOf(
                        document.activeElement as HTMLButtonElement
                    );
                    controls[
                        (index + (event.shiftKey ? -1 : 1) + controls.length) %
                            controls.length
                    ]?.focus();
                }
            }}
        >
            {children}
        </div>
    );
}
