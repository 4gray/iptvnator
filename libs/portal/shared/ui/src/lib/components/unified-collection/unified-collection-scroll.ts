import { afterEveryRender, ElementRef } from '@angular/core';

const SCROLL_STATE_KEY = 'collectionScroll';

/**
 * Collection lists own their scrolling. Capture those offsets before the
 * list is replaced and restore them after the matching entry renders again.
 */
export function createCollectionScrollState(host: ElementRef<HTMLElement>) {
    const scrollers = () =>
        host.nativeElement.querySelectorAll<HTMLElement>(
            '[data-collection-scroll]'
        );
    let pending: Record<string, [number, number]> = {};

    afterEveryRender(() => {
        if (Object.keys(pending).length === 0) return;

        for (const element of scrollers()) {
            const key = element.dataset['collectionScroll'] ?? '';
            const position = pending[key];
            if (!position) continue;

            const [left, top] = position;
            element.scrollLeft = left;
            element.scrollTop = top;
            // A paged or loading grid can acquire its full height later.
            if (element.scrollLeft === left && element.scrollTop === top) {
                delete pending[key];
            }
        }
    });

    return {
        commit(): void {
            const positions: typeof pending = {};
            for (const element of scrollers()) {
                positions[element.dataset['collectionScroll'] ?? ''] = [
                    element.scrollLeft,
                    element.scrollTop,
                ];
            }
            window.history.replaceState(
                {
                    ...window.history.state,
                    [SCROLL_STATE_KEY]: positions,
                },
                document.title
            );
        },
        restore(): void {
            pending = { ...window.history.state?.[SCROLL_STATE_KEY] };
        },
    };
}
