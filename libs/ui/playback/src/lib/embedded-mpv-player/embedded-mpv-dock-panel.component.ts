import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
    viewChild,
    viewChildren,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
    EmbeddedMpvDockPanelKind,
    EmbeddedMpvDockPanelView,
} from './embedded-mpv-dock-panels';

/**
 * Horizontal chip panel that morphs the native-view embedded MPV dock row:
 * back button + title on the inline-start side, then a scrollable chip
 * ribbon. It lives inside the fixed-height controls strip, so opening it
 * never changes the native MPV view bounds (no video re-letterboxing).
 */
@Component({
    selector: 'app-embedded-mpv-dock-panel',
    templateUrl: './embedded-mpv-dock-panel.component.html',
    styleUrl: './embedded-mpv-dock-panel.component.scss',
    imports: [MatButtonModule, MatIconModule, MatTooltipModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmbeddedMpvDockPanelComponent implements OnDestroy {
    readonly panel = input.required<EmbeddedMpvDockPanelView>();
    readonly backLabel = input.required<string>();

    readonly chipSelected = output<string>();
    readonly closed = output<void>();

    readonly canScrollStart = signal(false);
    readonly canScrollEnd = signal(false);

    private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly ribbon =
        viewChild<ElementRef<HTMLDivElement>>('ribbon');
    private readonly chips =
        viewChildren<ElementRef<HTMLButtonElement>>('chip');

    private lastRevealedKind: EmbeddedMpvDockPanelKind | null = null;
    private destroyed = false;

    constructor() {
        effect(() => {
            const panel = this.panel();
            const kind = panel.kind;
            const hasChips = panel.chips.length > 0;
            untracked(() => {
                const isNewPanel = kind !== this.lastRevealedKind;
                this.lastRevealedKind = kind;
                queueMicrotask(() => {
                    if (this.destroyed) {
                        return;
                    }
                    this.updateScrollState();
                    if (isNewPanel && hasChips) {
                        this.focusAndRevealSelectedChip();
                    }
                });
            });
        });
    }

    ngOnDestroy(): void {
        this.destroyed = true;
    }

    chipTabIndex(selected: boolean, index: number): number {
        if (selected) {
            return 0;
        }
        const hasSelected = this.panel().chips.some((chip) => chip.selected);
        return !hasSelected && index === 0 ? 0 : -1;
    }

    onRibbonScroll(): void {
        this.updateScrollState();
    }

    onRibbonWheel(event: WheelEvent): void {
        // Vertical wheel drives horizontal ribbon scrolling; dominant
        // horizontal deltas (trackpad swipes) keep native scrolling.
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
            return;
        }
        const ribbonEl = this.ribbon()?.nativeElement;
        if (!ribbonEl) {
            return;
        }
        event.preventDefault();
        ribbonEl.scrollLeft += event.deltaY * (this.isRtl() ? -1 : 1);
        this.updateScrollState();
    }

    onPanelKeydown(event: KeyboardEvent): void {
        const key = event.key;
        if (key === ' ' || key === 'Enter') {
            // Let the focused chip button activate natively (Space/Enter →
            // click → chipSelected), but stop the keydown before it reaches
            // the global shortcut handler, whose Space case would otherwise
            // preventDefault() the activation and toggle playback instead.
            // No preventDefault here — that would re-suppress the click.
            event.stopPropagation();
            return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            // The panel owns the keyboard: never let the global volume
            // shortcuts fire while a chip panel is open.
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (
            key !== 'ArrowLeft' &&
            key !== 'ArrowRight' &&
            key !== 'Home' &&
            key !== 'End'
        ) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const chips = this.chips().map((chip) => chip.nativeElement);
        if (!chips.length) {
            return;
        }
        chips[this.nextChipIndex(key, chips)]?.focus();
    }

    private nextChipIndex(key: string, chips: HTMLButtonElement[]): number {
        if (key === 'Home') {
            return 0;
        }
        if (key === 'End') {
            return chips.length - 1;
        }
        const forward = (key === 'ArrowRight') !== this.isRtl();
        const currentIndex = chips.indexOf(
            document.activeElement as HTMLButtonElement
        );
        if (currentIndex === -1) {
            return forward ? 0 : chips.length - 1;
        }
        return Math.max(
            0,
            Math.min(chips.length - 1, currentIndex + (forward ? 1 : -1))
        );
    }

    private focusAndRevealSelectedChip(): void {
        const chips = this.chips().map((chip) => chip.nativeElement);
        const selected =
            chips.find((chip) => chip.getAttribute('aria-checked') === 'true') ??
            chips[0];
        if (!selected) {
            return;
        }
        try {
            selected.focus({ preventScroll: true });
        } catch {
            selected.focus();
        }
        this.centerChipInRibbon(selected);
    }

    private centerChipInRibbon(chip: HTMLElement): void {
        const ribbonEl = this.ribbon()?.nativeElement;
        if (!ribbonEl) {
            return;
        }
        const ribbonRect = ribbonEl.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        // Physical-axis math keeps this correct in RTL; the browser clamps
        // scrollLeft to the valid range on both directions.
        ribbonEl.scrollLeft +=
            chipRect.left +
            chipRect.width / 2 -
            (ribbonRect.left + ribbonRect.width / 2);
        this.updateScrollState();
    }

    private updateScrollState(): void {
        const ribbonEl = this.ribbon()?.nativeElement;
        if (!ribbonEl) {
            return;
        }
        const maxScroll = Math.max(
            0,
            ribbonEl.scrollWidth - ribbonEl.clientWidth
        );
        const offset = Math.abs(ribbonEl.scrollLeft);
        this.canScrollStart.set(maxScroll > 1 && offset > 1);
        this.canScrollEnd.set(maxScroll > 1 && offset < maxScroll - 1);
    }

    private isRtl(): boolean {
        return (
            getComputedStyle(this.elementRef.nativeElement).direction === 'rtl'
        );
    }
}
