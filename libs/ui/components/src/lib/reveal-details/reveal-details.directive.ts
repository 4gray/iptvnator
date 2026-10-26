import { Directive, effect, ElementRef, inject, input } from '@angular/core';

/** Reveal prefilled/invalid fields without closing a user's open disclosure. */
@Directive({ selector: 'details[appRevealDetails]' })
export class RevealDetailsDirective {
    readonly reveal = input(false, { alias: 'appRevealDetails' });
    private readonly element = inject<ElementRef<HTMLDetailsElement>>(ElementRef);

    constructor() {
        effect(() => {
            if (this.reveal()) this.element.nativeElement.open = true;
        });
    }
}
