import { FocusKeyManager, type FocusableOption } from '@angular/cdk/a11y';
import {
    DestroyRef,
    Directive,
    ElementRef,
    Injector,
    computed,
    contentChildren,
    inject,
    input,
    signal,
} from '@angular/core';

/** One option of a {@link SettingsRadioGroupDirective}: a native button. */
@Directive({
    selector: 'button[appSettingsRadio]',
    host: {
        role: 'radio',
        '[attr.aria-checked]': 'checked()',
        '[attr.tabindex]': 'isTabStop() ? 0 : -1',
        '(focus)': 'onFocus()',
    },
})
export class SettingsRadioDirective implements FocusableOption {
    // Not required: a sibling's host binding reads every option's state
    // before the later options of the same pass have their inputs.
    readonly checked = input(false, { alias: 'appSettingsRadio' });
    private readonly group = inject(SettingsRadioGroupDirective);
    private readonly element: HTMLButtonElement =
        inject<ElementRef<HTMLButtonElement>>(ElementRef).nativeElement;
    readonly isTabStop = computed(() => this.group.tabStop() === this);

    get disabled(): boolean {
        return this.element.disabled;
    }

    focus(): void {
        this.element.focus();
    }

    onFocus(): void {
        this.group.onOptionFocus(this);
    }

    /**
     * Checks the option through its own click handler, as a press would.
     * Unconditionally: the engine may still report this option checked
     * while a switch away from it is pending, and returning to it must
     * cancel that switch.
     */
    check(): void {
        this.element.click();
    }

    /** Immediate write of what the `tabindex` binding renders next. */
    setTabStop(isTabStop: boolean): void {
        this.element.tabIndex = isTabStop ? 0 : -1;
    }
}

/**
 * A radio group in the settings panel (audio, subtitles, quality, speed,
 * aspect, subtitle size and colour). One option is a Tab stop — the checked
 * one, or the first when none is — and the arrow keys, Home and End move
 * focus between the options with a CDK `FocusKeyManager` and check the
 * option they reach, as a native radio group does. Checking clicks the
 * option, so the template's handler applies the choice to the player.
 */
@Directive({
    selector: '[appSettingsRadioGroup]',
    host: {
        role: 'radiogroup',
        '(keydown)': 'onKeydown($event)',
        '(focusout)': 'onFocusOut($event)',
    },
})
export class SettingsRadioGroupDirective {
    private readonly host: HTMLElement =
        inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly options = contentChildren(SettingsRadioDirective, {
        descendants: true,
    });
    /** The option keyboard focus moved to, while it stays in the group. */
    private readonly focused = signal<SettingsRadioDirective | null>(null);
    private readonly keyManager = new FocusKeyManager(
        this.options,
        inject(Injector)
    )
        .withWrap()
        .withVerticalOrientation()
        .withHomeAndEnd();

    readonly tabStop = computed(() => {
        const options = this.options();
        const focused = this.focused();
        if (focused && options.includes(focused)) {
            return focused;
        }
        return options.find((option) => option.checked()) ?? options[0];
    });

    constructor() {
        inject(DestroyRef).onDestroy(() => this.keyManager.destroy());
    }

    onOptionFocus(option: SettingsRadioDirective): void {
        this.focused.set(option);
        this.keyManager.updateActiveItem(option);
        this.applyTabStop();
    }

    onKeydown(event: KeyboardEvent): void {
        const rtl = getComputedStyle(this.host).direction === 'rtl';
        this.keyManager.withHorizontalOrientation(rtl ? 'rtl' : 'ltr');
        const previous = this.keyManager.activeItem;
        this.keyManager.onKeydown(event);
        const next = this.keyManager.activeItem;
        if (next && next !== previous) {
            next.check();
        }
    }

    /** Leaving the group hands the Tab stop back to the checked option. */
    onFocusOut(event: FocusEvent): void {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !this.host.contains(next)) {
            this.focused.set(null);
            this.applyTabStop();
        }
    }

    /**
     * The `tabindex` bindings follow on the next change detection, but a
     * quick Shift+Tab, Tab can arrive before it and would re-enter the group
     * on a stale stop, so focus changes also write it straight away.
     */
    private applyTabStop(): void {
        const stop = this.tabStop();
        for (const option of this.options()) {
            option.setTabStop(option === stop);
        }
    }
}
