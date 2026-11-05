import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

const HIDDEN_PANE = '[inert], .sidebar-collapsed, .context-panel--collapsed';

const SCROLL_KEYS = new Set([
    'ArrowUp',
    'ArrowDown',
    'PageUp',
    'PageDown',
    'Home',
    'End',
    ' ',
]);

function unmodified(event: KeyboardEvent): boolean {
    return (
        !event.defaultPrevented &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
    );
}

/** Enter the visible live pane without selecting a channel or starting playback. */
export function focusLiveChannels(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' || !unmodified(event)) return;
    const category = event.currentTarget as HTMLElement;
    if (category.getAttribute('aria-current') !== 'true') return;
    const pane = category.ownerDocument.getElementById('live-channels');
    if (
        !pane?.checkVisibility({ checkVisibilityCSS: true }) ||
        pane.closest(HIDDEN_PANE)
    )
        return;
    event.preventDefault();
    event.stopPropagation();
    pane.focus({ preventScroll: true });
}

/** Native scroll ownership survives CDK row recycling; row actions remain buttons. */
@Directive({
    selector: '[appChannelScrollFocus]',
    host: {
        tabindex: '0',
        role: 'region',
        class: 'channel-scroll-focus',
        '(click)': 'onClick($event)',
        '(keydown)': 'onKeydown($event)',
        '(focusin)': 'onFocusIn($event)',
        '(focusout)': 'onFocusOut($event)',
    },
})
export class ChannelScrollFocusDirective {
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private focused: {
        element: HTMLElement;
        index: number;
        main: HTMLElement | null;
    } | null = null;

    constructor() {
        const observer = new MutationObserver(() => this.restoreRemovedFocus());
        observer.observe(this.host.nativeElement, {
            childList: true,
            subtree: true,
        });
        inject(DestroyRef).onDestroy(() => {
            observer.disconnect();
            queueMicrotask(() => this.restoreRemovedFocus());
        });
    }

    onFocusIn(event: FocusEvent): void {
        const element = event.target as HTMLElement;
        const row = element.closest('.channel-list-item');
        this.focused = row
            ? {
                  element,
                  index: Array.from(
                      this.host.nativeElement.querySelectorAll(
                          '.channel-list-item'
                      )
                  ).indexOf(row),
                  main: this.host.nativeElement.closest('main'),
              }
            : null;
    }

    onFocusOut(event: FocusEvent): void {
        if (
            event.relatedTarget instanceof Node &&
            !this.host.nativeElement.contains(event.relatedTarget)
        ) {
            this.focused = null;
        }
    }

    private restoreRemovedFocus(): void {
        const saved = this.focused;
        if (!saved || saved.element.isConnected) return;
        this.focused = null;
        if (document.activeElement !== document.body) return;
        const pane = this.host.nativeElement;
        if (pane.isConnected && !pane.closest(HIDDEN_PANE)) {
            const rows = pane.querySelectorAll<HTMLElement>(
                'button.channel-content:not([disabled])'
            );
            (rows[Math.min(saved.index, rows.length - 1)] ?? pane).focus({
                preventScroll: true,
            });
        } else if (saved.main?.isConnected && !saved.main.closest('[inert]')) {
            saved.main.focus({ preventScroll: true });
        }
    }

    onClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (event.detail <= 0 || !target.closest('.channel-list-item')) return;
        if (
            target.closest(
                'button:not(.channel-content), a, input, select, textarea'
            )
        )
            return;
        this.host.nativeElement.focus({ preventScroll: true });
    }

    onKeydown(event: KeyboardEvent): void {
        const pane = this.host.nativeElement;
        const target = event.target as HTMLElement;
        if (!unmodified(event) || pane.closest(HIDDEN_PANE)) return;
        const rowAction = target.matches('button.channel-content');
        if (target !== pane && !rowAction) return;

        if (event.key === 'ArrowLeft' && pane.id === 'live-channels') {
            const category = pane.ownerDocument.querySelector<HTMLElement>(
                '#portal-categories [aria-current="true"]'
            );
            if (
                !category?.checkVisibility({ checkVisibilityCSS: true }) ||
                category.closest(HIDDEN_PANE)
            )
                return;
            event.preventDefault();
            event.stopPropagation();
            category.focus({ preventScroll: true });
        } else if (
            SCROLL_KEYS.has(event.key) &&
            !(rowAction && event.key === ' ')
        ) {
            // Do not preventDefault: Chromium owns scroll distance, repetition,
            // PageUp/PageDown and Shift+Space. Only silence global player keys.
            event.stopPropagation();
            pane.focus({ preventScroll: true });
        }
    }
}
