import {
    Component,
    DestroyRef,
    ElementRef,
    effect,
    inject,
    input,
    signal,
    viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Line-clamped text with a "Show more / Show less" toggle that appears only
 * when the text actually overflows the clamp (same pattern as the hero
 * description in ContentHeroComponent).
 */
@Component({
    selector: 'app-expandable-text',
    standalone: true,
    imports: [MatIconModule, TranslateModule],
    template: `
        <p
            #textEl
            class="expandable-text"
            [class.expandable-text--expanded]="isExpanded()"
            [style.-webkit-line-clamp]="isExpanded() ? 'unset' : clampLines()"
        >
            {{ text() }}
        </p>
        @if (hasOverflow() || isExpanded()) {
            <button
                type="button"
                class="expandable-text__toggle"
                (click)="toggle()"
                [attr.aria-expanded]="isExpanded()"
            >
                <span>{{
                    (isExpanded() ? 'SHOW_LESS' : 'SHOW_MORE') | translate
                }}</span>
                <mat-icon aria-hidden="true">
                    {{ isExpanded() ? 'expand_less' : 'expand_more' }}
                </mat-icon>
            </button>
        }
    `,
    styles: [
        `
            :host {
                display: block;
                min-width: 0;
            }

            .expandable-text {
                margin: 0;
                display: -webkit-box;
                -webkit-box-orient: vertical;
                overflow: hidden;

                &--expanded {
                    display: block;
                    overflow: visible;
                }
            }

            .expandable-text__toggle {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                margin-top: 2px;
                padding: 4px 0;
                background: transparent;
                border: 0;
                cursor: pointer;
                color: inherit;
                opacity: 0.75;
                font: inherit;
                font-size: 0.75rem;
                font-weight: 600;
                letter-spacing: 0.04em;
                text-transform: uppercase;

                &:hover {
                    opacity: 1;
                }

                mat-icon {
                    font-size: 16px;
                    width: 16px;
                    height: 16px;
                    line-height: 16px;
                }
            }
        `,
    ],
})
export class ExpandableTextComponent {
    private readonly destroyRef = inject(DestroyRef);

    readonly text = input.required<string>();
    readonly clampLines = input(3);

    readonly isExpanded = signal(false);
    readonly hasOverflow = signal(false);

    private readonly textEl = viewChild<ElementRef<HTMLElement>>('textEl');
    private resizeObserver?: ResizeObserver;

    constructor() {
        effect(() => {
            this.text();
            const el = this.textEl()?.nativeElement;
            if (!el) return;

            this.measureOverflow(el);
            this.observeOverflow(el);
        });

        this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());
    }

    toggle(): void {
        this.isExpanded.update((value) => !value);
    }

    private measureOverflow(el: HTMLElement): void {
        if (this.isExpanded()) return;
        this.hasOverflow.set(el.scrollHeight > el.clientHeight + 1);
    }

    private observeOverflow(el: HTMLElement): void {
        this.resizeObserver?.disconnect();
        if (typeof ResizeObserver === 'undefined') {
            this.measureOverflow(el);
            return;
        }
        this.resizeObserver = new ResizeObserver(() =>
            this.measureOverflow(el)
        );
        this.resizeObserver.observe(el);
    }
}
