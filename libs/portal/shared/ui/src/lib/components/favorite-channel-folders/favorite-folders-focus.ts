import { DOCUMENT } from '@angular/common';
import { afterNextRender, ElementRef, inject, Injector } from '@angular/core';

export function injectFavoriteFoldersFocus() {
    const document = inject(DOCUMENT);
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const injector = inject(Injector);

    return (...selectors: string[]): void => {
        afterNextRender(
            () => {
                for (const selector of selectors) {
                    const scope = selector.startsWith('[data-favorite-folder-')
                        ? document
                        : host;
                    const target = Array.from(
                        scope.querySelectorAll<HTMLElement>(selector)
                    ).find(
                        (element) =>
                            element.getClientRects().length &&
                            document.defaultView?.getComputedStyle(element)
                                .visibility !== 'hidden'
                    );
                    target?.focus();
                    if (target && document.activeElement === target) return;
                }
            },
            { injector }
        );
    };
}
