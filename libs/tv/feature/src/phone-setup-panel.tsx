import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export function PhoneSetupPanel({
    compact,
    children,
}: {
    compact: boolean;
    children: ComponentChildren;
}) {
    const panel = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (!compact) return;
        let last: HTMLElement | undefined;
        const keepFocus = (event: FocusEvent) => {
            const root = panel.current;
            if (!root) return;
            const target = event.target as HTMLElement;
            if (root.contains(target)) {
                last = target;
                return;
            }
            event.stopPropagation();
            const retained =
                last?.isConnected && !last.matches(':disabled')
                    ? last
                    : undefined;
            (
                retained ??
                root.querySelector<HTMLElement>('button:not(:disabled)') ??
                root
            ).focus();
        };
        document.addEventListener('focusin', keepFocus, true);
        return () => document.removeEventListener('focusin', keepFocus, true);
    }, [compact]);
    const content = (
        <div
            ref={panel}
            tabIndex={compact ? -1 : undefined}
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
    return compact ? (
        <div
            class="phone-modal-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget)
                    event.preventDefault();
            }}
        >
            {content}
        </div>
    ) : (
        content
    );
}

export function PhoneInstructions({
    qr,
    remaining,
}: {
    qr: string;
    remaining: number;
}) {
    return (
        <>
            <img
                class="pairing-qr"
                src={qr}
                alt="Scan this QR code to set up your TV from your phone"
            />
            <div>
                <h3>Open your phone’s camera</h3>
                <p>Keep your phone on the same home network.</p>
                <p class="muted" role="status">
                    Waiting for your phone · {Math.floor(remaining / 60)}:
                    {String(remaining % 60).padStart(2, '0')}
                </p>
            </div>
        </>
    );
}
