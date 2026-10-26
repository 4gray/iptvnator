import {
    booleanAttribute,
    contentChildren,
    Directive,
    effect,
    ElementRef,
    inject,
    input,
    signal,
} from '@angular/core';

/** A native button keeps activation and styling; the group owns roving focus. */
@Directive({
    selector: 'button[appRadioOption]',
    host: {
        role: 'radio',
        '[attr.aria-checked]': 'checked()',
        '[tabIndex]': 'tabIndex()',
        '[disabled]': 'disabled()',
    },
})
export class RadioOptionDirective {
    readonly checked = input(false, { alias: 'appRadioOption' });
    readonly disabled = input(false, { transform: booleanAttribute });
    readonly tabIndex = signal(-1);
    readonly element = inject<ElementRef<HTMLButtonElement>>(ElementRef);

    activate(): void {
        this.element.nativeElement.focus();
        if (!this.checked()) this.element.nativeElement.click();
    }
}

/**
 * Behaviour for the kit's custom radio buttons, without changing their look.
 * Arrow keys select and wrap, Home/End jump, and only the saved/current choice
 * is in the tab sequence. Input changes (including Discard) restore that stop.
 */
@Directive({
    selector: '[appRadioGroup]',
    host: {
        role: 'radiogroup',
        '(keydown)': 'onKeydown($event)',
    },
})
export class RadioGroupDirective {
    private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly options = contentChildren(RadioOptionDirective, {
        descendants: true,
    });

    constructor() {
        effect(() => {
            const options = this.options();
            const enabled = options.filter((option) => !option.disabled());
            const selected =
                enabled.find((option) => option.checked()) ?? enabled[0];
            for (const option of options) {
                option.tabIndex.set(option === selected ? 0 : -1);
            }
        });
    }

    protected onKeydown(event: KeyboardEvent): void {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
            return;
        const options = this.options().filter((option) => !option.disabled());
        const index = options.findIndex((option) =>
            option.element.nativeElement.contains(event.target as Node)
        );
        if (index < 0) return;

        const rtl =
            getComputedStyle(this.element.nativeElement).direction === 'rtl';
        let next: number;
        switch (event.key) {
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = options.length - 1;
                break;
            case 'ArrowDown':
                next = index + 1;
                break;
            case 'ArrowUp':
                next = index - 1;
                break;
            case 'ArrowRight':
                next = index + (rtl ? -1 : 1);
                break;
            case 'ArrowLeft':
                next = index + (rtl ? 1 : -1);
                break;
            default:
                return;
        }
        event.preventDefault();
        options[(next + options.length) % options.length].activate();
    }
}
