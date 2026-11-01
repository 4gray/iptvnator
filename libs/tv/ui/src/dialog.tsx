import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

/** Own remote, pointer and Tab focus until the originating control is restored. */
export function TvDialog({
    title,
    close,
    children,
}: {
    title: string;
    close: () => void;
    children: ComponentChildren;
}) {
    const root = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const origin = document.activeElement as HTMLElement;
        const panel = root.current!;
        let last: HTMLElement;
        const keepFocus = (event: FocusEvent) => {
            const target = event.target as HTMLElement;
            if (panel.contains(target)) last = target;
            else
                (last?.isConnected
                    ? last
                    : panel.querySelector<HTMLElement>('button')
                )?.focus();
        };
        document.addEventListener('focusin', keepFocus, true);
        (
            panel.querySelector<HTMLElement>('[data-dialog-initial]') ??
            panel.querySelector<HTMLElement>('button')
        )?.focus();
        return () => {
            document.removeEventListener('focusin', keepFocus, true);
            requestAnimationFrame(() => {
                if (
                    origin.isConnected &&
                    origin.offsetHeight &&
                    !origin.matches(':disabled')
                )
                    origin.focus({ preventScroll: true });
            });
        };
    }, []);
    return createPortal(
        <div
            class="tv-dialog-backdrop"
            onClick={(event) => {
                if (event.target === event.currentTarget) close();
            }}
        >
            <div
                ref={root}
                class="tv-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                data-tv-modal
                onMouseMove={(event) => {
                    if (!event.movementX && !event.movementY) return;
                    const button = (event.target as HTMLElement).closest(
                        'button'
                    );
                    if (button && button !== document.activeElement)
                        button.focus({ preventScroll: true });
                }}
                onKeyDown={(event) => {
                    if (
                        event.keyCode === 461 ||
                        ['Escape', 'BrowserBack', 'Backspace'].includes(
                            event.key
                        )
                    ) {
                        if (
                            event.key === 'Backspace' &&
                            (event.target as HTMLElement).matches(
                                'input,textarea'
                            )
                        )
                            return;
                        event.preventDefault();
                        event.stopPropagation();
                        close();
                    } else if (event.key === 'Tab') {
                        const controls = Array.from(
                            root.current!.querySelectorAll<HTMLElement>(
                                'button:not(:disabled),input:not(:disabled),[data-tv-scroll]'
                            )
                        ).filter(
                            (element) =>
                                element.offsetHeight &&
                                !element.closest('[hidden]')
                        );
                        const index = controls.indexOf(
                            document.activeElement as HTMLElement
                        );
                        controls[
                            (index +
                                (event.shiftKey ? -1 : 1) +
                                controls.length) %
                                controls.length
                        ]?.focus();
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }}
            >
                <div class="tv-dialog-header">
                    <h2>{title}</h2>
                    <button type="button" onClick={close}>
                        Close
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body
    );
}
