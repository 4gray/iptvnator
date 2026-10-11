import {
    afterRenderEffect,
    DestroyRef,
    Directive,
    ElementRef,
    inject,
    input,
} from '@angular/core';

/** Matches the context panel's own width transition. */
export const LAYOUT_SLIDE_DURATION_MS = 180;

export const LAYOUT_SLIDE_ACTIVE_CLASS = 'layout-slide-active';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Slides shell chrome from where it was to where a layout change put it
 * (FLIP) instead of letting it jump in one frame. The new layout applies at
 * once: each target only starts translated back to its previous position
 * and animates its transform to none, so nothing waits for the animation,
 * and Chromium records no layout shift for a transform.
 *
 * A change of `appLayoutSlide` slides the targets (`layoutSlideTargets`,
 * selectors inside the host; the host itself when empty). A change of
 * `layoutSlideRecordOn`, and a resize of the host or a target, only records
 * where the targets are, so the next slide starts from where they are
 * really drawn. Positions are `offsetLeft` values, which ignore transforms.
 * Under `prefers-reduced-motion` the change stays an instant jump.
 * Contract: docs/architecture/workspace-shell.md ("Layout slides").
 */
@Directive({
    selector: '[appLayoutSlide]',
})
export class LayoutSlideDirective {
    readonly appLayoutSlide = input.required<unknown>();
    readonly layoutSlideRecordOn = input<unknown>(null);
    readonly layoutSlideTargets = input('');

    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly positions = new WeakMap<HTMLElement, number>();
    private readonly running = new WeakMap<HTMLElement, Animation>();

    constructor() {
        let resizeObserver: ResizeObserver | null = null;
        let observed: readonly HTMLElement[] = [];
        let previousKey: unknown;
        let initialized = false;
        afterRenderEffect({
            read: () => {
                const key = this.appLayoutSlide();
                this.layoutSlideRecordOn();
                const targets = this.targets();
                if (initialized && key !== previousKey) {
                    this.slide(targets);
                } else {
                    this.record(targets);
                }
                previousKey = key;
                initialized = true;
                if (typeof ResizeObserver === 'undefined') {
                    return;
                }
                resizeObserver ??= new ResizeObserver(() =>
                    this.record(this.targets())
                );
                const next = [this.host.nativeElement, ...targets];
                if (!sameElements(observed, next)) {
                    resizeObserver.disconnect();
                    next.forEach((element) => resizeObserver?.observe(element));
                    observed = next;
                }
            },
        });
        inject(DestroyRef).onDestroy(() => resizeObserver?.disconnect());
    }

    private targets(): HTMLElement[] {
        const host = this.host.nativeElement;
        const selector = this.layoutSlideTargets();
        return selector
            ? Array.from(host.querySelectorAll<HTMLElement>(selector))
            : [host];
    }

    private record(targets: readonly HTMLElement[]): void {
        for (const target of targets) {
            this.positions.set(target, target.offsetLeft);
        }
    }

    private slide(targets: readonly HTMLElement[]): void {
        // Every position is read before the first animation starts, so the
        // layout is computed once.
        const moves: [HTMLElement, number][] = [];
        for (const target of targets) {
            const previous = this.positions.get(target);
            const next = target.offsetLeft;
            this.positions.set(target, next);
            // A slide still running is interrupted: the new one starts where
            // the target is drawn now, not where the old one was heading.
            const drawn = this.running.has(target)
                ? translateX(getComputedStyle(target).transform)
                : 0;
            if (previous !== undefined && previous + drawn !== next) {
                moves.push([target, previous + drawn - next]);
            }
        }
        if (prefersReducedMotion()) {
            return;
        }
        for (const [target, offset] of moves) {
            if (typeof target.animate === 'function') {
                this.animate(target, offset);
            }
        }
    }

    /**
     * While it runs the target carries `layout-slide-active`, and the width
     * it uncovers on either side as `--layout-slide-start` /
     * `--layout-slide-end`, so its stylesheet can fill that strip.
     */
    private animate(target: HTMLElement, offset: number): void {
        const superseded = this.running.get(target);
        const animation = target.animate(
            [{ transform: `translateX(${offset}px)` }, { transform: 'none' }],
            { duration: LAYOUT_SLIDE_DURATION_MS, easing: 'ease' }
        );
        this.running.set(target, animation);
        superseded?.cancel();
        target.classList.add(LAYOUT_SLIDE_ACTIVE_CLASS);
        target.style.setProperty(
            '--layout-slide-start',
            `${Math.max(offset, 0)}px`
        );
        target.style.setProperty(
            '--layout-slide-end',
            `${Math.max(-offset, 0)}px`
        );
        const settle = () => {
            if (this.running.get(target) !== animation) {
                return;
            }
            this.running.delete(target);
            target.classList.remove(LAYOUT_SLIDE_ACTIVE_CLASS);
            target.style.removeProperty('--layout-slide-start');
            target.style.removeProperty('--layout-slide-end');
        };
        animation.addEventListener('finish', settle);
        animation.addEventListener('cancel', settle);
    }
}

function sameElements(
    a: readonly HTMLElement[],
    b: readonly HTMLElement[]
): boolean {
    return a.length === b.length && a.every((element, i) => element === b[i]);
}

/** The x translation of a computed `transform` value (0 for `none`). */
export function translateX(transform: string): number {
    const values = /^matrix(3d)?\((.+)\)$/.exec(transform.trim());
    if (!values) {
        return 0;
    }
    const parts = values[2].split(',').map(Number);
    const x = values[1] ? parts[12] : parts[4];
    return Number.isFinite(x) ? x : 0;
}

function prefersReducedMotion(): boolean {
    return (
        typeof matchMedia === 'function' &&
        matchMedia(REDUCED_MOTION_QUERY).matches
    );
}
